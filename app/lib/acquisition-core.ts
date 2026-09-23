/**
 * THE ACQUISITION SYSTEM — the pure half (the doc "MD Media Acquisition System
 * Dashboard — Workflow Blueprint for Akmal", read 21 Sep 2026).
 *
 * It sits BESIDE the live Leads pipeline (pipeline-core.ts, the 17 Sep doc),
 * under Leads as sub-links, and touches none of it: the owner's word was "do
 * not recode the leads page", so the blueprint is built as its own thing and
 * replaces nothing until they say so.
 *
 * The blueprint's spine, in its own words:
 *  - "Traceability first. Messaging and automation second."
 *  - "Not every researched business is a lead. A business becomes a lead only
 *    when it replies, clicks with intent, books a call or submits details."
 *  - "Keep relationship-building human" — the system prompts and reminds; a
 *    person writes and sends.
 *  - The score "is an intent score … not a guaranteed conversion percentage".
 *
 * So a PROSPECT is one business on the road from research to handoff; every
 * thing that happens to it is an EVENT on its timeline, and the score is the
 * sum of those events' points — never a bare number, so it can always be
 * explained. No I/O here.
 */

export type AcqStageKey =
  | 'target' | 'content' | 'outreach'                                   // before it is a lead
  | 'engaged' | 'qualified' | 'discovery' | 'proposal'                  // the sales road
  | 'deposit_sent' | 'deposit_paid' | 'signed' | 'handoff'              // the close

export type AcqStage = {
  key: AcqStageKey
  n: number
  label: string
  /** whose seat the stage is, in the blueprint's words */
  owner: string
  /** what the stage means */
  meaning: string
  /** the data the blueprint says to capture before it moves on */
  capture: string[]
  /** days in the stage before it is late; null = no clock (research can wait) */
  limitDays: number | null
}

export const ACQ_STAGES: readonly AcqStage[] = [
  { key: 'target', n: 1, label: 'Research target', owner: 'Manal', meaning: 'Business identified, no contact made yet', capture: ['Tier', 'Website or a social handle', 'What is weak, or the audit angle'], limitDays: null },
  { key: 'content', n: 2, label: 'Content prepared', owner: 'Divina / Martin', meaning: 'Audit angle, public content and/or private Loom prepared', capture: ['A Loom or a public post link'], limitDays: 3 },
  { key: 'outreach', n: 3, label: 'Outreach sent', owner: 'Joy', meaning: 'DM or email sent with the asset and the CTA', capture: ['When, on which channel, by whom'], limitDays: 21 },
  { key: 'engaged', n: 4, label: 'New lead / Engaged', owner: 'Joy', meaning: 'Replied, asked a question, clicked the key link or showed real interest', capture: ['What they said', 'An owner'], limitDays: 3 },
  { key: 'qualified', n: 5, label: 'Qualified / Call booked', owner: 'Joy', meaning: 'Books a discovery call or gives enough details to qualify', capture: ['The call in the calendar', 'Contact details'], limitDays: 7 },
  { key: 'discovery', n: 6, label: 'Discovery held', owner: 'Divina / Martin / Joy', meaning: 'Call happened; needs a summary, a next action and an outcome', capture: ['Notes from the call'], limitDays: 2 },
  { key: 'proposal', n: 7, label: 'Proposal sent', owner: 'Divina / Martin', meaning: 'Proposal or offer has been sent', capture: ['The proposal link', 'Its value'], limitDays: 14 },
  { key: 'deposit_sent', n: 8, label: 'Deposit sent', owner: 'Divina / Martin', meaning: 'Payment request or deposit invoice has been sent', capture: ['The invoice number or link', 'The amount'], limitDays: 7 },
  { key: 'deposit_paid', n: 9, label: 'Deposit paid', owner: 'System / owner', meaning: 'Deposit confirmed, by hand or by the scanner', capture: ['When it was paid'], limitDays: 7 },
  { key: 'signed', n: 10, label: 'Contract signed', owner: 'System / owner', meaning: 'Agreement complete — the prospect becomes a client', capture: ['When it was signed'], limitDays: 3 },
  { key: 'handoff', n: 11, label: 'Client handoff', owner: 'Account manager', meaning: 'Moved into the delivery dashboard', capture: ['The client it became'], limitDays: null },
] as const

export const ACQ_STAGE_KEYS: readonly AcqStageKey[] = ACQ_STAGES.map(s => s.key)
export const TARGET_STAGES: readonly AcqStageKey[] = ['target', 'content', 'outreach']
export const PIPELINE_STAGES: readonly AcqStageKey[] = ['engaged', 'qualified', 'discovery', 'proposal', 'deposit_sent', 'deposit_paid', 'signed', 'handoff']

export function acqStageByKey(key: string | null | undefined): AcqStage {
  return ACQ_STAGES.find(s => s.key === key) ?? ACQ_STAGES[0]
}
export function nextAcqStage(key: AcqStageKey): AcqStage | null {
  const i = ACQ_STAGES.findIndex(s => s.key === key)
  return i >= 0 && i + 1 < ACQ_STAGES.length ? ACQ_STAGES[i + 1] : null
}
export function previousAcqStage(key: AcqStageKey): AcqStage | null {
  const i = ACQ_STAGES.findIndex(s => s.key === key)
  return i > 0 ? ACQ_STAGES[i - 1] : null
}
/** "a business becomes a lead only when it replies, clicks with intent, books or submits" */
export function isLeadStage(key: string | null | undefined): boolean {
  return (PIPELINE_STAGES as readonly string[]).includes(String(key ?? ''))
}

/** Section 5: tiers. Ecommerce is the blueprint's "future / secondary" — a tag that exists, not yet a focus. */
export const ACQ_TIERS = [
  { n: 1, label: 'Service-based businesses', words: 'Finance, property, buyers advocates, advisers, investors — inquiry driven, longer decision' },
  { n: 2, label: 'Clinics and beauty', words: 'Beauty, skin, wellness, health-adjacent — booking driven, location matters' },
  { n: 3, label: 'Construction, trades and hospitality', words: 'Restaurants, cafes, construction, trades — bookings, inquiries, visibility' },
  { n: 4, label: 'Ecommerce (future)', words: 'Product-led, direct purchase tracking — not yet our strongest segment' },
] as const

/** Section 6: where a prospect came from. */
export const ACQ_SOURCES = [
  { key: 'referral', label: 'Referral' },
  { key: 'direct', label: 'Direct inquiry' },
  { key: 'organic_social', label: 'Organic social' },
  { key: 'outbound', label: 'Outbound proactive' },
  { key: 'paid_social', label: 'Paid social' },
  { key: 'linkedin', label: 'LinkedIn' },
] as const
export type AcqSource = typeof ACQ_SOURCES[number]['key']

export const OUTREACH_CHANNELS = ['Instagram DM', 'Email', 'LinkedIn', 'Text', 'Phone'] as const

/* ── the timeline and the score ────────────────────────────────────────── */

/** Section 9, the signals, with the blueprint's points. `manual` kinds are logged by a person from the profile. */
export const ACQ_EVENT_KINDS = {
  added:            { label: 'Target added', points: 0 },
  fit:              { label: 'Strong fit for the tier', points: 10 },
  weak_presence:    { label: 'Weak website or social presence', points: 5 },
  content_ready:    { label: 'Content ready', points: 0 },
  outreach_sent:    { label: 'Outreach sent', points: 0 },
  follow_up:        { label: 'Follow-up sent', points: 0 },
  reply:            { label: 'Replied to the DM or email', points: 20 },
  link_click:       { label: 'Clicked the Loom or audit link', points: 15 },
  asset_engaged:    { label: 'Watched or engaged with the audit', points: 15 },
  call_booked:      { label: 'Booked the discovery call', points: 30 },
  reminder_opened:  { label: 'Opened a meeting reminder', points: 5 },
  delayed:          { label: 'Rescheduled or delayed', points: -10 },
  call_held:        { label: 'Discovery call held', points: 0 },
  proposal_sent:    { label: 'Proposal sent', points: 0 },
  deposit_sent:     { label: 'Deposit invoice sent', points: 0 },
  deposit_paid:     { label: 'Deposit paid', points: 0 },
  signed:           { label: 'Contract signed', points: 0 },
  handoff:          { label: 'Handed to delivery', points: 0 },
  not_interested:   { label: 'Said not interested', points: 0 },
  note:             { label: 'Note', points: 0 },
  stage:            { label: 'Stage moved', points: 0 },
} as const
export type AcqEventKind = keyof typeof ACQ_EVENT_KINDS

/** the signals a person logs by hand from the profile */
export const LOGGABLE_KINDS: readonly AcqEventKind[] = ['reply', 'link_click', 'asset_engaged', 'call_booked', 'reminder_opened', 'delayed', 'follow_up', 'not_interested', 'note']

export type AcqEvent = {
  id: string
  prospect_id: string
  kind: string
  at: string
  by?: string | null
  /** who found it: a person, the system, or the scanner (a scanner's finding waits for a confirm) */
  source?: string | null
  detail?: string | null
  points?: number | null
  confirmed?: boolean | null
  /** the agent's (acq-agent-core.ts): the message it read, how sure it was, and a person's "not this" */
  evidence_id?: string | null
  confidence?: number | null
  dismissed_at?: string | null
}

export function isAcqEventKind(v: unknown): v is AcqEventKind {
  return typeof v === 'string' && v in ACQ_EVENT_KINDS
}

/** the score: the points of the CONFIRMED events — a scanner's unconfirmed finding counts for nothing yet */
export function scoreOf(events: readonly AcqEvent[]): number {
  return Math.max(0, events.filter(e => e.confirmed !== false).reduce((n, e) => n + (Number.isFinite(Number(e.points)) ? Number(e.points) : 0), 0))
}

export type ScoreBand = { key: 'cold' | 'warm' | 'qualified' | 'high'; label: string; action: string; tone: 'muted' | 'surface' | 'amber' | 'red' }
export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return { key: 'high', label: 'High priority', action: 'Divina, Martin or a senior owner should review quickly', tone: 'red' }
  if (score >= 60) return { key: 'qualified', label: 'Qualified interest', action: 'Prioritise a personal follow-up and the call booking', tone: 'amber' }
  if (score >= 30) return { key: 'warm', label: 'Warm', action: 'Send a value-led follow-up; keep the owner aware', tone: 'surface' }
  return { key: 'cold', label: 'Cold / low signal', action: 'Keep in the database; no heavy manual effort unless strategic', tone: 'muted' }
}

/** said "not interested": closed, and never chased again */
export function isClosedLost(events: readonly AcqEvent[]): boolean {
  return events.some(e => e.kind === 'not_interested' && e.confirmed !== false)
}

/* ── the prospect ──────────────────────────────────────────────────────── */

export type Prospect = {
  id: string
  business: string
  tier?: number | null
  industry?: string | null
  website?: string | null
  instagram?: string | null
  linkedin?: string | null
  contact_name?: string | null
  contact_role?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  source_detail?: string | null
  stage?: string | null
  stage_entered_at?: string | null
  owner_id?: string | null
  added_by?: string | null
  weakness_tags?: unknown
  audit_angle?: string | null
  loom_url?: string | null
  post_url?: string | null
  cta_url?: string | null
  outreach_at?: string | null
  outreach_channel?: string | null
  outreach_by?: string | null
  replied_at?: string | null
  call_at?: string | null
  call_notes?: string | null
  proposal_url?: string | null
  proposal_sent_at?: string | null
  deal_value?: number | null
  invoice_ref?: string | null
  deposit_amount?: number | null
  deposit_sent_at?: string | null
  deposit_paid_at?: string | null
  contract_url?: string | null
  signed_at?: string | null
  client_id?: string | null
  next_action?: string | null
  next_action_at?: string | null
  not_now_at?: string | null
  reopen_at?: string | null
  dormant_at?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const has = (v: unknown) => String(v ?? '').trim().length > 0

export function weaknessTagsOf(p: Pick<Prospect, 'weakness_tags'>): string[] {
  return Array.isArray(p.weakness_tags) ? p.weakness_tags.map(t => String(t ?? '').trim()).filter(Boolean).slice(0, 12) : []
}

/** the stage's capture lines, each met or not from the prospect's own fields */
export function captureState(p: Prospect): { line: string; met: boolean }[] {
  const s = acqStageByKey(p.stage)
  const met: Record<AcqStageKey, boolean[]> = {
    target: [!!p.tier, has(p.website) || has(p.instagram) || has(p.linkedin), has(p.audit_angle) || weaknessTagsOf(p).length > 0],
    content: [has(p.loom_url) || has(p.post_url)],
    outreach: [has(p.outreach_at) && has(p.outreach_channel)],
    engaged: [has(p.replied_at) || has(p.notes), has(p.owner_id)],
    qualified: [has(p.call_at), has(p.email) || has(p.phone)],
    discovery: [has(p.call_notes)],
    proposal: [has(p.proposal_url), Number(p.deal_value) > 0],
    deposit_sent: [has(p.invoice_ref), Number(p.deposit_amount) > 0],
    deposit_paid: [has(p.deposit_paid_at)],
    signed: [has(p.signed_at)],
    handoff: [has(p.client_id)],
  }
  return s.capture.map((line, i) => ({ line, met: met[s.key][i] === true }))
}

/** why the prospect may not move on yet — null when it may */
export function acqMoveRefusal(p: Prospect): string | null {
  const missing = captureState(p).filter(x => !x.met).map(x => x.line)
  // SAY WHERE (the owner, 23 Sep 2026, of "Not yet — an owner first": "dont get it what is this"): the missing thing is a field on this page
  return missing.length === 0 ? null : `Not yet — ${missing.join(', ').toLowerCase()} first: fill it in below and the move opens.`
}

/** what a move stamps, besides the stage: the milestone the new stage means, when it is not already dated */
export function acqMoveStamps(p: Prospect, to: AcqStageKey, now: string): Partial<Prospect> {
  const out: Partial<Prospect> = { stage: to, stage_entered_at: now, not_now_at: null, reopen_at: null, dormant_at: null }
  if (to === 'engaged' && !p.replied_at) out.replied_at = now
  if (to === 'proposal' && !p.proposal_sent_at) out.proposal_sent_at = now
  if (to === 'deposit_sent' && !p.deposit_sent_at) out.deposit_sent_at = now
  return out
}

/** the event a move writes on the timeline, with the blueprint's points where the move IS the signal */
export function eventForMove(to: AcqStageKey): AcqEventKind {
  const map: Partial<Record<AcqStageKey, AcqEventKind>> = {
    content: 'stage', outreach: 'outreach_sent', engaged: 'stage', qualified: 'stage', discovery: 'call_held',
    proposal: 'proposal_sent', deposit_sent: 'deposit_sent', deposit_paid: 'deposit_paid', signed: 'signed', handoff: 'handoff',
  }
  return map[to] ?? 'stage'
}

/* ── the clock ─────────────────────────────────────────────────────────── */

const DAY = 86_400_000

export function acqDaysOver(p: Pick<Prospect, 'stage' | 'stage_entered_at' | 'created_at' | 'not_now_at' | 'dormant_at'>, nowMs: number): number | null {
  if (p.not_now_at || p.dormant_at) return null
  const limit = acqStageByKey(p.stage).limitDays
  const at = Date.parse(String(p.stage_entered_at ?? p.created_at ?? ''))
  if (limit === null || !Number.isFinite(at)) return null
  const over = (nowMs - (at + limit * DAY)) / DAY
  return over > 0 ? Math.ceil(over) : 0
}

export function acqLimitWords(p: Parameters<typeof acqDaysOver>[0], nowMs: number): string | null {
  if (p.dormant_at) return 'Dormant'
  if (p.not_now_at) return 'Not now'
  const limit = acqStageByKey(p.stage).limitDays
  const at = Date.parse(String(p.stage_entered_at ?? p.created_at ?? ''))
  if (limit === null || !Number.isFinite(at)) return null
  const left = (at + limit * DAY - nowMs) / DAY
  if (left < 0) { const n = Math.ceil(-left); return `${n} ${n === 1 ? 'day' : 'days'} over` }
  if (left < 1) return 'due today'
  const n = Math.ceil(left)
  return `${n} ${n === 1 ? 'day' : 'days'} left`
}

/* ── Section 8: the follow-up after outreach ───────────────────────────── */

export const FOLLOW_UPS = [
  { day: 0, purpose: 'Initial outreach', how: 'Manual send or a reviewed template', action: 'Send the DM or email with the public post, the private Loom or audit link and the booking CTA.' },
  { day: 1, purpose: 'Short reminder', how: 'Task reminder', action: 'A short human follow-up if there is no reply.' },
  { day: 3, purpose: 'Email or text follow-up', how: 'Task reminder or a reviewed template', action: 'Reference the audit; ask if they want the 15-minute visibility breakdown or a discovery call.' },
  { day: 5, purpose: 'Voice note', how: 'Manual', action: 'A voice note, if it is appropriate.' },
  { day: 7, purpose: 'Value follow-up', how: 'Reviewed template or manual', action: 'One useful idea, example or observation. Keep it personal.' },
  { day: 14, purpose: 'Soft check-in', how: 'Reviewed template or manual', action: 'A low-pressure check-in. Do not over-chase.' },
  { day: 21, purpose: 'Dormant or recycle', how: 'System update', action: 'Mark dormant, add a recycle date or keep in long-term nurture.' },
] as const

export type FollowUpStep = { day: number; purpose: string; how: string; action: string; due_at: string | null; done_at: string | null; overdue: boolean; paused: boolean }

/**
 * Every step dated from the outreach. A reply PAUSES the rest ("pause
 * no-response follow-up tasks"); a step is done when a follow-up event names
 * its day, and day 0 is done by the outreach itself.
 */
export function followUpPlan(p: Pick<Prospect, 'outreach_at' | 'replied_at' | 'dormant_at'>, events: readonly AcqEvent[], nowMs: number): FollowUpStep[] {
  const start = Date.parse(String(p.outreach_at ?? ''))
  const paused = has(p.replied_at) || has(p.dormant_at)
  return FOLLOW_UPS.map(f => {
    const due = Number.isFinite(start) ? new Date(start + f.day * DAY).toISOString() : null
    const done = f.day === 0
      ? (Number.isFinite(start) ? new Date(start).toISOString() : null)
      : events.find(e => e.kind === 'follow_up' && String(e.detail ?? '').startsWith(`Day ${f.day} `))?.at ?? null
    return { ...f, due_at: due, done_at: done, paused: paused && !done, overdue: !paused && !done && !!due && Date.parse(due) < nowMs }
  })
}

/** the follow-up tasks made when outreach is marked sent — one per step after day 0, dated */
export function followUpTasks(business: string, outreachAtIso: string): { title: string; note: string; due_date: string; day: number }[] {
  const start = Date.parse(outreachAtIso)
  if (!Number.isFinite(start)) return []
  return FOLLOW_UPS.filter(f => f.day > 0).map(f => ({
    day: f.day,
    title: `Day ${f.day} · ${f.purpose} — ${business}`,
    note: `${f.action} (${f.how}.) The system only reminds; you write and send it.`,
    due_date: new Date(start + f.day * DAY).toISOString().slice(0, 10),
  }))
}

/* ── what a person may send ────────────────────────────────────────────── */

const text = (v: unknown, max: number) => (v === null ? null : String(v ?? '').trim().slice(0, max) || null)
const iso = (v: unknown) => (v === null || v === '' ? null : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined)
const money = (v: unknown) => (v === null || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 100) / 100 : undefined)
const link = (v: unknown) => {
  const s = String(v ?? '').trim()
  if (v === null || !s) return null
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try { const p = new URL(u); return ['http:', 'https:'].includes(p.protocol) && p.hostname.includes('.') ? p.toString().slice(0, 600) : undefined } catch { return undefined }
}
export const cleanHandle = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@+/, '').replace(/\/.*$/, '').slice(0, 60)
  return s || null
}

const TEXT_FIELDS: [keyof Prospect, number][] = [
  ['business', 160], ['industry', 120], ['contact_name', 120], ['contact_role', 120], ['email', 200], ['phone', 60],
  ['source_detail', 200], ['owner_id', 80], ['audit_angle', 1000], ['outreach_channel', 40], ['outreach_by', 80],
  ['call_notes', 8000], ['invoice_ref', 120], ['next_action', 300], ['notes', 8000],
]
const LINK_FIELDS: (keyof Prospect)[] = ['website', 'linkedin', 'loom_url', 'post_url', 'cta_url', 'proposal_url', 'contract_url']
const DATE_FIELDS: (keyof Prospect)[] = ['outreach_at', 'replied_at', 'call_at', 'proposal_sent_at', 'deposit_sent_at', 'deposit_paid_at', 'signed_at', 'next_action_at']
const MONEY_FIELDS: (keyof Prospect)[] = ['deal_value', 'deposit_amount']

/** a field's name in the team's words — a refusal never shows a column name */
const FIELD_WORDS: Partial<Record<keyof Prospect, string>> = {
  website: 'The website', linkedin: 'The LinkedIn link', loom_url: 'The Loom link', post_url: 'The public post link', cta_url: 'The booking link',
  proposal_url: 'The proposal link', contract_url: 'The contract link', outreach_at: 'When the outreach was sent', replied_at: 'When they replied',
  call_at: 'The discovery call', proposal_sent_at: 'When the proposal was sent', deposit_sent_at: 'When the deposit was sent',
  deposit_paid_at: 'When the deposit was paid', signed_at: 'When the contract was signed', next_action_at: 'The next action date',
  deal_value: 'The proposal value', deposit_amount: 'The deposit amount',
}
const wordsFor = (k: keyof Prospect) => FIELD_WORDS[k] ?? 'That field'

/** the fields a person may set, cleaned; unknown keys dropped, a bad value refused by name */
export function sanitiseProspectPatch(body: Record<string, unknown>): { ok: true; patch: Partial<Prospect> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {}
  for (const [k, max] of TEXT_FIELDS) if (k in body) patch[k] = text(body[k], max)
  if ('business' in body && !patch.business) return { ok: false, error: 'A prospect needs the business’s name' }
  for (const k of LINK_FIELDS) if (k in body) { const v = link(body[k]); if (v === undefined) return { ok: false, error: `${wordsFor(k)} is not a web address` }; patch[k] = v }
  for (const k of DATE_FIELDS) if (k in body) { const v = iso(body[k]); if (v === undefined) return { ok: false, error: `${wordsFor(k)} is not a date` }; patch[k] = v }
  for (const k of MONEY_FIELDS) if (k in body) { const v = money(body[k]); if (v === undefined) return { ok: false, error: `${wordsFor(k)} is not an amount` }; patch[k] = v }
  if ('instagram' in body) patch.instagram = cleanHandle(body.instagram)
  if ('tier' in body) { const n = body.tier === null || body.tier === '' ? null : Number(body.tier); if (n !== null && !ACQ_TIERS.some(t => t.n === n)) return { ok: false, error: 'Pick a tier from the list' }; patch.tier = n }
  if ('source' in body) { const s = text(body.source, 40); if (s && !ACQ_SOURCES.some(x => x.key === s)) return { ok: false, error: 'Pick a source from the list' }; patch.source = s }
  if ('weakness_tags' in body) patch.weakness_tags = Array.isArray(body.weakness_tags) ? body.weakness_tags.map(t => String(t ?? '').trim().slice(0, 60)).filter(Boolean).slice(0, 12) : []
  return { ok: true, patch: patch as Partial<Prospect> }
}

/** who may work the acquisition system: managers, and anyone granted the Leads page — the server asks the same */
export function mayDeleteProspect(viewer: { role: string } | null | undefined): boolean {
  return viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
}

/* ── Section 16: the first numbers ─────────────────────────────────────── */

export type AcqFunnel = { key: AcqStageKey; label: string; reached: number }[]

/** how many prospects REACHED each stage (are at it or past it) — the funnel */
export function acqFunnel(prospects: readonly Pick<Prospect, 'stage'>[]): AcqFunnel {
  const at = prospects.map(p => ACQ_STAGES.findIndex(s => s.key === acqStageByKey(p.stage).key))
  return ACQ_STAGES.map((s, i) => ({ key: s.key, label: s.label, reached: at.filter(n => n >= i).length }))
}

function tally<T extends string | number>(prospects: readonly Prospect[], keyOf: (p: Prospect) => T | null) {
  const rows = new Map<T, { sent: number; replies: number; calls: number; signed: number }>()
  const idx = (k: AcqStageKey) => ACQ_STAGES.findIndex(s => s.key === k)
  for (const p of prospects) {
    const k = keyOf(p)
    if (k === null) continue
    const r = rows.get(k) ?? { sent: 0, replies: 0, calls: 0, signed: 0 }
    const n = idx(acqStageByKey(p.stage).key)
    if (n >= idx('outreach')) r.sent += 1
    if (n >= idx('engaged')) r.replies += 1
    if (n >= idx('qualified')) r.calls += 1
    if (n >= idx('signed')) r.signed += 1
    rows.set(k, r)
  }
  return rows
}
export function acqByTier(prospects: readonly Prospect[]) { return tally(prospects, p => (p.tier ? Number(p.tier) : null)) }
export function acqBySource(prospects: readonly Prospect[]) { return tally(prospects, p => (p.source ? String(p.source) : null)) }

/** median days between two dated milestones across the prospects that have both */
export function medianDays(prospects: readonly Prospect[], from: keyof Prospect, to: keyof Prospect): number | null {
  const spans = prospects
    .map(p => (Date.parse(String(p[to] ?? '')) - Date.parse(String(p[from] ?? ''))) / DAY)
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
  if (spans.length === 0) return null
  const mid = Math.floor(spans.length / 2)
  const m = spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2
  return Math.round(m * 10) / 10
}

/* ── THE INBOX KNOWS A PROSPECT (21 Sep 2026) ──────────────────────────────
 * The scanner already reads hello@, contact@ and tech@ — including mail they
 * are only copied on. A message FROM a prospect is a reply: matched on the
 * prospect's own address first, then on its website's domain when that domain
 * is the business's own (never gmail.com and its kind) and names one prospect
 * only. Two prospects on one domain is a question for a person, not a guess.
 */
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'live.com.au', 'yahoo.com', 'yahoo.com.au', 'icloud.com', 'me.com', 'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'proton.me', 'protonmail.com', 'aol.com'])

function hostOf(url: string | null | undefined): string {
  try { return new URL(String(url ?? '')).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

export function prospectForSender<P extends { id: string; stage?: string | null; email?: string | null; website?: string | null }>(
  prospects: readonly P[], fromEmail: string,
): { prospect: P; by: 'address' | 'domain' } | null {
  const from = fromEmail.trim().toLowerCase()
  const domain = from.split('@')[1] ?? ''
  if (!from || !domain) return null
  // a handed-over prospect is a client: its mail is client mail, not a reply to outreach
  const open = prospects.filter(p => acqStageByKey(p.stage).key !== 'handoff')
  const exact = open.find(p => String(p.email ?? '').trim().toLowerCase() === from)
  if (exact) return { prospect: exact, by: 'address' }
  if (FREE_MAIL.has(domain)) return null
  const same = open.filter(p => { const h = hostOf(p.website); return h !== '' && (h === domain || domain.endsWith('.' + h)) })
  return same.length === 1 ? { prospect: same[0], by: 'domain' } : null
}

/** the FIRST reply is the +20; a second email in the same conversation is on the timeline, worth nothing more */
export function replyPoints(p: { replied_at?: string | null }): number {
  return p.replied_at ? 0 : ACQ_EVENT_KINDS.reply.points
}
