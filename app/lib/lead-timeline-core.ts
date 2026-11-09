/**
 * A LEAD'S TIMELINE, the pure half (owner, 9 Nov 2026: "make sure in the page contact we have their timeline nice ui of
 * their first time and what they have done", "like a timeline"). Newest first, like HubSpot's activity feed.
 *
 * Three sources, merged:
 *  - lead_events: what the app logged as it happened (first visit, form fill, booking, cancel) — from 9 Nov 2026 on;
 *  - email_ingest_log: every email the inbox scanner read from them;
 *  - the lead row itself, for leads older than the log: when they came in and the call they booked.
 * A logged event always wins over the one guessed from the row, so nothing shows twice.
 */
import { sourceLabel, placementLabel, pageLabel } from './calendly-core'

export type TimelineKind = 'first_visit' | 'form' | 'email' | 'booked' | 'rebooked' | 'cancelled' | 'came_in' | 'acquisition' | 'no_show' | 'showed'

export type TimelineItem = { id: string; at: string; kind: TimelineKind; title: string; detail: string | null; lines: string[] }

type EventRow = { id: string; at: string; kind: string; title: string; detail?: string | null; meta?: unknown }
type EmailRow = { id: string; received_at?: string | null; created_at?: string | null; subject?: string | null; from_email?: string | null; is_lead?: boolean | null }
type LeadRow = {
  id: string; created_at?: string | null; source?: string | null; email?: string | null
  booking_status?: string | null; booking_event?: string | null; call_at?: string | null; booked_from?: string | null
  ad_campaign?: string | null; ad_set?: string | null; ad_name?: string | null; ad_placement?: string | null
}

const KINDS = new Set<TimelineKind>(['first_visit', 'form', 'email', 'booked', 'rebooked', 'cancelled', 'came_in', 'acquisition', 'no_show', 'showed'])

/** the ad and page details, as short "Label: value" lines */
export function adLines(m: Record<string, unknown> | null | undefined): string[] {
  if (!m) return []
  const s = (k: string) => (typeof m[k] === 'string' && (m[k] as string).trim() ? (m[k] as string).trim() : null)
  const out: string[] = []
  const src = s('utm_source') ?? s('source')
  if (src) out.push(`Source: ${sourceLabel(src)}`)
  const pairs: [string, string | null][] = [
    ['Campaign', s('utm_campaign') ?? s('ad_campaign')], ['Ad set', s('utm_term') ?? s('ad_set')], ['Ad', s('utm_content') ?? s('ad_name')],
    ['Placement', placementLabel(s('utm_medium') ?? s('ad_placement'))], ['Landed on', pageLabel(s('landing'))], ['Booked from', pageLabel(s('page') ?? s('booked_from'))],
    ['Came from', s('referrer')],
  ]
  for (const [k, v] of pairs) if (v) out.push(`${k}: ${v}`)
  return out
}

export function buildTimeline(lead: LeadRow, events: readonly EventRow[], emails: readonly EmailRow[]): TimelineItem[] {
  const items: TimelineItem[] = []
  const logged = new Set<string>()
  for (const e of events) {
    const kind = (KINDS.has(e.kind as TimelineKind) ? e.kind : 'came_in') as TimelineKind
    logged.add(kind)
    items.push({ id: `ev_${e.id}`, at: e.at, kind, title: e.title, detail: e.detail ?? null, lines: adLines(e.meta as Record<string, unknown> | null) })
  }
  for (const m of emails) {
    const at = m.received_at ?? m.created_at
    if (!at) continue
    items.push({ id: `em_${m.id}`, at, kind: 'email', title: 'Emailed us', detail: m.subject ?? null, lines: [] })
  }
  // older leads: nothing was logged, so say what the row knows
  if (!logged.has('form') && !logged.has('booked') && !logged.has('came_in') && lead.created_at && !(lead.source === 'email_ingest' && emails.length)) {
    const how = lead.source === 'web_form' ? 'Filled in the website form' : lead.source === 'email_ingest' ? 'Emailed us' : `Came in · ${sourceLabel(lead.source)}`
    items.push({ id: 'row_in', at: lead.created_at, kind: lead.source === 'web_form' ? 'form' : 'came_in', title: how, detail: null, lines: adLines(lead as unknown as Record<string, unknown>) })
  }
  if (!logged.has('booked') && !logged.has('rebooked') && lead.booking_status && lead.created_at) {
    items.push({
      id: 'row_booked', at: lead.created_at, kind: lead.booking_status === 'cancelled' ? 'cancelled' : 'booked',
      title: lead.booking_status === 'cancelled' ? `Cancelled ${lead.booking_event ?? 'their call'}` : `Booked ${lead.booking_event ?? 'a call'}`,
      detail: lead.call_at ? `For ${callWords(lead.call_at)}` : null, lines: adLines(lead as unknown as Record<string, unknown>),
    })
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/** "Thu 12 Nov, 9:00 am" in Melbourne time */
export function callWords(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** the first thing they ever did — the "first time" line at the top of the page */
export function firstTouch(items: readonly TimelineItem[]): TimelineItem | null {
  return items.length ? items[items.length - 1] : null
}
