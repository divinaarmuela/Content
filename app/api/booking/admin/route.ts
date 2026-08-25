import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'

/**
 * Dashboard booking config + management — services, bookable resources
 * (tech@/hello@/contact@), weekly availability, blackout days, and the
 * booking list. Account-manager+. One route: GET returns everything,
 * POST carries an `action`. Everything degrades to empty until
 * supabase/booking.sql has run.
 */

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'service'

export async function GET() {
  try {
    await requireRole('account_manager')
    const [services, resources, availability, blackouts, bookings] = await Promise.all([
      supabase.from('booking_services').select('*').order('sort_order').order('name'),
      supabase.from('booking_resources').select('*').order('label'),
      supabase.from('booking_availability').select('*'),
      supabase.from('booking_blackouts').select('*').order('day'),
      supabase.from('bookings')
        .select('*, booking_services(name), booking_resources(label)')
        .order('start_at', { ascending: false }).limit(200),
    ])
    // any error (tables not migrated yet) → empty, with a flag
    const missing = Boolean(services.error)
    return NextResponse.json({
      needs_schema: missing,
      services: services.data ?? [],
      resources: resources.data ?? [],
      availability: availability.data ?? [],
      blackouts: blackouts.data ?? [],
      bookings: bookings.data ?? [],
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireRole('account_manager')
    const body = await req.json()
    const action = String(body.action ?? '')

    switch (action) {
      case 'create_service': {
        const name = String(body.name ?? '').trim().slice(0, 120)
        if (!name) return NextResponse.json({ error: 'Name the service' }, { status: 422 })
        const duration = Math.min(1440, Math.max(5, Math.round(Number(body.duration_min) || 30)))
        const price = Math.max(0, Math.round(Number(body.price_cents) || 0))
        const { data, error } = await supabase.from('booking_services')
          .insert({ name, slug: slugify(body.slug || name), description: String(body.description ?? '').slice(0, 1000) || null, duration_min: duration, price_cents: price })
          .select().single()
        if (error) return NextResponse.json({ error: error.message.includes('duplicate') ? 'A service with that name/slug already exists' : 'Run supabase/booking.sql first' }, { status: 400 })
        return NextResponse.json({ service: data })
      }
      case 'update_service': {
        const patch: Record<string, unknown> = {}
        if ('name' in body) patch.name = String(body.name).trim().slice(0, 120)
        if ('description' in body) patch.description = String(body.description ?? '').slice(0, 1000) || null
        if ('duration_min' in body) patch.duration_min = Math.min(1440, Math.max(5, Math.round(Number(body.duration_min) || 30)))
        if ('price_cents' in body) patch.price_cents = Math.max(0, Math.round(Number(body.price_cents) || 0))
        if ('active' in body) patch.active = body.active !== false
        if ('location' in body) patch.location = String(body.location ?? '').trim().slice(0, 200) || null
        if ('image_url' in body) {
          // uploaded media only — never an arbitrary URL pasted into the page
          const url = String(body.image_url ?? '').trim().slice(0, 2000)
          if (url && !url.startsWith('https://')) {
            return NextResponse.json({ error: 'Image must be an uploaded file' }, { status: 422 })
          }
          patch.image_url = url || null
        }
        // which mailbox delivers it — null means the first free one takes it
        if ('resource_id' in body) patch.resource_id = body.resource_id || null
        if ('requires_payment' in body) patch.requires_payment = body.requires_payment === true
        if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
        const { data, error } = await supabase.from('booking_services').update(patch).eq('id', body.id).select().single()
        if (error) throw new Error(error.message)
        return NextResponse.json({ service: data })
      }
      case 'delete_service': {
        const { error } = await supabase.from('booking_services').delete().eq('id', body.id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }
      case 'create_resource': {
        const label = String(body.label ?? '').trim().slice(0, 120)
        if (!label) return NextResponse.json({ error: 'Name the resource' }, { status: 422 })
        const { data, error } = await supabase.from('booking_resources')
          .insert({ label, email: String(body.email ?? '').trim().slice(0, 200) || null, timezone: String(body.timezone ?? 'Australia/Melbourne') })
          .select().single()
        if (error) return NextResponse.json({ error: 'Run supabase/booking.sql first' }, { status: 400 })
        return NextResponse.json({ resource: data })
      }
      case 'update_resource': {
        const patch: Record<string, unknown> = {}
        if ('label' in body) patch.label = String(body.label).trim().slice(0, 120)
        if ('email' in body) patch.email = String(body.email ?? '').trim().slice(0, 200) || null
        if ('active' in body) patch.active = body.active !== false
        const { data, error } = await supabase.from('booking_resources').update(patch).eq('id', body.id).select().single()
        if (error) throw new Error(error.message)
        return NextResponse.json({ resource: data })
      }
      case 'delete_resource': {
        const { error } = await supabase.from('booking_resources').delete().eq('id', body.id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }
      case 'set_availability': {
        // replace the whole weekly grid for a resource in one atomic-ish swap
        const resourceId = String(body.resource_id ?? '')
        if (!resourceId) return NextResponse.json({ error: 'resource_id required' }, { status: 400 })
        const rows = (Array.isArray(body.windows) ? body.windows : [])
          .map((w: { weekday: number; start_min: number; end_min: number }) => ({
            resource_id: resourceId,
            weekday: Math.min(6, Math.max(0, Math.round(Number(w.weekday)))),
            start_min: Math.min(1440, Math.max(0, Math.round(Number(w.start_min)))),
            end_min: Math.min(1440, Math.max(0, Math.round(Number(w.end_min)))),
          }))
          .filter((w: { start_min: number; end_min: number }) => w.end_min > w.start_min)
          .slice(0, 100)
        await supabase.from('booking_availability').delete().eq('resource_id', resourceId)
        if (rows.length) {
          const { error } = await supabase.from('booking_availability').insert(rows)
          if (error) throw new Error(error.message)
        }
        return NextResponse.json({ ok: true, count: rows.length })
      }
      case 'add_blackout': {
        const { error } = await supabase.from('booking_blackouts')
          .insert({ resource_id: body.resource_id, day: body.day, reason: String(body.reason ?? '').slice(0, 200) || null })
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }
      case 'remove_blackout': {
        const { error } = await supabase.from('booking_blackouts').delete().eq('id', body.id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }
      case 'cancel_booking': {
        const { data, error } = await supabase.from('bookings')
          .update({ status: 'cancelled' }).eq('id', body.id).select().single()
        if (error) throw new Error(error.message)
        void user
        return NextResponse.json({ booking: data })
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
