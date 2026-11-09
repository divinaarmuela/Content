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
  kind: 'booked' | 'cancelled'
  inviteeUri: string
  email: string
  fname: string | null
  lname: string | null
  phone: string | null
  event: string | null
  startsAt: string | null
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
  const kind = j.event === 'invitee.created' ? 'booked' : j.event === 'invitee.canceled' ? 'cancelled' : null
  const p = (j.payload ?? {}) as Record<string, any>
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
    event: str(ev.name, 200), startsAt: str(ev.start_time, 40),
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
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : path
}

/** Meta's placement codes in plain words (Facebook_Mobile_Feed → Facebook mobile feed) */
export function placementLabel(p: string | null | undefined): string | null {
  return p ? p.split('_').join(' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : null
}

/** what the Leads page Status chip says */
export function leadStatus(l: { booking_status?: string | null; stage?: string | null; source?: string | null }, stageLabel: (k: string) => string): string {
  if (l.booking_status === 'cancelled') return 'Cancelled'
  if (l.booking_status === 'booked' && (!l.stage || l.stage === 'new' || l.stage === 'qualified')) return 'Call booked'
  // "New lead" is the website form's word alone (owner, 9 Nov 2026); a lead the inbox scanner found says so
  if ((!l.stage || l.stage === 'new') && l.source && l.source !== 'web_form') return l.source === 'email_ingest' || l.source === 'email' ? 'Emailed in' : 'New lead'
  if (!l.stage || l.stage === 'new') return 'New lead'
  return stageLabel(l.stage)
}

type Existing = { model?: string | null; budget?: string | null; need?: string | null; fname?: string | null; lname?: string | null; phone?: string | null; stage?: string | null; source?: string | null; ad_campaign?: string | null }

/** the lead fields a booking writes. Existing name/phone are kept unless empty; status always follows the booking. */
export function bookingPatch(b: Booking, existing: Existing | null, nowIso: string): Record<string, unknown> {
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
