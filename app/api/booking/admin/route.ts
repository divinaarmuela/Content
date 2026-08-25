import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse, AuthzError } from '../../../lib/authz'
import { notifyBookingChanged } from '../../../lib/booking-notify'

/**
 * Dashboard booking config + management — services, bookable resources,
 * weekly availability, blackout days, and the booking list. One route: GET
 * returns everything, POST carries an `action`. Everything degrades to empty
 * until supabase/booking.sql has run.
 *
 * Access is a NAMED list, not a role: the shared mailboxes and Martin own
 * bookings, so /dashboard/bookings is a grant-only page. Hiding the nav item
 * is presentation — this is where it is actually enforced.
 */

async function requireBookingsAccess() {
  const user = await requireRole('account_manager')
  const { data } = await supabase.from('user_page_access')
    .select('hidden').eq('team_user_id', user.id).eq('href', '/dashboard/bookings').maybeSingle()
  if (!data || data.hidden) {
    throw new AuthzError('Bookings is limited to the people who run it', 403)
  }
  return user
}

/** Tell the customer (and the team) that staff moved or cancelled it. */
function notifyStaffChange(row: Record<string, unknown>, previousStart: string, cancelled: boolean) {
  const svc = row.booking_services as { name?: string; duration_min?: number } | null
  const res = row.booking_resources as { id?: string; label?: string; timezone?: string } | null
  if (!svc || !res?.id) return
  void notifyBookingChanged({
    booking: {
      id: String(row.id), start_at: String(row.start_at),
      public_ref: (row.public_ref as string | null) ?? null,
      customer_name: String(row.customer_name ?? ''),
      customer_email: String(row.customer_email ?? ''),
    },
    service: { name: svc.name ?? 'Booking', duration_min: svc.duration_min ?? 60 },
    resource: { id: res.id, label: res.label ?? 'Studio', timezone: res.timezone ?? 'Australia/Melbourne' },
    previousStart,
    cancelled,
  }).catch(e => console.error('staff booking change notify:', e))
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'service'

export async function GET() {
  try {
    await requireBookingsAccess()
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
    const user = await requireBookingsAccess()
    const body = await req.json()
    const action = String(body.action ?? '')

    switch (action) {
      case 'create_service': {
        const name = String(body.name ?? '').trim().slice(0, 120)
        if (!name) return NextResponse.json({ error: 'Name the service' }, { status: 422 })
        const duration = Math.min(1440, Math.max(5, Math.round(Number(body.duration_min) || 30)))
        const price = Math.max(0, Math.round(Number(body.price_cents) || 0))
        // a new service belongs at the END of the list. Left at the default
        // 0 it sorts above everything, so it appeared at the top and read as
        // if it had picked up some other row's details.
        const { data: last } = await supabase.from('booking_services')
          .select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
        const nextOrder = (last?.sort_order ?? 0) + 1
        const { data, error } = await supabase.from('booking_services')
          .insert({
            name, slug: slugify(body.slug || name),
            description: String(body.description ?? '').slice(0, 1000) || null,
            duration_min: duration, price_cents: price, sort_order: nextOrder,
          })
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
        if ('category' in body) patch.category = String(body.category ?? '').trim().slice(0, 120) || null
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
        // how far ahead people may book, and how much notice we need
        if ('horizon_days' in body) {
          patch.horizon_days = Math.min(365, Math.max(1, Math.round(Number(body.horizon_days) || 60)))
        }
        if ('lead_time_min' in body) {
          patch.lead_time_min = Math.min(43200, Math.max(0, Math.round(Number(body.lead_time_min) || 0)))
        }
        if ('capacity' in body) {
          patch.capacity = Math.min(500, Math.max(1, Math.round(Number(body.capacity) || 1)))
        }
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
        // optimistic guard: only a live booking cancels, and exactly once
        const { data, error } = await supabase.from('bookings')
          .update({ status: 'cancelled' })
          .eq('id', body.id).neq('status', 'cancelled')
          .select('*, booking_services(name, duration_min), booking_resources(id, label, timezone)')
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!data) return NextResponse.json({ error: 'That booking is already cancelled' }, { status: 409 })
        void user
        notifyStaffChange(data, data.start_at as string, true)
        return NextResponse.json({ booking: data })
      }

      /**
       * Move a booking from the dashboard.
       *
       * Race safety is the same as everywhere else: an optimistic guard means
       * only a still-live booking moves, and the unique seat index refuses a
       * time that someone else already holds — never a read-then-write.
       */
      case 'reschedule_booking': {
        const id = String(body.id ?? '')
        const startISO = String(body.start_at ?? '')
        const when = new Date(startISO)
        if (!id || Number.isNaN(when.getTime())) {
          return NextResponse.json({ error: 'Pick a new date and time' }, { status: 422 })
        }

        const { data: current } = await supabase.from('bookings')
          .select('*, booking_services(name, duration_min), booking_resources(id, label, timezone)')
          .eq('id', id).maybeSingle()
        if (!current) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        if (current.status === 'cancelled') {
          return NextResponse.json({ error: 'That booking is cancelled' }, { status: 409 })
        }

        const previousStart = current.start_at as string
        const mins = (current.booking_services as { duration_min?: number } | null)?.duration_min ?? 60
        const endAt = new Date(when.getTime() + mins * 60_000)

        const { data: moved, error } = await supabase.from('bookings')
          .update({ start_at: when.toISOString(), end_at: endAt.toISOString() })
          .eq('id', id).neq('status', 'cancelled')
          .select('*, booking_services(name, duration_min), booking_resources(id, label, timezone)')
          .maybeSingle()
        if (error) {
          if (/duplicate key|23505|23P01|bookings_no_overlap|exclusion/.test(error.message)) {
            return NextResponse.json({ error: 'That time is already taken' }, { status: 409 })
          }
          throw new Error(error.message)
        }
        if (!moved) return NextResponse.json({ error: 'That booking is no longer live' }, { status: 409 })

        // the person who booked hears about it, not just the team
        notifyStaffChange(moved, previousStart, false)
        return NextResponse.json({ booking: moved })
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
