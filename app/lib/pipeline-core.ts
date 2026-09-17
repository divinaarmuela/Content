/**
 * THE ACQUISITION PIPELINE — the pure half (the doc "MD Media acquisition
 * system", 17 Sep 2026, Divina Armuela). One pipeline, seven stages, one
 * owner per stage, an exit rule and a time limit each. A deal moves right
 * only when the exit rule is met; nothing skips a stage. Any deal past its
 * limit gets a name against it at the Monday scoreboard.
 *
 * No I/O here: the routes read and write the lead row, the page draws it,
 * and everything either of them decides comes from this file. The doc is
 * the spec; the words below are its words.
 */

export type StageKey =
  | 'new'          // 1. New lead
  | 'qualified'    // 2. Qualified, call booked
  | 'discovery'    // 3. Discovery held
  | 'proposal'     // 4. Proposal sent
  | 'walkthrough'  // 5. Walkthrough held
  | 'signed'       // 6. Signed + deposit paid
  | 'delivered'    // 7. VS delivered, retainer talk

export type Stage = {
  key: StageKey
  n: number
  label: string
  /** whose seat this stage is, in the doc's words */
  owner: string
  /** the exit rule, one line per thing that must be true */
  exit: string[]
  /** days allowed in the stage before it is named on Monday */
  limitDays: number
}

export const STAGES: readonly Stage[] = [
  { key: 'new', n: 1, label: 'New lead', owner: 'Joy', exit: ['Replied same day', 'Source tagged'], limitDays: 1 },
  { key: 'qualified', n: 2, label: 'Qualified, call booked', owner: 'Joy', exit: ['Passes the 3 qualifiers', 'Call in Divina’s calendar', 'Confirmation text sent'], limitDays: 3 },
  { key: 'discovery', n: 3, label: 'Discovery held', owner: 'Divina', exit: ['Call done', 'Walkthrough booked before hang-up', 'Notes on the deal'], limitDays: 1 },
  { key: 'proposal', n: 4, label: 'Proposal sent', owner: 'Manal drafts, Divina signs off', exit: ['Sent within 24 hours of the call'], limitDays: 1 },
  { key: 'walkthrough', n: 5, label: 'Walkthrough held', owner: 'Divina', exit: ['Deposit link sent on the call'], limitDays: 3 },
  { key: 'signed', n: 6, label: 'Signed + deposit', owner: 'Abby', exit: ['Signed agreement received', 'Deposit received'], limitDays: 7 },
  { key: 'delivered', n: 7, label: 'VS delivered', owner: 'Account owner', exit: ['Content review booked', 'Retainer proposal sent'], limitDays: 14 },
] as const

export const STAGE_KEYS: readonly StageKey[] = STAGES.map(s => s.key)

export function stageByKey(key: string | null | undefined): Stage {
  return STAGES.find(s => s.key === key) ?? STAGES[0]
}

export function nextStage(key: StageKey): Stage | null {
  const i = STAGES.findIndex(s => s.key === key)
  return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1] : null
}

export function previousStage(key: StageKey): Stage | null {
  const i = STAGES.findIndex(s => s.key === key)
  return i > 0 ? STAGES[i - 1] : null
}

/** Section 1: who we sell to. */
export const TIERS = [
  { n: 1, label: 'Finance and property', words: 'Brokers, buyers advocates, advisers, investors with a sales team — qualified enquiries' },
  { n: 2, label: 'Clinics and beauty', words: 'Bookings' },
  { n: 3, label: 'Construction, trades, hospitality', words: 'Quote requests, venue enquiries' },
] as const

/** Section 3: the three sources, plus where a lead lands on its own. */
export const SOURCE_TAGS = [
  { key: 'referral', label: 'Referral (client)' },
  { key: 'partner', label: 'Partner' },
  { key: 'teardown', label: 'Teardown DM' },
  { key: 'founder', label: 'Founder visibility' },
  { key: 'web_form', label: 'Website form' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'audit', label: 'Audit form' },
  { key: 'other', label: 'Other' },
] as const
export type SourceTag = typeof SOURCE_TAGS[number]['key']

/** Section 9: the five objections that cover nearly every stalled deal. */
export const OBJECTIONS = [
  { key: 'expensive', label: 'Too expensive' },
  { key: 'think', label: 'We’ll think about it' },
  { key: 'inhouse', label: 'We could hire someone in-house' },
  { key: 'burned', label: 'We got burned by the last agency' },
  { key: 'partner', label: 'I need to check with my partner' },
  { key: 'other', label: 'Other' },
] as const

/** Section 1: the 3 qualifiers Joy checks before a call is booked. */
export const QUALIFIERS = [
  { key: 'works_leads', label: 'Somebody on their side works the leads' },
  { key: 'budget', label: 'Budget clears the minimum retainer' },
  { key: 'owner_on_call', label: 'The owner is on the call' },
] as const
export type Qualifiers = Partial<Record<typeof QUALIFIERS[number]['key'], boolean>>

/** the pipeline fields on a lead row (ghost columns on `leads`) */
export type PipelineLead = {
  id: string
  created_at?: string | null
  source?: string | null
  stage?: string | null
  stage_entered_at?: string | null
  owner_id?: string | null
  tier?: number | null
  source_tag?: string | null
  partner?: string | null
  next_action?: string | null
  next_action_at?: string | null
  qualifiers?: unknown
  call_at?: string | null
  proposal_sent_at?: string | null
  walkthrough_at?: string | null
  signed_at?: string | null
  deposit_at?: string | null
  vs_delivered_at?: string | null
  objection?: string | null
  deal_value?: number | null
  not_now_at?: string | null
  reopen_at?: string | null
  touches?: unknown
  pipeline_notes?: string | null
  exit_ticks?: unknown
}

const DAY = 86_400_000

export function stageOf(lead: Pick<PipelineLead, 'stage'>): Stage {
  return stageByKey(lead.stage)
}

/** when the deal entered its stage — a lead that never moved entered "New lead" when it arrived */
export function enteredAt(lead: Pick<PipelineLead, 'stage_entered_at' | 'created_at'>): string | null {
  return lead.stage_entered_at ?? lead.created_at ?? null
}

/** the day the stage's limit runs out, ISO, or null when nothing dates it */
export function deadlineOf(lead: Pick<PipelineLead, 'stage' | 'stage_entered_at' | 'created_at'>): string | null {
  const at = enteredAt(lead)
  if (!at) return null
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return null
  return new Date(t + stageOf(lead).limitDays * DAY).toISOString()
}

/** days past the limit, 0 when inside it, null when undated; a "Not now" deal is never late */
export function daysOver(lead: Pick<PipelineLead, 'stage' | 'stage_entered_at' | 'created_at' | 'not_now_at'>, nowMs: number): number | null {
  if (lead.not_now_at) return null
  const d = deadlineOf(lead)
  if (!d) return null
  const over = (nowMs - Date.parse(d)) / DAY
  return over > 0 ? Math.ceil(over) : 0
}

export function isOverdue(lead: Parameters<typeof daysOver>[0], nowMs: number): boolean {
  return (daysOver(lead, nowMs) ?? 0) > 0
}

/** "2 days left", "due today", "3 days over" — the chip on the card */
export function limitWords(lead: Parameters<typeof daysOver>[0], nowMs: number): string | null {
  if (lead.not_now_at) return 'Not now'
  const d = deadlineOf(lead)
  if (!d) return null
  const left = (Date.parse(d) - nowMs) / DAY
  if (left < 0) { const n = Math.ceil(-left); return `${n} ${n === 1 ? 'day' : 'days'} over` }
  if (left < 1) return 'due today'
  const n = Math.ceil(left)
  return `${n} ${n === 1 ? 'day' : 'days'} left`
}

export function qualifiersOf(lead: Pick<PipelineLead, 'qualifiers'>): Qualifiers {
  const q = lead.qualifiers
  return q && typeof q === 'object' ? (q as Qualifiers) : {}
}

export function passesQualifiers(lead: Pick<PipelineLead, 'qualifiers'>): boolean {
  const q = qualifiersOf(lead)
  return QUALIFIERS.every(k => q[k.key] === true)
}

/** the exit-rule ticks a person made by hand on this stage: { [stage]: { [line]: true } } */
export function exitTicksOf(lead: Pick<PipelineLead, 'exit_ticks'>, stage: StageKey): Record<string, boolean> {
  const all = lead.exit_ticks && typeof lead.exit_ticks === 'object' ? (lead.exit_ticks as Record<string, Record<string, boolean>>) : {}
  const mine = all[stage]
  return mine && typeof mine === 'object' ? mine : {}
}

/**
 * THE EXIT RULE, LINE BY LINE: which of the stage's lines are met, from the
 * deal's own fields where the dashboard knows (a call booked, a signature, a
 * deposit) and from the person's tick otherwise. A stage may be left only
 * when every line is met.
 */
export function exitState(lead: PipelineLead): { line: string; met: boolean; auto: boolean }[] {
  const stage = stageOf(lead)
  const ticks = exitTicksOf(lead, stage.key)
  const tick = (line: string) => ({ line, met: ticks[line] === true, auto: false })
  switch (stage.key) {
    case 'new':
      return [tick('Replied same day'), { line: 'Source tagged', met: !!lead.source_tag, auto: true }]
    case 'qualified':
      return [
        { line: 'Passes the 3 qualifiers', met: passesQualifiers(lead), auto: true },
        { line: 'Call in Divina’s calendar', met: !!lead.call_at, auto: true },
        tick('Confirmation text sent'),
      ]
    case 'discovery':
      return [tick('Call done'), { line: 'Walkthrough booked before hang-up', met: !!lead.walkthrough_at, auto: true }, { line: 'Notes on the deal', met: !!String(lead.pipeline_notes ?? '').trim(), auto: true }]
    case 'proposal':
      return [{ line: 'Sent within 24 hours of the call', met: !!lead.proposal_sent_at, auto: true }]
    case 'walkthrough':
      return [tick('Deposit link sent on the call')]
    case 'signed':
      return [{ line: 'Signed agreement received', met: !!lead.signed_at, auto: true }, { line: 'Deposit received', met: !!lead.deposit_at, auto: true }]
    case 'delivered':
      return [tick('Content review booked'), tick('Retainer proposal sent')]
  }
}

/** why the deal may not move on yet — null when it may */
export function moveRefusal(lead: PipelineLead): string | null {
  const missing = exitState(lead).filter(x => !x.met).map(x => x.line)
  if (missing.length === 0) return null
  return `Not yet — ${missing.join(', ').toLowerCase()} first.`
}

/** the fields a stage move stamps, besides the stage itself */
export function moveStamps(to: StageKey, now: string): Partial<PipelineLead> {
  const out: Partial<PipelineLead> = { stage: to, stage_entered_at: now, not_now_at: null, reopen_at: null }
  if (to === 'proposal') out.proposal_sent_at = now
  if (to === 'delivered') out.vs_delivered_at = now
  return out
}

/** Section 6: the six touches after the same-day reply. Dated from the moment the deal reached the stage that triggers them. */
export const TOUCHES = [
  { day: 0, channel: 'DM', sender: 'Joy', trigger: 'Inbound reply or cold DM to a teardown subject', from: 'new' as StageKey,
    script: 'Hey [name]. Glad it landed. Want a proper one? 15 min Loom on your IG and Google, 3 things we’d fix, no pitch inside it. Send me your handle and I’ll have it to you by [day].' },
  { day: 1, channel: 'Text', sender: 'Joy', trigger: 'Discovery call booked', from: 'qualified' as StageKey,
    script: 'Hey [name], Joy from MD Media. You’re locked in with Divina [day] at [time]. She’ll ask where your leads come from now and what you’ve tried, so have a rough idea of your numbers. See you then.' },
  { day: 2, channel: 'Email', sender: 'Divina', trigger: 'Proposal ready', from: 'discovery' as StageKey,
    script: 'Subject: [Business], what we’d do. Hey [name]. Good chat yesterday. Proposal’s attached. It’s 8 pages and the first one is what you told us, so tell me if I got any of it wrong. Walkthrough is [day] at [time]. Bring [partner] if they need to be in it.' },
  { day: 5, channel: 'Voice note', sender: 'Divina', trigger: 'No reply to proposal', from: 'proposal' as StageKey,
    script: 'Hey, it’s Divina. Just wanted to put a voice to it. The one page I’d want you to read is page 3, the diagnosis. Even if you go somewhere else, that’s the thing to fix. Chat [day].' },
  { day: 10, channel: 'Email', sender: 'Divina', trigger: 'Still no reply', from: 'proposal' as StageKey,
    script: 'Subject: one thing. Hey [name]. Not chasing. One thing I forgot to say on the call: [something you noticed about their business]. Still keen if you are. If it’s a no for now, tell me and I’ll stop.' },
  { day: 21, channel: 'Email or text', sender: 'Joy', trigger: 'Close the loop', from: 'proposal' as StageKey,
    script: 'Hey [name]. We’ll take the quiet as not now, which is fine. Proposal stays open at that price till end of [month]. After that we’ll assume you’ve gone another way. Good luck with [the thing they mentioned].' },
] as const

export type TouchDone = { day: number; done_at: string; by?: string | null }

export function touchesDone(lead: Pick<PipelineLead, 'touches'>): TouchDone[] {
  return Array.isArray(lead.touches) ? (lead.touches as TouchDone[]).filter(t => t && typeof t.day === 'number') : []
}

/** every touch, with when it is due (from the stage that triggers it) and whether it was sent */
export function touchPlan(lead: PipelineLead, nowMs: number): { day: number; channel: string; sender: string; trigger: string; script: string; due_at: string | null; done_at: string | null; overdue: boolean }[] {
  const done = touchesDone(lead)
  const reached = STAGES.findIndex(s => s.key === stageOf(lead).key)
  const anchorFor = (from: StageKey): string | null => {
    if (from === 'qualified') return lead.call_at ? lead.stage_entered_at ?? lead.created_at ?? null : null
    if (from === 'proposal') return lead.proposal_sent_at ?? null
    const i = STAGES.findIndex(s => s.key === from)
    return i <= reached ? (from === stageOf(lead).key ? enteredAt(lead) : lead.created_at ?? null) : null
  }
  return TOUCHES.map(t => {
    const anchor = anchorFor(t.from)
    const due = anchor && Number.isFinite(Date.parse(anchor)) ? new Date(Date.parse(anchor) + t.day * DAY).toISOString() : null
    const d = done.find(x => x.day === t.day)
    return { day: t.day, channel: t.channel, sender: t.sender, trigger: t.trigger, script: t.script, due_at: due, done_at: d?.done_at ?? null, overdue: !d && !!due && Date.parse(due) < nowMs && !lead.not_now_at }
  })
}

/** Section 11: the Monday scoreboard's six numbers, for the week that starts at `weekStartMs` */
export function scoreboard(leads: readonly PipelineLead[], weekStartMs: number, weekEndMs: number): {
  leadsIn: number; leadsBySource: Record<string, number>; callsHeld: number; proposalsSent: number; signed: number; deposits: number; averageValue: number | null
} {
  const inWeek = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) && t >= weekStartMs && t < weekEndMs }
  const leadsBySource: Record<string, number> = {}
  let leadsIn = 0
  for (const l of leads) {
    if (!inWeek(l.created_at)) continue
    leadsIn += 1
    const s = l.source_tag ?? (l.source === 'web_form' ? 'web_form' : l.source ? 'inbox' : 'other')
    leadsBySource[s] = (leadsBySource[s] ?? 0) + 1
  }
  const callsHeld = leads.filter(l => inWeek(l.call_at) && STAGES.findIndex(s => s.key === stageOf(l).key) >= 2).length
  const proposalsSent = leads.filter(l => inWeek(l.proposal_sent_at)).length
  const signedRows = leads.filter(l => inWeek(l.signed_at))
  const deposits = leads.filter(l => inWeek(l.deposit_at)).length
  const values = signedRows.map(l => Number(l.deal_value)).filter(v => Number.isFinite(v) && v > 0)
  const averageValue = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null
  return { leadsIn, leadsBySource, callsHeld, proposalsSent, signed: signedRows.length, deposits, averageValue }
}

/** the doc's weekly targets, until 30 days of real data corrects them */
export const WEEKLY_TARGETS = { leadsIn: 4, callsHeld: 2, proposalsSent: 2, signedPerMonth: 2 } as const

/** Monday 00:00 Melbourne of the week containing `nowMs`, as epoch ms, and the next Monday */
export function weekBounds(nowMs: number, zone = 'Australia/Melbourne'): { start: number; end: number } {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(nowMs))
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? ''
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday').slice(0, 3))
  const midnightLocal = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')))
  // the local midnight as UTC ms: shift by the zone's offset at that moment
  const localNow = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(get('hour')) % 24, Number(get('minute')))
  const offset = localNow - nowMs
  const start = midnightLocal - Math.max(0, dow) * DAY - offset
  return { start: Math.floor(start / 60000) * 60000, end: Math.floor(start / 60000) * 60000 + 7 * DAY }
}

const DATE_WORDS: Record<string, string> = { next_action_at: 'The next action date', call_at: 'The discovery call', proposal_sent_at: 'Proposal sent', walkthrough_at: 'The walkthrough', signed_at: 'Agreement signed', deposit_at: 'Deposit received', vs_delivered_at: 'Visibility System delivered', not_now_at: 'Not now', reopen_at: 'Re-open' }

/** the pipeline fields a PATCH may carry, cleaned; unknown keys dropped, bad values refused */
export function sanitisePipelinePatch(body: Record<string, unknown>): { ok: true; patch: Partial<PipelineLead> } | { ok: false; error: string } {
  const patch: Partial<PipelineLead> = {}
  const iso = (v: unknown) => v === null || v === '' ? null : (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined)
  const text = (v: unknown, max: number) => v === null ? null : String(v ?? '').trim().slice(0, max) || null
  if ('owner_id' in body) patch.owner_id = text(body.owner_id, 80)
  if ('tier' in body) { const n = body.tier === null || body.tier === '' ? null : Number(body.tier); if (n !== null && ![1, 2, 3].includes(n)) return { ok: false, error: 'Tier is 1, 2 or 3' }; patch.tier = n }
  if ('source_tag' in body) { const s = text(body.source_tag, 40); if (s && !SOURCE_TAGS.some(t => t.key === s)) return { ok: false, error: 'Pick a source from the list' }; patch.source_tag = s }
  if ('partner' in body) patch.partner = text(body.partner, 120)
  if ('next_action' in body) patch.next_action = text(body.next_action, 300)
  if ('objection' in body) { const o = text(body.objection, 40); if (o && !OBJECTIONS.some(x => x.key === o)) return { ok: false, error: 'Pick an objection from the list' }; patch.objection = o }
  if ('deal_value' in body) { const n = body.deal_value === null || body.deal_value === '' ? null : Number(body.deal_value); if (n !== null && (!Number.isFinite(n) || n < 0)) return { ok: false, error: 'The deal value is a number, AUD ex GST' }; patch.deal_value = n }
  if ('pipeline_notes' in body) patch.pipeline_notes = body.pipeline_notes === null ? null : String(body.pipeline_notes ?? '').trim().slice(0, 8000) || null
  for (const k of ['next_action_at', 'call_at', 'proposal_sent_at', 'walkthrough_at', 'signed_at', 'deposit_at', 'vs_delivered_at', 'not_now_at', 'reopen_at'] as const) {
    if (k in body) { const v = iso(body[k]); if (v === undefined) return { ok: false, error: `${DATE_WORDS[k]} is not a date` }; patch[k] = v }
  }
  if ('qualifiers' in body) {
    const q = body.qualifiers
    if (q !== null && (typeof q !== 'object' || Array.isArray(q))) return { ok: false, error: 'Qualifiers are three ticks' }
    patch.qualifiers = q === null ? null : Object.fromEntries(QUALIFIERS.map(k => [k.key, (q as Record<string, unknown>)[k.key] === true]))
  }
  if ('exit_ticks' in body) {
    const e = body.exit_ticks
    if (e !== null && (typeof e !== 'object' || Array.isArray(e))) return { ok: false, error: 'Exit ticks are ticks per stage' }
    patch.exit_ticks = e
  }
  if ('touches' in body) {
    const t = body.touches
    if (!Array.isArray(t)) return { ok: false, error: 'Touches are a list' }
    patch.touches = t.filter(x => x && typeof x === 'object' && typeof (x as TouchDone).day === 'number').map(x => ({ day: (x as TouchDone).day, done_at: String((x as TouchDone).done_at ?? new Date().toISOString()), by: (x as TouchDone).by ?? null }))
  }
  return { ok: true, patch }
}
