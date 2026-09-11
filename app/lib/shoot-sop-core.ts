/**
 * THE SHOOT BRIEF SOP, AS RULES — pure, no I/O.
 *
 * The Team's Playbook (July 2026, Shoot Brief SOP §3): the brief is locked
 * and shared 7 days before the shoot, "no brief, no shoot"; it is not
 * complete until nine things are filled in; everyone on the shoot
 * acknowledges it before work starts; the AM signs it off as "go" only once
 * the brief is complete, the strategist is aligned, the client's
 * availability and the location are confirmed, and every acknowledgement is
 * in; Ops sends the reminder the day before; after the shoot the footage is
 * handed to the editor with priorities and a deadline.
 *
 * The Shoots page draws those as six columns. A column is never
 * a stored status — it is READ off the stamps on the shoot and the
 * calendar (`shootStage`), so a shoot can never sit in a column its data
 * contradicts, and dragging a card is asking for the stamp the next column
 * means (`stageMove`), refused in words when the SOP says no.
 */

import { planCards, type PlanCard, shootCard, deliverablesBrief } from './deliverable-group-core'

/* ── the shoot, as these rules read it ─────────────────────────────────── */

export type SopShoot = {
  id: string
  client_id: string
  title?: string | null
  status?: string | null
  owner_id?: string | null
  shoot_date?: string | null
  location?: string | null
  shot_list?: unknown
  planned_deliverables?: unknown
  objective?: string | null
  script?: string | null
  call_time?: string | null
  talent?: string | null
  props_wardrobe?: string | null
  client_availability?: string | null
  editor_priorities?: string | null
  edit_deadline?: string | null
  editor_id?: string | null
  crew_ids?: unknown
  acknowledgements?: unknown
  brief_shared_at?: string | null
  aligned_at?: string | null
  client_confirmed_at?: string | null
  go_at?: string | null
  reminder_sent_at?: string | null
  footage_handed_at?: string | null
  late_nudged_at?: string | null
  /** the Milanote-style canvas: the checklist reads shot list and script
   *  off it too, so building the plan there counts */
  canvas_cards?: unknown
  /** a super admin went ahead with a plan shared late, and said why */
  go_override_reason?: string | null
  go_override_by?: string | null
  late_share_nudged_at?: string | null
  /** the morning after the shoot the footage was handed over by itself and
   *  the editor told — once */
  footage_due_nudged_at?: string | null
  /** where the footage lives — the Dropbox or Drive folder whoever has it
   *  pasted on the shoot page; handed to every card as "Files to work from" */
  footage_url?: string | null
}

export type Ack = { user_id: string; at: string }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map(x => String(x ?? '')).filter(Boolean))] : []

export function crewIdsOf(b: Pick<SopShoot, 'crew_ids'>): string[] { return ids(b.crew_ids) }

export function acksOf(b: Pick<SopShoot, 'acknowledgements'>): Ack[] {
  if (!Array.isArray(b.acknowledgements)) return []
  const out: Ack[] = []
  for (const raw of b.acknowledgements) {
    const r = raw as { user_id?: unknown; at?: unknown } | null
    if (r && typeof r.user_id === 'string' && r.user_id && typeof r.at === 'string') out.push({ user_id: r.user_id, at: r.at })
  }
  return out
}

/** Everyone who has to read the brief before work starts: the crew and the
 *  editor. The AM wrote it, so they are not asked to acknowledge their own
 *  words. */
export function peopleOnShoot(b: Pick<SopShoot, 'crew_ids' | 'editor_id'>): string[] {
  return [...new Set([...crewIdsOf(b), ...(b.editor_id ? [b.editor_id] : [])])]
}

/** Is this person on the shoot — the creator, the editor, or on the crew?
 *  Shared by the server's access helpers and the browser's scoping so a
 *  shoot never opens for somebody the list will not show it to. */
export function isOnShoot(b: Pick<SopShoot, 'owner_id' | 'editor_id' | 'crew_ids'>, userId: string): boolean {
  return b.owner_id === userId || b.editor_id === userId || crewIdsOf(b).includes(userId)
}

/* ── the nine things a brief must contain ──────────────────────────────── */

export type BriefItemKey =
  | 'objective' | 'deliverables' | 'shot_list' | 'script' | 'when_where'
  | 'talent' | 'props' | 'client_availability' | 'editor'

export type BriefItem = { key: BriefItemKey; label: string; hint: string }

/** In the SOP's own order and words (§3.2). */
export const BRIEF_ITEMS: readonly BriefItem[] = [
  { key: 'objective', label: 'Objective', hint: 'What this shoot is meant to achieve, and which pillar or campaign it serves' },
  { key: 'deliverables', label: 'Deliverables', hint: 'The exact outputs — 4 reels, 1 long-form, a photo set' },
  { key: 'shot_list', label: 'Shot list', hint: 'Scene by scene, built with intention' },
  { key: 'script', label: 'Script or talking points', hint: 'Finalised before the day' },
  { key: 'when_where', label: 'Date, call time and location', hint: 'Confirmed, with the address' },
  { key: 'talent', label: 'Talent or presenter', hint: 'Who is on camera, and that they know what is expected' },
  { key: 'props', label: 'Props, wardrobe and setup', hint: 'What is needed and who is bringing it' },
  { key: 'client_availability', label: 'Client availability', hint: 'If the client or their team is on the day' },
  { key: 'editor', label: 'Editor priorities and deadline', hint: 'So the editor knows the goal and the turnaround the moment footage lands' },
]

export type ChecklistInput = {
  /** cards already made for this shoot — a deliverable is a line on the
   *  plan OR a card pointed at the shoot */
  itemCount?: number
}

/* ── what the canvas says ──────────────────────────────────────────────── */

/** A card on the canvas that carries words: a heading, a note, a to-do. */
type CanvasWords = { kind: string; text: string }

function canvasWords(b: Pick<SopShoot, 'canvas_cards'>): CanvasWords[] {
  if (!Array.isArray(b.canvas_cards)) return []
  const out: CanvasWords[] = []
  for (const c of b.canvas_cards) {
    if (!c || typeof c !== 'object') continue
    const kind = String((c as { kind?: unknown }).kind ?? '')
    const t = text((c as { text?: unknown }).text)
    if (['label', 'note', 'todo'].includes(kind) && t) out.push({ kind, text: t })
  }
  return out
}

/**
 * The plan built on the canvas counts. An AM who lays the shot list out as
 * cards under a "Shot list" heading, or pins the script as a note, has done
 * the work — the checklist must not say otherwise (the live walk of 11 Sep
 * 2026). A heading or a card that names the thing is the signal: "Shot
 * list", "Shots", "Scene 1 …" for the shot list; "Script", "Talking points"
 * for the script.
 */
export function canvasSays(b: Pick<SopShoot, 'canvas_cards'>): { shotList: boolean; script: boolean } {
  const words = canvasWords(b)
  return {
    shotList: words.some(w => /\bshot\s*list\b|\bshots?\b|\bscene\s*\d/i.test(w.text)),
    script: words.some(w => /\bscript\b|\btalking\s*points?\b/i.test(w.text)),
  }
}

/** Where a tick came from — so the row can say "from the canvas". */
export function briefItemSource(b: SopShoot, key: BriefItemKey, input: ChecklistInput = {}): 'field' | 'canvas' | null {
  if (!briefItemFilled(b, key, input)) return null
  if (key === 'shot_list') return Array.isArray(b.shot_list) && b.shot_list.length > 0 ? 'field' : 'canvas'
  if (key === 'script') return text(b.script).length > 0 ? 'field' : 'canvas'
  return 'field'
}

export function briefItemFilled(b: SopShoot, key: BriefItemKey, input: ChecklistInput = {}): boolean {
  switch (key) {
    case 'objective': return text(b.objective).length > 0
    case 'deliverables': return (Array.isArray(b.planned_deliverables) && b.planned_deliverables.length > 0) || (input.itemCount ?? 0) > 0
    case 'shot_list': return (Array.isArray(b.shot_list) && b.shot_list.length > 0) || canvasSays(b).shotList
    case 'script': return text(b.script).length > 0 || canvasSays(b).script
    case 'when_where': return text(b.shoot_date).length > 0 && text(b.call_time).length > 0 && text(b.location).length > 0
    case 'talent': return text(b.talent).length > 0
    case 'props': return text(b.props_wardrobe).length > 0
    case 'client_availability': return text(b.client_availability).length > 0
    case 'editor': return text(b.editor_priorities).length > 0 && text(b.edit_deadline).length > 0
  }
}

export type Checklist = {
  filled: number
  total: number
  complete: boolean
  missing: BriefItem[]
  /** "6 of 9 filled" */
  words: string
}

export function briefChecklist(b: SopShoot, input: ChecklistInput = {}): Checklist {
  const missing = BRIEF_ITEMS.filter(i => !briefItemFilled(b, i.key, input))
  const filled = BRIEF_ITEMS.length - missing.length
  return {
    filled, total: BRIEF_ITEMS.length, complete: missing.length === 0, missing,
    words: missing.length === 0 ? 'Plan complete' : `${filled} of ${BRIEF_ITEMS.length} filled`,
  }
}

/* ── the calendar ──────────────────────────────────────────────────────── */

/** The hard deadline: shared at least this many days before the shoot. */
export const BRIEF_LEAD_DAYS = 7

const DAY_MS = 86_400_000

/** Whole days from `today` (YYYY-MM-DD) to the shoot; null with no date. */
export function daysUntilShoot(b: Pick<SopShoot, 'shoot_date'>, today: string): number | null {
  const d = text(b.shoot_date).slice(0, 10)
  if (!d) return null
  const a = Date.parse(`${d}T00:00:00Z`)
  const t = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(t)) return null
  return Math.round((a - t) / DAY_MS)
}

/* ── the six columns ───────────────────────────────────────────────────── */

export type ShootStage = 'drafting' | 'shared' | 'confirmed' | 'reminder_sent' | 'shoot_day' | 'footage_handed'

export const SHOOT_STAGES: readonly { key: ShootStage; label: string; meaning: string; empty: string }[] = [
  { key: 'drafting', label: 'Draft', meaning: 'The account manager is writing the plan. It leaves here once all nine parts are filled in.', empty: 'Nothing being written.' },
  { key: 'shared', label: 'Shared with team', meaning: 'The plan is out, 7 days before the shoot. Everyone on it reads and acknowledges it.', empty: 'No brief out with the team.' },
  { key: 'confirmed', label: 'Confirmed', meaning: 'The account manager signed it off as go: plan complete, strategist aligned, client and location confirmed, everyone acknowledged.', empty: 'Nothing confirmed yet.' },
  { key: 'reminder_sent', label: 'Reminder sent', meaning: 'Ops sent the day-before reminder: call time, location, everyone knows their role.', empty: 'No reminders out.' },
  { key: 'shoot_day', label: 'Shoot day', meaning: 'Filming, to the plan. The calendar puts a shoot here on the day.', empty: 'No shoot today.' },
  { key: 'footage_handed', label: 'Footage handed over', meaning: 'The footage is with the editor, with priorities and a deadline, and the work is on the Editor page.', empty: 'Nothing handed over yet.' },
]

export const STAGE_LABEL: Record<ShootStage, string> = Object.fromEntries(SHOOT_STAGES.map(s => [s.key, s.label])) as Record<ShootStage, string>

/** The same six stages as a strip across the shoot page — the column word,
 *  with the last one short enough to sit in a row. */
export const STAGE_STRIP: readonly { key: ShootStage; label: string }[] = SHOOT_STAGES.map(s => ({
  key: s.key, label: s.key === 'footage_handed' ? 'Footage in' : s.label,
}))

const STAGE_ORDER: ShootStage[] = SHOOT_STAGES.map(s => s.key)
export const stageIndex = (s: ShootStage) => STAGE_ORDER.indexOf(s)

/**
 * Which column a shoot is in, read off its stamps and the calendar.
 *
 * A shoot that was booked before these stamps existed is at least Shared —
 * booking committed the team to it. A shoot whose date has arrived is on
 * Shoot day whatever was or was not stamped, until the footage is handed
 * over; a closed shoot is past everything.
 */
export function shootStage(b: SopShoot, today: string): ShootStage {
  if (b.footage_handed_at || b.status === 'wrapped') return 'footage_handed'
  const days = daysUntilShoot(b, today)
  if (days !== null && days <= 0) return 'shoot_day'
  if (b.reminder_sent_at) return 'reminder_sent'
  if (b.go_at) return 'confirmed'
  if (b.brief_shared_at || b.status === 'locked' || b.status === 'shot') return 'shared'
  return 'drafting'
}

/** Late: still Drafting with less than 7 days to the shoot (or the day gone). */
export function briefIsLate(b: SopShoot, today: string): boolean {
  if (shootStage(b, today) !== 'drafting') return false
  const days = daysUntilShoot(b, today)
  return days !== null && days < BRIEF_LEAD_DAYS
}

export const LATE_WORDS = 'Plan is late — needed 7 days before the shoot'

/** The clock on the card: "12 days to the shoot", "Shoot is today", the late line. */
export function clockWords(b: SopShoot, today: string): string | null {
  const days = daysUntilShoot(b, today)
  if (days === null) return 'No shoot date yet'
  if (briefIsLate(b, today)) return LATE_WORDS
  if (days === 0) return 'Shoot is today'
  if (days < 0) return days === -1 ? 'Shot yesterday' : `Shot ${-days} days ago`
  if (days === 1) return 'Shoot is tomorrow'
  return `${days} days to the shoot`
}

/* ── acknowledgements ──────────────────────────────────────────────────── */

export type AckState = {
  done: number
  total: number
  complete: boolean
  /** ids still to acknowledge */
  missing: string[]
  /** "3 of 5 acknowledged" — "Nobody on the shoot yet" with no crew */
  words: string
}

export function ackState(b: SopShoot): AckState {
  const people = peopleOnShoot(b)
  const acked = new Set(acksOf(b).map(a => a.user_id))
  const missing = people.filter(id => !acked.has(id))
  const done = people.length - missing.length
  return {
    done, total: people.length, complete: people.length > 0 && missing.length === 0, missing,
    words: people.length === 0 ? 'Nobody on the shoot yet' : `${done} of ${people.length} acknowledged`,
  }
}

export function hasAcknowledged(b: SopShoot, userId: string): boolean {
  return acksOf(b).some(a => a.user_id === userId)
}

/** The acknowledgement list with this person on it — one press, idempotent. */
export function withAck(b: SopShoot, userId: string, at: string): Ack[] {
  const acks = acksOf(b)
  return acks.some(a => a.user_id === userId) ? acks : [...acks, { user_id: userId, at }]
}

export function withoutAck(b: SopShoot, userId: string): Ack[] {
  return acksOf(b).filter(a => a.user_id !== userId)
}

/* ── the Go sign-off ───────────────────────────────────────────────────── */

export type GoCheck = {
  ok: boolean
  reasons: string[]
  /** the only thing in the way is the 7-day rule: a super admin may go
   *  ahead with a reason */
  needsOverride: boolean
}

export type GoInput = ChecklistInput & {
  /** who is pressing — a super admin may override the 7-day rule */
  role?: MoveRole
  /** the super admin's one line on why it goes ahead late */
  overrideReason?: string | null
}

/** §3.4: the shoot is not "go" until the AM has verified all four — and,
 *  since 11 Sep 2026, the plan was shared 7 days before the shoot ("no
 *  brief, no shoot"). A shoot already go is never re-judged. */
export function goReady(b: SopShoot, input: GoInput = {}): GoCheck {
  const reasons: string[] = []
  const list = briefChecklist(b, input)
  if (!list.complete) reasons.push(`The plan is not complete — ${list.missing.map(m => m.label.toLowerCase()).join(', ')} still to fill in`)
  if (!b.aligned_at) reasons.push('Tick “Aligned with the strategist” once the direction is agreed')
  if (!b.client_confirmed_at) reasons.push('Tick “Client availability and location confirmed”')
  const ack = ackState(b)
  if (ack.total === 0) reasons.push('Add the people on this shoot — nobody has been asked to read the plan')
  else if (!ack.complete) reasons.push(`${ack.missing.length} of ${ack.total} on the shoot have not acknowledged the plan`)
  let needsOverride = false
  if (!b.go_at && sharedLate(b)) {
    const overridden = input.role === 'super_admin' && text(input.overrideReason).length > 0
    if (!overridden) {
      reasons.push(sharedLateWords(b))
      needsOverride = true
    }
  }
  return { ok: reasons.length === 0, reasons, needsOverride: needsOverride && reasons.length === 1 }
}

/* ── booking, as go does it ────────────────────────────────────────────── */

/** The stamps "Book the shoot" writes, when go finds the shoot unbooked and
 *  dated; nothing for a shoot already booked or with no date. */
export function bookingPatch(b: Pick<SopShoot, 'status' | 'shoot_date'>, now: string, actorId: string): Record<string, unknown> {
  if ((b.status ?? 'brief') !== 'brief') return {}
  const d = text(b.shoot_date).slice(0, 10)
  if (!d) return {}
  const t = new Date(`${d}T00:00:00Z`)
  if (Number.isNaN(t.getTime())) return {}
  return { status: 'locked', locked_at: now, locked_by: actorId, month: t.getUTCMonth() + 1, year: t.getUTCFullYear() }
}

/* ── moving between columns ────────────────────────────────────────────── */

export type MoveRole = 'super_admin' | 'account_manager' | 'general' | 'editor' | 'scheduler' | 'client'

export type MoveInput = {
  role: MoveRole
  today: string
  checklist?: ChecklistInput
  /** a super admin's reason for going ahead with a plan shared late */
  overrideReason?: string | null
}

export type MoveResult =
  | { ok: true; patch: Record<string, unknown>; label: string }
  | { ok: false; reason: string; needsOverride?: boolean }

const isManager = (r: MoveRole) => r === 'account_manager' || r === 'super_admin'
const canEdit = (r: MoveRole) => isManager(r) || r === 'editor' || r === 'general'

/**
 * What dragging a shoot to a column means, and whether the SOP allows it.
 * `patch` is the stamps to write; the route writes them with a claim that
 * checks the shoot is still where it was.
 */
export function stageMove(b: SopShoot, to: ShootStage, input: MoveInput, now: string, actorId: string): MoveResult {
  const from = shootStage(b, input.today)
  if (from === to) return { ok: false, reason: `Already in ${STAGE_LABEL[to]}` }
  if (b.status === 'wrapped') return { ok: false, reason: 'This shoot is closed' }
  if (input.role === 'client' || input.role === 'scheduler') return { ok: false, reason: 'Only the team on the shoot moves it' }

  const forward = stageIndex(to) > stageIndex(from)
  if (!forward) {
    if (!isManager(input.role)) return { ok: false, reason: 'Only an account manager can move a shoot back' }
    if (from === 'shoot_day') return { ok: false, reason: 'The calendar put it on Shoot day — change the shoot date to move it' }
    if (to === 'shoot_day') return { ok: false, reason: 'The calendar decides Shoot day — set the date instead' }
    // clear every stamp past the target column
    const patch: Record<string, unknown> = {}
    if (stageIndex(to) < stageIndex('footage_handed')) { patch.footage_handed_at = null; patch.footage_handed_by = null }
    if (stageIndex(to) < stageIndex('reminder_sent')) patch.reminder_sent_at = null
    if (stageIndex(to) < stageIndex('confirmed')) { patch.go_at = null; patch.go_by = null }
    if (stageIndex(to) < stageIndex('shared')) { patch.brief_shared_at = null; patch.brief_shared_by = null }
    return { ok: true, patch, label: `Moved back to ${STAGE_LABEL[to]}` }
  }

  switch (to) {
    case 'shared': {
      if (!canEdit(input.role)) return { ok: false, reason: 'Only the team writing the plan can share it' }
      const list = briefChecklist(b, input.checklist)
      if (!list.complete) return { ok: false, reason: `Not yet — ${list.missing.map(m => m.label.toLowerCase()).join(', ')} still to fill in. Nothing moves forward on half-information.` }
      return { ok: true, patch: { brief_shared_at: now, brief_shared_by: actorId }, label: 'Plan shared with the team' }
    }
    case 'confirmed': {
      if (!isManager(input.role)) return { ok: false, reason: 'Only an account manager signs a shoot off as go' }
      if (from === 'drafting') return { ok: false, reason: 'Share the plan with the team first' }
      const go = goReady(b, { ...input.checklist, role: input.role, overrideReason: input.overrideReason })
      if (!go.ok) return { ok: false, reason: go.reasons[0], needsOverride: go.needsOverride }
      const overrode = sharedLate(b) && input.role === 'super_admin' && text(input.overrideReason).length > 0
      return {
        ok: true,
        patch: {
          go_at: now, go_by: actorId,
          ...(overrode ? { go_override_reason: text(input.overrideReason), go_override_by: actorId } : {}),
          ...(b.brief_shared_at ? {} : { brief_shared_at: now, brief_shared_by: actorId }),
          // THE SOP HAS ONE SIGN-OFF: go books the shoot too. An AM who
          // booked early is left as they are; an unbooked shoot with a date
          // is booked here, never refused for being unbooked.
          ...bookingPatch(b, now, actorId),
        },
        label: overrode ? 'Shoot confirmed — went ahead late, with a reason' : 'Shoot confirmed — it is go',
      }
    }
    case 'reminder_sent': {
      if (!canEdit(input.role)) return { ok: false, reason: 'Only the team sends the reminder' }
      if (from !== 'confirmed') return { ok: false, reason: 'Sign the shoot off as go before the reminder goes out' }
      return { ok: true, patch: { reminder_sent_at: now }, label: 'Reminder sent' }
    }
    case 'shoot_day':
      return { ok: false, reason: 'The calendar moves a shoot here on the day — set the shoot date instead' }
    case 'footage_handed': {
      if (!canEdit(input.role)) return { ok: false, reason: 'Only the team hands footage over' }
      const days = daysUntilShoot(b, input.today)
      if (days === null || days > 0) return { ok: false, reason: 'The shoot has not happened yet' }
      if (!b.editor_id) return { ok: false, reason: 'Name the editor on the shoot first — the footage is handed to them' }
      if (!text(b.editor_priorities) || !text(b.edit_deadline)) return { ok: false, reason: 'Write the editor priorities and the deadline first — that is the handover' }
      return { ok: true, patch: { footage_handed_at: now, footage_handed_by: actorId }, label: 'Footage handed to the editor' }
    }
  }
  return { ok: false, reason: 'That move is not one the SOP has' }
}

/* ── the handover: Production → Editor ─────────────────────────────────── */

export type HandoverItem = {
  id: string
  batch_id?: string | null
  owner_id?: string | null
  due_date?: string | null
  brief?: string | null
  work_kinds?: { slug?: string } | null
}

export type HandoverPlan = {
  /** the shoot's one card, when the shoot has no deliverable card yet */
  create: (PlanCard & { owner_id: string; due_date: string; brief: string })[]
  /** cards that exist, with only the empty fields filled */
  fill: { id: string; patch: { owner_id?: string; due_date?: string; brief?: string } }[]
  /** how many cards the editor now holds for this shoot */
  total: number
}

/**
 * What the handover makes and fills.
 *
 * ONE SHOOT, ONE CARD (11 Sep 2026): a shoot with no deliverable card yet
 * gets its one card now — titled with the shoot, owned by the editor, due on
 * the editor deadline, briefed with the list of what is coming out and the
 * priorities. Cards that exist (the one card, or the older one-per-line
 * cards, or cards made by hand and pointed at the shoot) keep what they have
 * and get only their empty fields filled. The shoot's own plan card is
 * paperwork and is never handed to anyone. Idempotent by construction: the
 * same input plans nothing the second time.
 */
export function handoverPlan(b: SopShoot, items: readonly HandoverItem[]): HandoverPlan {
  const editor = b.editor_id ?? ''
  const due = text(b.edit_deadline)
  const brief = text(b.editor_priorities)
  const byId = new Map(items.filter(i => i.batch_id === b.id).map(i => [i.id, i]))
  const create: HandoverPlan['create'] = []
  const hasDeliverable = [...byId.values()].some(i => i.work_kinds?.slug !== 'shoot_brief')
  const one = shootCard({ id: b.id, client_id: b.client_id, title: b.title ?? null }, b.planned_deliverables)
  if (!hasDeliverable && one) {
    const { planned: _planned, lines, ...card } = one
    void _planned
    create.push({ ...card, owner_id: editor, due_date: due, brief: deliverablesBrief(lines.map((t, i) => ({ id: String(i), title: t })), brief) })
  }
  const fill: HandoverPlan['fill'] = []
  let held = create.length
  for (const it of byId.values()) {
    if (it.work_kinds?.slug === 'shoot_brief') continue
    const patch: { owner_id?: string; due_date?: string; brief?: string } = {}
    if (!it.owner_id && editor) patch.owner_id = editor
    if (!it.due_date && due) patch.due_date = due
    if (!text(it.brief) && brief) patch.brief = brief
    if (it.owner_id === editor || patch.owner_id) held += 1
    if (Object.keys(patch).length > 0) fill.push({ id: it.id, patch })
  }
  return { create, fill, total: held }
}

/* ── the 7-day nudge ───────────────────────────────────────────────────── */

/** The shoots whose brief is late and who have not been told yet. */
export function lateNudgeTargets<T extends SopShoot>(shoots: readonly T[], today: string): T[] {
  return shoots.filter(b => briefIsLate(b, today) && !b.late_nudged_at)
}

/* ── shared late ───────────────────────────────────────────────────────── */

/** How many days before the shoot the plan was shared — null until both
 *  dates exist. 7 or more is on time. */
export function shareLeadDays(b: Pick<SopShoot, 'shoot_date' | 'brief_shared_at'>): number | null {
  const shot = text(b.shoot_date).slice(0, 10)
  const shared = text(b.brief_shared_at).slice(0, 10)
  if (!shot || !shared) return null
  const a = Date.parse(`${shot}T00:00:00Z`)
  const s = Date.parse(`${shared}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(s)) return null
  return Math.round((a - s) / DAY_MS)
}

/** Shared, but with fewer than 7 days to the shoot. */
export function sharedLate(b: Pick<SopShoot, 'shoot_date' | 'brief_shared_at'>): boolean {
  const n = shareLeadDays(b)
  return n !== null && n < BRIEF_LEAD_DAYS
}

/** The SOP's sentence, with the number in it. */
export function sharedLateWords(b: Pick<SopShoot, 'shoot_date' | 'brief_shared_at'>): string {
  const n = Math.max(0, shareLeadDays(b) ?? 0)
  return `The plan was shared ${n} day${n === 1 ? '' : 's'} before the shoot — the playbook needs ${BRIEF_LEAD_DAYS}. A super admin can override with a reason.`
}

/** Shoots shared late that Ops has not yet been told about — once each. */
export function lateShareNudgeTargets<T extends SopShoot>(shoots: readonly T[]): T[] {
  return shoots.filter(b => sharedLate(b) && !b.late_share_nudged_at && b.status !== 'wrapped')
}

/** The chip on a shoot a super admin took ahead late. */
export function overrideWords(b: Pick<SopShoot, 'go_override_reason'>): string | null {
  const r = text(b.go_override_reason)
  return r ? `Went ahead late — ${r}` : null
}

/* ── visibility ────────────────────────────────────────────────────────── */

export type SopViewer = { id: string; role: MoveRole; client_id?: string | null }

/**
 * May this person see this shoot? A super admin sees everything; a general
 * user any client; the client's own team by assignment; and anyone on the
 * shoot — its creator, its editor, its crew — whichever client it is for.
 */
export function canSeeShoot(
  viewer: SopViewer,
  b: SopShoot,
  clientIdsOfViewer: readonly string[],
): boolean {
  if (viewer.role === 'super_admin' || viewer.role === 'general') return true
  if (viewer.role === 'client') return viewer.client_id === b.client_id
  if (clientIdsOfViewer.includes(b.client_id)) return true
  return isOnShoot(b, viewer.id)
}

/* ── the one line under the strip: what happens next, and who ─────────── */

function shortDay(iso: string | null | undefined): string | null {
  const d = text(iso).slice(0, 10)
  if (!d) return null
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

/**
 * THE FLOW, ON THE PAGE (the owner, 11 Sep 2026: "you need to explain to
 * be in the shoot creation page"). One sentence for where the shoot is and
 * what the next move is, naming who makes it. Read by the strip on the
 * shoot page and by the board card; the same rules `stageMove` and
 * `goReady` keep, so it never promises a button the route would refuse.
 */
export function nextStepWords(b: SopShoot, today: string, input: GoInput = {}): string {
  const stage = shootStage(b, today)
  const when = shortDay(b.shoot_date)
  const due = shortDay(b.edit_deadline)
  switch (stage) {
    case 'drafting': {
      const list = briefChecklist(b, input)
      if (!list.complete) {
        return `Next: fill in the plan — ${list.missing.map(m => m.label.toLowerCase()).join(', ')} still to go — then share it with the team. Refused until all nine parts are filled.`
      }
      return 'Next: share the plan with the team. Everyone on it is emailed and asked to read it.'
    }
    case 'shared': {
      const ack = ackState(b)
      if (ack.total === 0) return 'Next: add the editor and the crew, so there is somebody to read the plan.'
      if (!ack.complete) return `Next: everyone on the shoot presses “I’ve read the plan” — waiting on ${ack.missing.length} of ${ack.total}.`
      if (!b.aligned_at || !b.client_confirmed_at) return 'Next: the account manager ticks “Aligned with the strategist” and “Client and location confirmed”, then presses Go.'
      if (!b.go_at && sharedLate(b)) return `${sharedLateWords(b)}`
      return 'Next: the account manager presses Go. That books the shoot and puts the editor’s card on the Editor page.'
    }
    case 'confirmed':
      return `Confirmed${when ? ` for ${when}` : ''}. The editor’s card is on the Editor page${due ? `, due ${due}` : ''}. Next: Ops presses Reminder sent the day before the shoot.`
    case 'reminder_sent':
      return `Reminder sent. Next: the shoot${when ? ` on ${when}` : ''}. Nothing to press until then.`
    case 'shoot_day': {
      const days = daysUntilShoot(b, today)
      if (days === 0) return 'Shooting today. The footage is handed to the editor tomorrow morning by itself — or press “Footage is in” once it is.'
      return 'Shot. The footage is handed to the editor this morning by itself — press “Footage is in” if it is already.'
    }
    case 'footage_handed':
      return `Footage should be in — the editor has been told. The work is on the Editor page${due ? `, due ${due}` : ''}.`
  }
}

/* ── the handover, without a press ─────────────────────────────────────── */

/**
 * Go is the handover (11 Sep 2026): the cards are made and given to the
 * editor the moment the shoot is confirmed, so the editor sees their work
 * from the day the shoot is booked, marked "footage after the shoot".
 * Handing over needs the three things the SOP names: the editor, the
 * priorities and the deadline. Missing any, the cards are still made; only
 * the empty fields wait.
 */
export function handoverReady(b: Pick<SopShoot, 'editor_id' | 'editor_priorities' | 'edit_deadline'>): boolean {
  return !!b.editor_id && text(b.editor_priorities).length > 0 && text(b.edit_deadline).length > 0
}

/** The chip on an editor's card before the shoot: "Shoot on 21 Sept — footage after that". */
export function footageAfterWords(b: Pick<SopShoot, 'shoot_date'>, today: string): string | null {
  const days = daysUntilShoot(b, today)
  if (days === null || days < 0) return null
  const when = shortDay(b.shoot_date)
  return days === 0 ? 'Shooting today — footage after that' : `Shoot on ${when} — footage after that`
}

/**
 * The morning after the shoot: a confirmed shoot whose day has passed and
 * whose footage nobody marked as in is handed over BY ITSELF, and the
 * editor told once. A shoot with no editor named cannot be handed to
 * anyone — its account manager is asked to name one instead, once.
 */
export function footageDueTargets<T extends SopShoot>(shoots: readonly T[], today: string): { hand: T[]; askEditor: T[] } {
  const hand: T[] = []
  const askEditor: T[] = []
  for (const b of shoots) {
    if (b.footage_due_nudged_at || b.footage_handed_at || b.status === 'wrapped') continue
    if (!b.go_at && b.status !== 'locked' && b.status !== 'shot') continue
    const days = daysUntilShoot(b, today)
    if (days === null || days >= 0) continue
    if (b.editor_id) hand.push(b)
    else askEditor.push(b)
  }
  return { hand, askEditor }
}

/* ── the footage folder: where the footage lives ───────────────────────── */

/**
 * "How do they get the Dropbox link?" (the owner, 11 Sep 2026). Whoever has
 * the footage pastes its folder on the shoot page. When the footage is
 * handed over — by a press or by the morning sweep — every card from the
 * shoot with no "Files to work from" folder yet gets it; a card somebody
 * already pointed at a folder keeps theirs. Pure: which cards, from which
 * link. Idempotent by construction.
 */
export function footageFolderFill(
  b: Pick<SopShoot, 'id' | 'footage_url'>,
  items: readonly { id: string; batch_id?: string | null; raw_assets_url?: string | null; work_kinds?: { slug?: string } | null }[],
): { id: string; raw_assets_url: string }[] {
  const url = text(b.footage_url)
  if (!url) return []
  return items
    .filter(i => i.batch_id === b.id && i.work_kinds?.slug !== 'shoot_brief' && !text(i.raw_assets_url))
    .map(i => ({ id: i.id, raw_assets_url: url }))
}
