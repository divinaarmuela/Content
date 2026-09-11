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
 * The Shoot brief boards page draws those as six columns. A column is never
 * a stored status — it is READ off the stamps on the shoot and the
 * calendar (`shootStage`), so a shoot can never sit in a column its data
 * contradicts, and dragging a card is asking for the stamp the next column
 * means (`stageMove`), refused in words when the SOP says no.
 */

import { planCards, type PlanCard } from './deliverable-group-core'

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

export function briefItemFilled(b: SopShoot, key: BriefItemKey, input: ChecklistInput = {}): boolean {
  switch (key) {
    case 'objective': return text(b.objective).length > 0
    case 'deliverables': return (Array.isArray(b.planned_deliverables) && b.planned_deliverables.length > 0) || (input.itemCount ?? 0) > 0
    case 'shot_list': return Array.isArray(b.shot_list) && b.shot_list.length > 0
    case 'script': return text(b.script).length > 0
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

export type GoCheck = { ok: boolean; reasons: string[] }

/** §3.4: the shoot is not "go" until the AM has verified all four. */
export function goReady(b: SopShoot, input: ChecklistInput = {}): GoCheck {
  const reasons: string[] = []
  const list = briefChecklist(b, input)
  if (!list.complete) reasons.push(`The plan is not complete — ${list.missing.map(m => m.label.toLowerCase()).join(', ')} still to fill in`)
  if (!b.aligned_at) reasons.push('Tick “Aligned with the strategist” once the direction is agreed')
  if (!b.client_confirmed_at) reasons.push('Tick “Client availability and location confirmed”')
  const ack = ackState(b)
  if (ack.total === 0) reasons.push('Add the people on this shoot — nobody has been asked to read the plan')
  else if (!ack.complete) reasons.push(`${ack.missing.length} of ${ack.total} on the shoot have not acknowledged the plan`)
  return { ok: reasons.length === 0, reasons }
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
}

export type MoveResult =
  | { ok: true; patch: Record<string, unknown>; label: string }
  | { ok: false; reason: string }

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
      const go = goReady(b, input.checklist)
      if (!go.ok) return { ok: false, reason: go.reasons[0] }
      return {
        ok: true,
        patch: {
          go_at: now, go_by: actorId,
          ...(b.brief_shared_at ? {} : { brief_shared_at: now, brief_shared_by: actorId }),
          // THE SOP HAS ONE SIGN-OFF: go books the shoot too. An AM who
          // booked early is left as they are; an unbooked shoot with a date
          // is booked here, never refused for being unbooked.
          ...bookingPatch(b, now, actorId),
        },
        label: 'Shoot confirmed — it is go',
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
  /** deliverables on the plan with no card yet — each becomes one card */
  create: (PlanCard & { owner_id: string; due_date: string; brief: string })[]
  /** cards that exist, with only the empty fields filled */
  fill: { id: string; patch: { owner_id?: string; due_date?: string; brief?: string } }[]
  /** how many cards the editor now holds for this shoot */
  total: number
}

/**
 * Which deliverables become which cards when the footage is handed over.
 *
 * Every line of the plan already has a fixed card id (`planCardId`) and the
 * booking may have made the card; a line whose card is missing is made now,
 * owned by the editor, due on the editor deadline, briefed with the editor
 * priorities. Cards that exist keep what they have and get only their empty
 * fields filled. The shoot's own plan card is paperwork and is never handed
 * to anyone. Idempotent by construction: the same input plans nothing the
 * second time.
 */
export function handoverPlan(b: SopShoot, items: readonly HandoverItem[]): HandoverPlan {
  const editor = b.editor_id ?? ''
  const due = text(b.edit_deadline)
  const brief = text(b.editor_priorities)
  const byId = new Map(items.filter(i => i.batch_id === b.id).map(i => [i.id, i]))
  const create: HandoverPlan['create'] = []
  for (const card of planCards({ id: b.id, client_id: b.client_id }, b.planned_deliverables)) {
    if (byId.has(card.id)) continue
    create.push({ ...card, owner_id: editor, due_date: due, brief })
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
