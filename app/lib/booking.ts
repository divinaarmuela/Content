import 'server-only'
import { supabase } from '@/lib/supabase'
import { openSlots, minToLabel, zonedToUtc, utcToZoned, weekdayOf } from './booking-core'

/**
 * The booking read layer: turns a resource's weekly opening hours into real,
 * bookable instants for the public page.
 *
 * Everything the public sees passes through here, so it is also the place
 * that decides what a stranger may learn: service name, duration, price and
 * free times — never a resource's email, never another customer's booking.
 */

export type PublicService = {
  id: string
  name: string
  slug: string
  description: string | null
  duration_min: number
  price_cents: number
  currency: string
  lead_time_min: number
  horizon_days: number
  requires_payment: boolean
  resource_id: string | null
  /** seats per slot: 1 = private hire, >1 = an event */
  capacity: number
  /** hero image + where it happens — a room sells better than a paragraph */
  image_url: string | null
  location: string | null
  /** which studio it belongs to, for grouping the public list */
  category: string | null
}

export type PublicResource = { id: string; label: string; timezone: string }

export type DaySlots = {
  day: string
  slots: { min: number; label: string; resource_id: string }[]
}

const DEFAULTS = { lead_time_min: 120, horizon_days: 60 }

/** Fill in anything a newer migration adds, so a half-migrated database
 *  still serves a working booking page instead of a 404. */
function withDefaults(row: Record<string, unknown>): PublicService {
  const r = row as Partial<PublicService> & Record<string, unknown>
  return {
    ...(row as PublicService),
    lead_time_min: typeof r.lead_time_min === 'number' ? r.lead_time_min : DEFAULTS.lead_time_min,
    horizon_days: typeof r.horizon_days === 'number' ? r.horizon_days : DEFAULTS.horizon_days,
    requires_payment: r.requires_payment === true,
    capacity: typeof r.capacity === 'number' && r.capacity > 0 ? r.capacity : 1,
    image_url: (r.image_url as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    resource_id: (r.resource_id as string | null) ?? null,
  }
}

/** The service behind a public slug, plus the resources that can deliver it.
 *  Returns null for anything inactive or unknown — a stranger cannot tell a
 *  disabled service from a made-up one. */
export async function loadPublicService(
  slug: string,
): Promise<{ service: PublicService; resources: PublicResource[] } | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null
  const { data: svc } = await supabase
    .from('booking_services')
    // SELECT * on purpose: naming a column that a not-yet-run migration
    // hasn't added makes Supabase fail the WHOLE query, and the page 404s
    // rather than degrading. Nothing here is sensitive, and the public API
    // strips ids before answering.
    .select('*')
    .eq('slug', slug).eq('active', true).maybeSingle()
  if (!svc) return null

  const service = withDefaults(svc)

  let q = supabase.from('booking_resources')
    .select('id, label, timezone').eq('active', true).order('created_at')
  if (service.resource_id) q = q.eq('id', service.resource_id)
  const { data: resources } = await q
  if (!resources || resources.length === 0) return null
  return { service, resources: resources as PublicResource[] }
}

/**
 * Release slots held by a checkout nobody finished.
 *
 * An unpaid booking holds its slot so two people cannot pay for the same
 * time. Stripe expires an abandoned session and the webhook frees it — but
 * that is a promise from another system, and if it ever fails to arrive the
 * slot is held forever. This is the floor under that: any pending, unpaid
 * hold older than the checkout window is dead, whatever Stripe said.
 *
 * Idempotent and safe to run on every availability read.
 */
async function releaseStaleHolds(): Promise<void> {
  // Not a guess: the checkout session is created with a 31-minute life, so a
  // hold older than that CANNOT still be paid — the card form is already
  // dead. One extra minute covers clock skew between us and Stripe. Waiting
  // longer just keeps a bookable slot off the calendar while someone who
  // wants it is looking at it.
  const cutoff = new Date(Date.now() - 32 * 60_000).toISOString()
  await supabase.from('bookings')
    .update({ status: 'cancelled' })
    .eq('status', 'pending')
    .eq('payment_status', 'unpaid')
    .lt('created_at', cutoff)
    .then(() => {}, e => console.error('stale hold sweep failed:', e))
}

/** Add days to a plain YYYY-MM-DD without touching timezones. */
function addDays(dayISO: string, n: number): string {
  return new Date(Date.parse(`${dayISO}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Open slots per day, across every resource that can deliver the service.
 *
 * A slot is offered when at least one resource is free for it; the booking
 * call then claims a specific one. Days are the RESOURCE's local days, which
 * is why every comparison goes through the timezone helpers rather than the
 * server's own clock.
 */
export async function availabilityFor(
  service: PublicService,
  resources: PublicResource[],
  fromDay: string,
  days: number,
): Promise<DaySlots[]> {
  const span = Math.min(31, Math.max(1, Math.round(days)))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay)) return []
  // abandoned checkouts stop blocking before we decide what is free
  await releaseStaleHolds()
  const lastDay = addDays(fromDay, span - 1)
  const ids = resources.map(r => r.id)

  // one query each — never per-day, never per-resource
  const [{ data: hours }, { data: blackouts }, { data: taken }] = await Promise.all([
    supabase.from('booking_availability').select('resource_id, weekday, start_min, end_min').in('resource_id', ids),
    supabase.from('booking_blackouts').select('resource_id, day').in('resource_id', ids)
      .gte('day', fromDay).lte('day', lastDay),
    supabase.from('bookings').select('resource_id, start_at, end_at').in('resource_id', ids)
      .neq('status', 'cancelled')
      // a day either side covers resources sitting in other timezones
      .gte('start_at', `${addDays(fromDay, -1)}T00:00:00Z`)
      .lte('start_at', `${addDays(lastDay, 2)}T00:00:00Z`),
  ])

  const blocked = new Set((blackouts ?? []).map(b => `${b.resource_id}:${b.day}`))
  // What is taken, as local minute SPANS. A 2-hour session booked at 10:00
  // occupies 11:00 as well — carrying only its start time let a 1-hour
  // service be offered right through the middle of it.
  const takenBy = new Map<string, { start_min: number; end_min: number }[]>()
  for (const b of taken ?? []) {
    const res = resources.find(r => r.id === b.resource_id)
    if (!res) continue
    const startLocal = utcToZoned(new Date(b.start_at as string), res.timezone)
    const endAt = b.end_at ? new Date(b.end_at as string) : null
    const endLocal = endAt ? utcToZoned(endAt, res.timezone) : null
    // an end past midnight is clamped to the day so it still blocks the
    // evening it actually occupies
    const endMin = !endLocal
      ? startLocal.minutes + 60
      : endLocal.day === startLocal.day ? endLocal.minutes : 1440
    const key = `${b.resource_id}:${startLocal.day}`
    takenBy.set(key, [
      ...(takenBy.get(key) ?? []),
      { start_min: startLocal.minutes, end_min: Math.max(startLocal.minutes + 1, endMin) },
    ])
  }

  const now = Date.now()
  const earliest = now + service.lead_time_min * 60_000
  const horizonEnd = now + service.horizon_days * 86_400_000

  const out: DaySlots[] = []
  for (let i = 0; i < span; i++) {
    const day = addDays(fromDay, i)
    const wd = weekdayOf(day)
    if (wd === null) continue
    const bySlot = new Map<number, string>()   // minute → first free resource

    for (const res of resources) {
      if (blocked.has(`${res.id}:${day}`)) continue
      const windows = (hours ?? [])
        .filter(h => h.resource_id === res.id && h.weekday === wd)
        .map(h => ({ start_min: h.start_min as number, end_min: h.end_min as number }))
      if (windows.length === 0) continue

      for (const min of openSlots({
        windows,
        durationMin: service.duration_min,
        capacity: service.capacity,
        taken: takenBy.get(`${res.id}:${day}`) ?? [],
      })) {
        // lead time and horizon are real instants, not wall-clock guesses
        const at = zonedToUtc(day, min, res.timezone)
        if (!at) continue
        const t = at.getTime()
        if (t < earliest || t > horizonEnd) continue
        if (!bySlot.has(min)) bySlot.set(min, res.id)
      }
    }

    if (bySlot.size > 0) {
      out.push({
        day,
        slots: [...bySlot.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([min, resource_id]) => ({ min, label: minToLabel(min), resource_id })),
      })
    }
  }
  return out
}

/** Services listed on the public /events page — active, in display order. */
export async function listPublicServices(): Promise<PublicService[]> {
  const { data } = await supabase
    .from('booking_services')
    // SELECT * on purpose: naming a column that a not-yet-run migration
    // hasn't added makes Supabase fail the WHOLE query, and the page 404s
    // rather than degrading. Nothing here is sensitive, and the public API
    // strips ids before answering.
    .select('*')
    .eq('active', true)
    .order('sort_order')
  return (data ?? []).map(withDefaults)
}
