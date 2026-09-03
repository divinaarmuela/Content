import { NextResponse } from 'next/server'
import { table, encodeKey, DbError, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  Booking, BookingAvailability, BookingBlackout, BookingResource, BookingService,
  UserPageAccess,
} from '@/lib/db-types'
import { seatIsFree, spaceForResource } from '../../../lib/booking'
import { requireRole, authzErrorResponse, AuthzError } from '../../../lib/authz'
import { notifyBookingChanged } from '../../../lib/booking-notify'

/**
 * Dashboard booking config + management — services, bookable resources,
 * weekly availability, blackout days, and the booking list. One route: GET
 * returns everything, POST carries an `action`. Everything degrades to empty
 * until the booking tables hold anything.
 *
 * Access is a NAMED list, not a role: the shared mailboxes and Martin own
 * bookings, so /dashboard/bookings is a grant-only page. Hiding the nav item
 * is presentation — this is where it is actually enforced.
 */

async function requireBookingsAccess() {
  const user = await requireRole('account_manager')
  // the row's id IS (team_user_id, href) — one grant per person per page
  const data = await table<UserPageAccess & { hidden?: boolean }>('user_page_access')
    .get(`${user.id}__${encodeKey('/dashboard/bookings')}`)
    .catch(() => null)
  if (!data || data.hidden) {
    throw new AuthzError('Bookings is limited to the people who run it', 403)
  }
  return user
}

/** The two embeds every booking row carries back to the dashboard. */
async function withNames<T extends { service_id: string | null; resource_id: string }>(rows: T[]) {
  return await attachOne(
    await attachOne(rows, 'service_id', 'booking_services', ['name', 'duration_min']),
    'resource_id', 'booking_resources', ['id', 'label', 'timezone'],
  )
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
  return withRequestCache(async () => {
    try {
      await requireBookingsAccess()
      // a read that fails at all (nothing migrated yet) → empty, with a flag
      let missing = false
      const services = await table<BookingService>('booking_services')
        .list({ orderBy: [['sort_order', 'asc'], ['name', 'asc']] })
        .catch(() => { missing = true; return [] })
      const [resources, availability, blackouts, bookings] = await Promise.all([
        table<BookingResource>('booking_resources').list({ orderBy: [['label', 'asc']] }).catch(() => []),
        table<BookingAvailability>('booking_availability').list().catch(() => []),
        table<BookingBlackout>('booking_blackouts').list({ orderBy: [['day', 'asc']] }).catch(() => []),
        table<Booking>('bookings')
          .list({ orderBy: [['start_at', 'desc']], limit: 200 })
          .then(withNames)
          .catch(() => []),
      ])
      return NextResponse.json({
        needs_schema: missing,
        services,
        resources,
        availability,
        blackouts,
        bookings,
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
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
          const last = await table<BookingService>('booking_services')
            .list({ orderBy: [['sort_order', 'desc']], limit: 1 })
            .then(r => r[0] ?? null)
          const nextOrder = (last?.sort_order ?? 0) + 1
          try {
            // the columns Postgres defaulted, minted here: an inactive-by-
            // omission service would vanish from the public page
            const data = await table('booking_services').insert({
              name, slug: slugify(body.slug || name),
              description: String(body.description ?? '').slice(0, 1000) || null,
              duration_min: duration, price_cents: price, sort_order: nextOrder,
              currency: 'AUD', active: true,
            })
            return NextResponse.json({ service: data })
          } catch (e) {
            return NextResponse.json({
              error: e instanceof DbError && e.code === 'unique'
                ? 'A service with that name/slug already exists'
                : 'Run supabase/booking.sql first',
            }, { status: 400 })
          }
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
          const data = await table('booking_services').update(String(body.id), patch)
          return NextResponse.json({ service: data })
        }
        case 'delete_service': {
          await table('booking_services').remove(String(body.id))
          return NextResponse.json({ ok: true })
        }
        case 'create_resource': {
          const label = String(body.label ?? '').trim().slice(0, 120)
          if (!label) return NextResponse.json({ error: 'Name the resource' }, { status: 422 })
          try {
            const data = await table('booking_resources').insert({
              label,
              email: String(body.email ?? '').trim().slice(0, 200) || null,
              timezone: String(body.timezone ?? 'Australia/Melbourne'),
              // Postgres defaulted this, and a resource that is not active is
              // never offered a slot
              active: true,
            })
            return NextResponse.json({ resource: data })
          } catch {
            return NextResponse.json({ error: 'Run supabase/booking.sql first' }, { status: 400 })
          }
        }
        case 'update_resource': {
          const patch: Record<string, unknown> = {}
          if ('label' in body) patch.label = String(body.label).trim().slice(0, 120)
          if ('email' in body) patch.email = String(body.email ?? '').trim().slice(0, 200) || null
          if ('active' in body) patch.active = body.active !== false
          const data = await table('booking_resources').update(String(body.id), patch)
          return NextResponse.json({ resource: data })
        }
        case 'delete_resource': {
          await table('booking_resources').remove(String(body.id))
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
          await table<BookingAvailability>('booking_availability')
            .removeWhere(r => r.resource_id === resourceId)
          for (const row of rows) await table('booking_availability').insert(row)
          return NextResponse.json({ ok: true, count: rows.length })
        }
        case 'add_blackout': {
          const day = String(body.day ?? '')
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Pick a date')
          const resourceId = String(body.resource_id ?? '')
          if (!resourceId) throw new Error('Pick a room')
          // Closing the same day twice is not an error and must not leave two
          // rows: replace rather than insert. Two people doing it at once land
          // on the same result, so there is nothing to race over.
          await table<BookingBlackout>('booking_blackouts')
            .removeWhere(r => r.resource_id === resourceId && r.day === day)
          await table('booking_blackouts').insert({
            resource_id: resourceId, day,
            reason: String(body.reason ?? '').trim().slice(0, 200) || null,
          })
          return NextResponse.json({ ok: true })
        }
        case 'remove_blackout': {
          // a room can hold several names, so re-opening a day may clear more
          // than one row — the caller sends every id it is undoing
          const ids = Array.isArray(body.ids) ? body.ids.map(String) : [String(body.id ?? '')]
          const clean: string[] = ids.filter(Boolean)
          if (clean.length === 0) throw new Error('Nothing to reopen')
          await table<BookingBlackout>('booking_blackouts').removeWhere(r => clean.includes(r.id))
          return NextResponse.json({ ok: true })
        }
        case 'cancel_booking': {
          // only a live booking cancels, and exactly once — the state is
          // re-read immediately before the write rather than guarded by it
          const live = await table<Booking>('bookings').get(String(body.id))
          if (!live || live.status === 'cancelled') {
            return NextResponse.json({ error: 'That booking is already cancelled' }, { status: 409 })
          }
          const updated = await table<Booking>('bookings').update(live.id, { status: 'cancelled' })
          const data = (await withNames([updated ?? live]))[0]
          void user
          notifyStaffChange(data as unknown as Record<string, unknown>, data.start_at, true)
          return NextResponse.json({ booking: data })
        }

        /**
         * Move a booking from the dashboard.
         *
         * The seat rule is the port of `bookings_no_overlap`: the seat this
         * booking holds must be free at the new time, and the booking itself
         * must still be live when the write lands.
         */
        case 'reschedule_booking': {
          const id = String(body.id ?? '')
          const startISO = String(body.start_at ?? '')
          const when = new Date(startISO)
          if (!id || Number.isNaN(when.getTime())) {
            return NextResponse.json({ error: 'Pick a new date and time' }, { status: 422 })
          }

          const found = await table<Booking>('bookings').get(id)
          if (!found) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
          const current = (await withNames([found]))[0]
          if (current.status === 'cancelled') {
            return NextResponse.json({ error: 'That booking is cancelled' }, { status: 409 })
          }

          const previousStart = current.start_at
          const mins = (current.booking_services as { duration_min?: number } | null)?.duration_min ?? 60
          const endAt = new Date(when.getTime() + mins * 60_000)

          const free = await seatIsFree({
            spaceId: found.space_id ?? await spaceForResource(found.resource_id),
            seatNo: found.seat_no ?? 1,
            startAt: when.toISOString(),
            endAt: endAt.toISOString(),
            excludeId: found.id,
          })
          if (!free) {
            return NextResponse.json({ error: 'That time is already taken' }, { status: 409 })
          }
          const live = await table<Booking>('bookings').get(id)
          if (!live || live.status === 'cancelled') {
            return NextResponse.json({ error: 'That booking is no longer live' }, { status: 409 })
          }
          const updated = await table<Booking>('bookings')
            .update(id, { start_at: when.toISOString(), end_at: endAt.toISOString() })
          if (!updated) return NextResponse.json({ error: 'That booking is no longer live' }, { status: 409 })
          const moved = (await withNames([updated]))[0]

          // the person who booked hears about it, not just the team
          notifyStaffChange(moved as unknown as Record<string, unknown>, previousStart, false)
          return NextResponse.json({ booking: moved })
        }
        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
      }
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
