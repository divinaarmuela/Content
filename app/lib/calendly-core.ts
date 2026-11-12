import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * CALENDLY → LEADS, the pure half (9 Nov 2026). The I/O half is calendly.ts, the door is /api/calendly/webhook.
 * Owner: "ensure user name, number all updated in the leads page and status" and "new lead is only when they
 * fill out the form" — so a booking is "Call booked" from its first moment, a cancellation "Cancelled", and
 * "New lead" belongs to the website form alone.
 *
 * Calendly's v2 webhook body: { event: 'invitee.created' | 'invitee.canceled', payload: { uri, email, name,
 * first_name, last_name, text_reminder_number, questions_and_answers[], tracking{utm_*}, scheduled_event{name,
 * start_time} } }, signed in the Calendly-Webhook-Signature header as `t=<unix>,v1=<hex hmac-sha256 of "t.body">`.
 *
 * AD DETAILS (owner: "will we have the ad name ad placement ad set etc", "campaign name"). Calendly only carries the
 * five utm tags, so every Meta ad's URL parameters must be set to META_URL_PARAMS — Meta fills the {{…}} itself:
 *   utm_source = where it showed (fb / ig / msg / an)   utm_medium = placement
 *   utm_campaign = campaign name   utm_term = ad set name   utm_content = ad name
 */
export const META_URL_PARAMS =
  'utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}'

export type Utm = { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null }

export type Booking = {
  kind: 'booked' | 'cancelled' | 'no_show' | 'showed'
  inviteeUri: string
  email: string
  fname: string | null
  lname: string | null
  phone: string | null
  event: string | null
  startsAt: string | null
  /** when the call ends (Calendly's scheduled_event.end_time) — for the calendar invitation */
  endsAt?: string | null
  utm: Utm
  /** the site page the Book button was on (utm-core PAGE_PARAM) */
  page: string | null
  /** the booking form's answers: "Which service" → service, the budget question → budget, the rest → notes */
  service: string | null
  budget: string | null
  notes: string | null
}

const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** the signing key we hand Calendly when subscribing — derived from MD_SECRET, so no extra secret to keep */
export function signingKey(secret: string): string {
  return createHmac('sha256', secret).update('calendly-webhook-v1').digest('hex')
}

/** true only for a correctly signed body no older than `toleranceSec` */
export function verifySignature(header: string | null, body: string, key: string, nowMs: number, toleranceSec = 600): boolean {
  if (!header) return false
  const parts: Record<string, string> = {}
  for (const p of header.split(',')) { const i = p.indexOf('='); if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim() }
  const t = Number(parts.t); const v1 = parts.v1
  if (!Number.isFinite(t) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false
  const want = createHmac('sha256', key).update(`${parts.t}.${body}`).digest()
  const got = Buffer.from(v1, 'hex')
  return got.length === want.length && timingSafeEqual(got, want)
}

function phoneFrom(p: Record<string, any>): string | null {
  const direct = str(p.text_reminder_number, 40)
  if (direct) return direct
  // a "phone call" event: the number the invitee typed is the call's location, not a question (live, 9 Nov 2026)
  const loc = p.scheduled_event?.location
  const where = str(loc?.location, 40)
  if (where && (loc?.type === 'outbound_call' || loc?.type === 'inbound_call' || /^\+?[\d\s()-]{6,}$/.test(where))) return where
  const qa: any[] = Array.isArray(p.questions_and_answers) ? p.questions_and_answers : []
  const hit = qa.find(q => /phone|mobile|number|contact/i.test(String(q?.question ?? '')) && String(q?.answer ?? '').replace(/\D/g, '').length >= 6)
  return hit ? str(hit.answer, 40) : null
}

/** the webhook body → a Booking; null for any other event or a body missing the invitee's email */
export function parseBooking(json: unknown): Booking | null {
  const j = (json ?? {}) as Record<string, any>
  const kind = j.event === 'invitee.created' ? 'booked' : j.event === 'invitee.canceled' ? 'cancelled'
    : j.event === 'invitee_no_show.created' ? 'no_show' : j.event === 'invitee_no_show.deleted' ? 'showed' : null
  let p = (j.payload ?? {}) as Record<string, any>
  // a no-show body is the mark itself; the person is under payload.invitee (an object, or only its uri)
  if (kind === 'no_show' || kind === 'showed') {
    const inv = p.invitee
    p = typeof inv === 'object' && inv
      ? { ...inv, uri: inv.uri ?? p.invitee_uri, email: inv.email ?? 'unknown@no-show.invalid' }
      : { uri: typeof inv === 'string' ? inv : p.invitee_uri, email: 'unknown@no-show.invalid' }
  }
  const email = str(p.email, 200)?.toLowerCase() ?? null
  const inviteeUri = str(p.uri, 500)
  if (!kind || !email || !inviteeUri || !email.includes('@')) return null
  let fname = str(p.first_name, 100); let lname = str(p.last_name, 100)
  if (!fname && !lname) {
    const parts = (str(p.name, 200) ?? '').split(/\s+/).filter(Boolean)
    fname = parts.shift() ?? null; lname = parts.length ? parts.join(' ') : null
  }
  const ev = (p.scheduled_event ?? {}) as Record<string, any>
  const tr = (p.tracking ?? {}) as Record<string, any>
  const qa: any[] = Array.isArray(p.questions_and_answers) ? p.questions_and_answers : []
  let service: string | null = null; let budget: string | null = null; const rest: string[] = []
  for (const q of qa) {
    const question = str(q?.question, 300); const answer = str(q?.answer, 2000)
    if (!question || !answer) continue
    if (/phone|mobile/i.test(question)) continue
    if (!service && /service/i.test(question)) { service = answer.slice(0, 300); continue }
    if (!budget && /budget/i.test(question)) { budget = answer.slice(0, 300); continue }
    rest.push(`${question}\n${answer}`)
  }
  return {
    page: (() => { const v = str(tr.salesforce_uuid, 200); return v && v.startsWith('/') ? v : null })(),
    service, budget, notes: rest.length ? rest.join('\n\n').slice(0, 8000) : null,
    kind, inviteeUri, email, fname, lname, phone: phoneFrom(p),
    event: str(ev.name, 200), startsAt: str(ev.start_time, 40), endsAt: str(ev.end_time, 40),
    utm: { source: str(tr.utm_source, 200), medium: str(tr.utm_medium, 200), campaign: str(tr.utm_campaign, 200), term: str(tr.utm_term, 200), content: str(tr.utm_content, 200) },
  }
}

const NAMED: Record<string, string> = {
  web_form: 'Website form', website: 'Website', email_ingest: 'Email', facebook: 'Facebook', fb: 'Facebook', instagram: 'Instagram', ig: 'Instagram',
  msg: 'Messenger', an: 'Audience Network', google: 'Google', email: 'Email', 'lead-email': 'Email', tiktok: 'TikTok',
  linkedin: 'LinkedIn', calendly: 'Calendly', referral: 'Referral',
}

/** a plain "where they came from": Facebook · nov-sale, Website form, Instagram … */
export function sourceLabel(source: string | null | undefined, sourceTag?: string | null): string {
  const s = (source ?? '').toLowerCase()
  const base = NAMED[s] ?? (s ? s.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase()) : 'Unknown')
  return sourceTag ? `${base} · ${sourceTag}` : base
}

/** a page path in plain words: / → Home, /campaign-shoots → Campaign shoots */
export function pageLabel(path: string | null | undefined): string | null {
  if (!path) return null
  if (path === '/') return 'Home'
  const last = path.split('?')[0].split('/').filter(Boolean).pop() ?? ''
  const w = last.split('-').join(' ')
  if (!w) return path
  const name = w.charAt(0).toUpperCase() + w.slice(1)
  // the ad-only /landing pages share their names with the menu pages: say which one (owner, 11 Nov 2026)
  return path.startsWith('/landing/') ? `${name} (ad page)` : name
}

/** Meta's placement codes in plain words (Facebook_Mobile_Feed → Facebook mobile feed) */
export function placementLabel(p: string | null | undefined): string | null {
  return p ? p.split('_').join(' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : null
}

/** what the Leads page Status chip says */
export function leadStatus(l: { booking_status?: string | null; stage?: string | null; source?: string | null }, stageLabel: (k: string) => string): string {
  if (l.booking_status === 'cancelled') return 'Cancelled'
  if (l.booking_status === 'no_show') return 'Missed call'
  if (l.booking_status === 'booked' && (!l.stage || l.stage === 'new' || l.stage === 'qualified')) return 'Call booked'
  // "New lead" is the website form's word alone (owner, 9 Nov 2026); a lead the inbox scanner found says so
  if ((!l.stage || l.stage === 'new') && l.source && l.source !== 'web_form') return l.source === 'email_ingest' || l.source === 'email' ? 'Emailed in' : 'New lead'
  if (!l.stage || l.stage === 'new') return 'New lead'
  return stageLabel(l.stage)
}

type Existing = { model?: string | null; budget?: string | null; need?: string | null; fname?: string | null; lname?: string | null; phone?: string | null; stage?: string | null; source?: string | null; ad_campaign?: string | null }

/** the lead fields a booking writes. Existing name/phone are kept unless empty; status always follows the booking. */
export function bookingPatch(b: Booking, existing: Existing | null, nowIso: string): Record<string, unknown> {
  if (b.kind === 'no_show' || b.kind === 'showed') return { booking_status: b.kind === 'no_show' ? 'no_show' : 'booked' }
  const patch: Record<string, unknown> = {
    booking_status: b.kind, booking_uri: b.inviteeUri,
    fname: existing?.fname || b.fname, lname: existing?.lname || b.lname, phone: existing?.phone || b.phone,
  }
  if (b.event) patch.booking_event = b.event
  if (b.page) patch.booked_from = b.page
  // what they typed into the booking form; a form lead's own answers are never overwritten
  if (b.service && !existing?.model) patch.model = b.service
  if (b.budget && !existing?.budget) patch.budget = b.budget
  if (b.notes) patch.need = existing?.need ? (existing.need.includes(b.notes) ? existing.need : `${existing.need}\n\nFrom the Calendly booking:\n${b.notes}`) : b.notes
  if (b.kind === 'booked') {
    patch.call_at = b.startsAt
    if (!existing?.stage || existing.stage === 'new') { patch.stage = 'qualified'; patch.stage_entered_at = nowIso }
  }
  // "website" is our own button's default; anything else came from an ad or a tagged link
  const fromAd = !!b.utm.source && b.utm.source !== 'website'
  if (!existing) {
    patch.source = b.utm.source ?? 'calendly'
    patch.source_tag = b.utm.campaign
  } else if (fromAd && (!existing.source || existing.source === 'website' || existing.source === 'calendly')) {
    patch.source = b.utm.source; patch.source_tag = b.utm.campaign
  }
  if (fromAd && !existing?.ad_campaign) {
    patch.ad_campaign = b.utm.campaign; patch.ad_set = b.utm.term; patch.ad_name = b.utm.content; patch.ad_placement = b.utm.medium
  }
  return patch
}

/* ── A BOOKING'S DETAILS, BY EMAIL (the owner, 12 Nov 2026) ─────────────────────────────────────────────────────────
 * "info should only see this in their calendar but not the questions' answers … those are only for contact and
 * hello." The calendar entry Calendly writes carries no answers any more, and Calendly's own automation email never
 * arrived (searched contact@'s mail, every folder), so the app sends the details itself: it already receives every
 * booking, answers included, on the webhook. */

/**
 * Who the APP emails a new booking's details and answers to — NOBODY (the owner, 13 Nov 2026: "i am receiving three
 * different emails for one booking, keep only one and not from our app"). Calendly's own emails never arrived on 12 Nov
 * because the domain's mail records were not being served; once they were, Calendly's "New Event" email (contact@) and
 * its automation email (hello@) both arrive, so the app's copy was the third. The code stays for the day it is wanted
 * again: add an address here and it sends. Never info@, which only sees the calendar entry.
 */
export const BOOKING_DETAILS_TO: readonly string[] = []

/** the last part of Calendly's invitee uri: one id per booking, so one email per booking however often it retries */
export function inviteeId(uri: string): string {
  return uri.split('/').filter(Boolean).pop() ?? uri
}

export type BookingDetails = {
  subject: string; rows: [label: string, value: string][]; answers: string | null
  /** the entry the invitation puts in hello@'s and contact@'s own calendars (never the answers) — null when Calendly gave no time */
  calendar: { uid: string; title: string; startsAt: string; endsAt: string; note: string } | null
}

/** What the details email says. Null for anything but a new booking. `when` is the call's time in plain words. */
export function bookingDetails(b: Booking, when: string | null): BookingDetails | null {
  if (b.kind !== 'booked') return null
  const name = [b.fname, b.lname].filter(Boolean).join(' ') || b.email
  const call = b.event ?? 'A call'
  const rows: [string, string][] = [['Call', call]]
  if (when) rows.push(['When', when])
  rows.push(['Name', name], ['Email', b.email])
  if (b.phone) rows.push(['Phone', b.phone])
  if (b.service) rows.push(['Service', b.service])
  if (b.budget) rows.push(['Budget', b.budget])
  const start = b.startsAt && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt) : null
  const end = b.endsAt && !Number.isNaN(Date.parse(b.endsAt)) ? new Date(b.endsAt) : start ? new Date(start.getTime() + 10 * 60_000) : null
  const NL = String.fromCharCode(10)
  // NO ANSWERS IN THE CALENDAR ENTRY (the owner: "how about the questions going into info?"): hello@'s calendar is one
  // info@ can open, so the entry carries only who to ring — the service, budget and answers stay in the email
  const note = [...rows.filter(([k]) => k === 'Name' || k === 'Phone' || k === 'Email').map(([k, v]) => `${k}: ${v}`), '', 'Their answers are in the email "' + `New call booked: ${name} (${call})` + '".'].join(NL)
  return {
    subject: `New call booked: ${name} (${call})`, rows, answers: b.notes,
    calendar: start && end ? { uid: `call-${inviteeId(b.inviteeUri)}`, title: `${call}: ${name}`, startsAt: start.toISOString(), endsAt: end.toISOString(), note } : null,
  }
}

/* ── THE TIME BLOCK, AND TAKING IT BACK (the owner, 12 Nov 2026: "info as well, their calendar needs to show that time
 * block so that they don't book anything") ──────────────────────────────────────────────────────────────────────────
 * info@ gets the call in its own calendar as a bare block: the call's name and its time, nothing about the person.
 * And a cancelled call comes OFF every calendar the app put it in — an invitation nobody withdraws would block the
 * time for ever. */

/** who gets only the time block — no name, no number, no answers */
export const BOOKING_BLOCK_TO: readonly string[] = ['info@mdmmarketing.com.au']

export type BookingSlot = { title: string; startsAt: string; endsAt: string }

/** The call's place on a calendar, for a booking or its cancellation; null when Calendly gave no start time. */
export function bookingSlot(b: Booking): BookingSlot | null {
  const start = b.startsAt && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt) : null
  if (!start) return null
  const end = b.endsAt && !Number.isNaN(Date.parse(b.endsAt)) ? new Date(b.endsAt) : new Date(start.getTime() + 10 * 60_000)
  return { title: b.event ?? 'Call', startsAt: start.toISOString(), endsAt: end.toISOString() }
}

/** the calendar ids of one booking: the entry with a name on it (hello@, contact@) and the bare block (info@) */
export function bookingUids(b: Booking): { details: string; block: string } {
  const id = inviteeId(b.inviteeUri)
  return { details: `call-${id}`, block: `call-${id}-block` }
}

const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/**
 * A calendar invitation (REQUEST) or its withdrawal (CANCEL) for ONE person. The same uid with a later SEQUENCE and
 * METHOD:CANCEL is what makes a calendar take the entry away again.
 */
export function bookingIcs(p: {
  method: 'REQUEST' | 'CANCEL'; uid: string; title: string; startsAt: string; endsAt: string
  note?: string | null; organizerEmail: string; attendeeEmail: string; stamp?: string
}): string {
  const cancel = p.method === 'CANCEL'
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MD Media//Booked Calls//EN', `METHOD:${p.method}`,
    'BEGIN:VEVENT',
    `UID:${p.uid}@mdmmarketing.com.au`,
    `DTSTAMP:${icsTime(p.stamp ?? new Date().toISOString())}`,
    `DTSTART:${icsTime(p.startsAt)}`,
    `DTEND:${icsTime(p.endsAt)}`,
    `SUMMARY:${icsText(p.title)}`,
    ...(p.note ? [`DESCRIPTION:${icsText(p.note)}`] : []),
    `ORGANIZER;CN=MD Media:mailto:${p.organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=${cancel ? 'NEEDS-ACTION' : 'ACCEPTED'}:mailto:${p.attendeeEmail}`,
    `SEQUENCE:${cancel ? 1 : 0}`,
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}
