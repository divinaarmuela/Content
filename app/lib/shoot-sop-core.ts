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

import { sanitiseScripts, scriptsFilled, scriptsText } from './script-core'
import { bulletText } from './bullet-core'
import { planCards, type PlanCard, shootCard, deliverablesBrief } from './deliverable-group-core'
import { dayKeyInZone } from './timezone-core'

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
  review_asked_at?: string | null
  plan_reviewed_at?: string | null
  /** the script blocks (app/lib/script-core.ts), beside the plain `script` */
  scripts?: unknown
  review_asked_to?: unknown
  plan_sent_back_at?: string | null
  plan_sent_back_note?: string | null
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
  /* ── who did what (13 Sep 2026: "do we actually know … reviewed by who
   *    and created by who") — every stamp carries its person; a row from
   *    before these columns reads as "by the team" ── */
  created_by?: string | null
  created_at?: string | null
  brief_shared_by?: string | null
  aligned_by?: string | null
  review_asked_by?: string | null
  plan_reviewed_by?: string | null
  plan_sent_back_by?: string | null
  client_confirmed_by?: string | null
  go_by?: string | null
  reminder_sent_by?: string | null
  footage_handed_by?: string | null
  /** the editor pressed "Got the footage" (14 Sep 2026) */
  footage_received_at?: string | null
  footage_received_by?: string | null
  /** the one reminder when it sits unconfirmed the morning after */
  footage_receipt_nudged_at?: string | null
  /* ── the client's answer, on the shoot itself: the plan went to the
   *    portal from this page, and the client approved it or asked for
   *    changes there ── */
  shared_with_client?: boolean | null
  client_shared_at?: string | null
  client_shared_by?: string | null
  client_decision?: string | null
  client_decided_at?: string | null
  client_decision_note?: string | null
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
  | 'talent' | 'props' | 'editor'

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
  if (key === 'script') return text(b.script).length > 0 || scriptsFilled(b.scripts) ? 'field' : 'canvas'
  return 'field'
}

export function briefItemFilled(b: SopShoot, key: BriefItemKey, input: ChecklistInput = {}): boolean {
  switch (key) {
    case 'objective': return text(b.objective).length > 0
    case 'deliverables': return (Array.isArray(b.planned_deliverables) && b.planned_deliverables.length > 0) || (input.itemCount ?? 0) > 0
    case 'shot_list': return (Array.isArray(b.shot_list) && b.shot_list.length > 0) || canvasSays(b).shotList
    case 'script': return text(b.script).length > 0 || scriptsFilled(b.scripts) || canvasSays(b).script
    case 'when_where': return text(b.shoot_date).length > 0 && text(b.call_time).length > 0 && text(b.location).length > 0
    case 'talent': return text(b.talent).length > 0
    case 'props': return text(b.props_wardrobe).length > 0
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

export type ShootStage = 'drafting' | 'quality_review' | 'shared' | 'confirmed' | 'reminder_sent' | 'shoot_day' | 'footage_handed'

export const SHOOT_STAGES: readonly { key: ShootStage; label: string; meaning: string; empty: string }[] = [
  { key: 'drafting', label: 'Draft', meaning: 'The account manager is writing the plan. It leaves here once all eight parts are filled in.', empty: 'Nothing being written.' },
  // THE QUALITY REVIEW COLUMN (the owner, 13 Sep 2026: "add a new column so
  // when we set it for quality review then it goes there, like other pages")
  { key: 'quality_review', label: 'Quality review', meaning: 'The plan is with the quality checker. It leaves here when they pass it, or send it back with a note.', empty: 'Nothing waiting on the quality checker.' },
  { key: 'shared', label: 'Shared with team', meaning: 'The plan is out, 7 days before the shoot. Everyone on it reads and acknowledges it.', empty: 'No brief out with the team.' },
  { key: 'confirmed', label: 'Confirmed', meaning: 'The account manager signed it off as go: plan complete, strategist aligned, client and location confirmed, everyone acknowledged.', empty: 'Nothing confirmed yet.' },
  { key: 'reminder_sent', label: 'Reminder sent', meaning: 'Ops sent the day-before reminder: call time, location, everyone knows their role.', empty: 'No reminders out.' },
  { key: 'shoot_day', label: 'Shoot day', meaning: 'Filming, to the plan. The calendar puts a shoot here on the day.', empty: 'No shoot today.' },
  { key: 'footage_handed', label: 'Footage in', meaning: 'The footage is with the editor, with priorities and a deadline, and the work is on the Editor page.', empty: 'No footage in yet.' },
]

export const STAGE_LABEL: Record<ShootStage, string> = Object.fromEntries(SHOOT_STAGES.map(s => [s.key, s.label])) as Record<ShootStage, string>

/** The same stages as a strip across the shoot page — the column words:
 *  Draft · Quality review · Shared with team · Confirmed · Reminder sent ·
 *  Shoot day · Footage in. Quality review is drawn only on a plan the gate
 *  applies to (the page filters it). */
export const STAGE_STRIP: readonly { key: ShootStage; label: string }[] = SHOOT_STAGES.map(s => ({ key: s.key, label: s.label }))

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
export function shootStage(b: SopShoot, today: string, opts?: StageOpts): ShootStage {
  if (b.footage_handed_at || b.status === 'wrapped') return 'footage_handed'
  const days = daysUntilShoot(b, today)
  if (days !== null && days <= 0) return 'shoot_day'
  if (b.reminder_sent_at) return 'reminder_sent'
  if (b.go_at) return 'confirmed'
  // THE ONE RULE for the Quality review column: the gate applies, a review
  // was asked, and the quality checker has not passed it. Sent back clears
  // the ask, so the shoot falls back to where it was. Callers that do not
  // know the gate (the sweeps, the late rule) never see this column.
  if (opts?.planReview && inQualityReview(b)) return 'quality_review'
  if (b.brief_shared_at || b.status === 'locked' || b.status === 'shot') return 'shared'
  return 'drafting'
}

/** Which caller knows the gate — see `planReviewRequired`. */
export type StageOpts = { planReview?: boolean }

/** Asked and not passed: the shoot is with the quality checker. */
export function inQualityReview(b: Pick<SopShoot, 'review_asked_at' | 'plan_reviewed_at' | 'go_at' | 'brief_shared_at'>): boolean {
  if (!b.review_asked_at || b.go_at) return false
  // PASSED BUT NOT YET SHARED stays in the column, marked Passed, until the
  // account manager shares it (the owner, 13 Sep 2026: "after passing
  // quality review why does it end up back in Draft?") — a shoot never
  // moves backwards on a pass
  return !b.plan_reviewed_at || !b.brief_shared_at
}

/** Was this person asked to quality review this plan? (Not "on the shoot":
 *  a reviewer reads the plan; they are never asked to acknowledge it.) */
export function isAskedToReview(b: Pick<SopShoot, 'review_asked_to'>, userId: string): boolean {
  return Array.isArray(b.review_asked_to) && b.review_asked_to.map(String).includes(userId)
}

export const REVIEW_OUT_WORDS = 'Only the quality checker passes a plan — use Pass the plan on the shoot page'
export const NOT_GATED_WORDS = 'This plan does not need a quality review'

/**
 * Did this stage actually happen, or did the calendar carry the shoot past
 * it? A shoot that was never shared still lands on Shoot day when the date
 * comes — the strip must not tick "Shared with team" for it (the owner saw
 * exactly that on 13 Sep 2026: four ticks on a plan nobody shared).
 */
export function stageHappened(b: SopShoot, key: ShootStage, today: string): boolean {
  switch (key) {
    case 'drafting': return true
    case 'quality_review': return !!b.plan_reviewed_at
    case 'shared': return !!b.brief_shared_at || b.status === 'locked' || b.status === 'shot'
    case 'confirmed': return !!b.go_at
    case 'reminder_sent': return !!b.reminder_sent_at
    case 'shoot_day': { const d = daysUntilShoot(b, today); return d !== null && d <= 0 }
    case 'footage_handed': return !!b.footage_handed_at || b.status === 'wrapped'
  }
}

/** Late: still Drafting with less than 7 days to the shoot (or the day gone). */
export function briefIsLate(b: SopShoot, today: string): boolean {
  if (shootStage(b, today) !== 'drafting') return false
  const days = daysUntilShoot(b, today)
  return days !== null && days < BRIEF_LEAD_DAYS
}

export const LATE_WORDS = 'Plan is late — needed 7 days before the shoot'

/** THE FOOTAGE FOLDER IS STILL MISSING after the shoot day: the editor's card
 *  has nowhere to work from until the account manager (or the crew) pastes
 *  it — on the shoot page or on the card (the owner, 14 Sep 2026: "how does
 *  the AM know it needs the footage? It needs to show clearly on the
 *  Overview, for the super admin too"). Wrapped shoots are done. */
export function footageFolderNeeded(b: SopShoot, today: string): boolean {
  if (b.status === 'wrapped') return false
  const days = daysUntilShoot(b, today)
  return days !== null && days <= 0 && text(b.footage_url).length === 0
}

export const FOOTAGE_NEEDED_WORDS = 'Footage folder link needed — the editor has nowhere to work from'

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
  /** does this plan need the quality checker's pass before Go — see
   *  `planReviewRequired`; the route and the page work it out from the
   *  creator's and the owner's roles */
  planReview?: { required: boolean }
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
  if (!b.client_confirmed_at) reasons.push('Tick “Location confirmed”')
  if (input.planReview?.required && !planReviewPassed(b)) reasons.push(PLAN_REVIEW_WORDS)
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

export type MoveRole = 'super_admin' | 'account_manager' | 'general' | 'quality_checker' | 'editor' | 'scheduler' | 'client'

/* ── whose page this is ────────────────────────────────────────────────── */

/**
 * WHO MAY DO WHAT ON A SHOOT (the owner, 12 Sep 2026: "shouldn't it be the
 * AM or the person who created the brief"): the account manager(s) on the
 * client, the person who created the shoot, a super admin, and a general
 * user. They write the nine parts, tick the two ticks, move the stages,
 * paste the footage folder and pick the editor and crew. Editors,
 * schedulers and crew do NOTHING on the shoot page and never open it — they
 * read the plan on their Editor card or in their email.
 */
export type SopManager = {
  id: string
  role: MoveRole
  /** the clients this person is assigned to — an account manager's list;
   *  undefined means "not known here", and the role alone is trusted (the
   *  board and the tests); the routes always pass the real list */
  clientIds?: readonly string[]
}

export const NOT_YOURS = 'Only the account manager on this client, the person who created the shoot, or a super admin can do that'

/** Where an editor, a scheduler or a crew member is sent instead: their
 *  shoots are cards on the Editor page, and the plan is on the card. */
export const NOT_YOUR_PAGE = { error: 'The shoot page is the account manager’s. Your shoots are cards on the Editor page — the plan is on the card.', redirect: '/dashboard/editor' } as const

export function canManageShoot(who: SopManager, b: Pick<SopShoot, 'client_id' | 'owner_id' | 'created_by'>): boolean {
  if (who.role === 'super_admin' || who.role === 'general') return true
  if (who.role === 'client') return false
  if (b.owner_id === who.id || b.created_by === who.id) return true
  if (who.role !== 'account_manager') return false
  return who.clientIds === undefined || who.clientIds.includes(b.client_id)
}

export type MoveInput = {
  role: MoveRole
  today: string
  /** the quality review gate, worked out by the caller — see `goReady` */
  planReview?: { required: boolean }
  checklist?: ChecklistInput
  /** a super admin's reason for going ahead with a plan shared late */
  overrideReason?: string | null
  /** the mover's clients, when known — see `SopManager` */
  clientIds?: readonly string[]
  /** the mover is a quality checker (role or hat) — may take a plan out of Quality review */
  reviewer?: boolean
}

export type MoveResult =
  | { ok: true; patch: Record<string, unknown>; label: string; askReview?: true }
  | { ok: false; reason: string; needsOverride?: boolean }

/**
 * What dragging a shoot to a column means, and whether the SOP allows it.
 * `patch` is the stamps to write; the route writes them with a claim that
 * checks the shoot is still where it was.
 */
export function stageMove(b: SopShoot, to: ShootStage, input: MoveInput, now: string, actorId: string): MoveResult {
  const gated = input.planReview?.required === true
  const from = shootStage(b, input.today, { planReview: gated })
  if (from === to) return { ok: false, reason: `Already in ${STAGE_LABEL[to]}` }
  if (b.status === 'wrapped') return { ok: false, reason: 'This shoot is closed' }
  const reviewer = input.reviewer === true || input.role === 'quality_checker' || input.role === 'super_admin'
  // OUT of Quality review is the quality checker's: passing it, or sending
  // it back. A drag out by anyone else is refused, in so many words.
  if (from === 'quality_review' && !b.plan_reviewed_at) {
    if (!reviewer) return { ok: false, reason: REVIEW_OUT_WORDS }
    if (to === 'drafting' || to === 'shared') {
      if (to === 'shared' && !b.brief_shared_at) return { ok: false, reason: 'Share the plan with the team first' }
      return {
        ok: true,
        patch: {
          review_asked_at: null, review_asked_by: null, review_asked_to: null,
          ...(to === 'drafting' ? { brief_shared_at: null, brief_shared_by: null } : {}),
        },
        label: 'Taken out of quality review — back with the writer',
      }
    }
    // onward from here (Go and beyond) is the ordinary road, and Go asks
    // for the pass itself
  }
  // the shoot page is the manager's: the AM on the client, the creator, a
  // super admin, a general user — nobody else moves a shoot
  if (!canManageShoot({ id: actorId, role: input.role, clientIds: input.clientIds }, b)) return { ok: false, reason: NOT_YOURS }

  // INTO Quality review = "Ask for a review": the route asks the quality
  // checkers and stamps the ask; nothing to write here
  if (to === 'quality_review') {
    if (!gated) return { ok: false, reason: NOT_GATED_WORDS }
    if (b.plan_reviewed_at) return { ok: false, reason: 'The quality checker has already passed this plan' }
    if (from !== 'drafting' && from !== 'shared') return { ok: false, reason: 'A review is asked before the shoot is confirmed' }
    return { ok: true, patch: {}, label: 'Asked for a quality review', askReview: true }
  }

  // SHARING IS A STAMP, NOT A MOVE (the owner, 14 Sep 2026: "shoot day is
  // today, still it did not allow to send to the team"): a plan the calendar
  // has already carried to Shoot day can still be shared, right up to the
  // footage coming in — it never counts as moving backwards
  const lateShare = to === 'shared' && !b.brief_shared_at && from !== 'footage_handed'
  const forward = stageIndex(to) > stageIndex(from)
  if (!forward && !lateShare) {
    if (from === 'shoot_day') return { ok: false, reason: 'The calendar put it on Shoot day — change the shoot date to move it' }
    if (to === 'shoot_day') return { ok: false, reason: 'The calendar decides Shoot day — set the date instead' }
    // clear every stamp past the target column
    const patch: Record<string, unknown> = {}
    if (stageIndex(to) < stageIndex('footage_handed')) { patch.footage_handed_at = null; patch.footage_handed_by = null }
    if (stageIndex(to) < stageIndex('reminder_sent')) { patch.reminder_sent_at = null; patch.reminder_sent_by = null }
    if (stageIndex(to) < stageIndex('confirmed')) { patch.go_at = null; patch.go_by = null }
    if (stageIndex(to) < stageIndex('shared')) { patch.brief_shared_at = null; patch.brief_shared_by = null }
    return { ok: true, patch, label: `Moved back to ${STAGE_LABEL[to]}` }
  }

  switch (to) {
    case 'shared': {
      // A GATED PLAN IS SHARED ONLY ONCE THE QUALITY CHECKER PASSED IT (the
      // owner, 13 Sep 2026: "share plan with team only available once the
      // quality checker has passed it — make sure it's that way")
      if (gated && !planReviewPassed(b)) return { ok: false, reason: PLAN_REVIEW_WORDS }
      // THE PLAN IS SHARED WITH PEOPLE (the owner, 14 Sep 2026: "how come
      // share with the team is available when they did not even pick the
      // people to send to yet"): an editor or crew has to be named first
      if (peopleOnShoot(b).length === 0) return { ok: false, reason: NOBODY_ON_SHOOT_WORDS }
      const list = briefChecklist(b, input.checklist)
      if (!list.complete) return { ok: false, reason: `Not yet — ${list.missing.map(m => m.label.toLowerCase()).join(', ')} still to fill in.` }
      return { ok: true, patch: { brief_shared_at: now, brief_shared_by: actorId }, label: 'Plan shared with the team' }
    }
    case 'confirmed': {
      if (from === 'drafting' || (from === 'quality_review' && !b.brief_shared_at)) return { ok: false, reason: 'Share the plan with the team first' }
      const go = goReady(b, { ...input.checklist, role: input.role, overrideReason: input.overrideReason, planReview: input.planReview })
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
      if (from !== 'confirmed') return { ok: false, reason: 'Sign the shoot off as go before the reminder goes out' }
      return { ok: true, patch: { reminder_sent_at: now, reminder_sent_by: actorId }, label: 'Reminder sent' }
    }
    case 'shoot_day':
      return { ok: false, reason: 'The calendar moves a shoot here on the day — set the shoot date instead' }
    case 'footage_handed': {
      const days = daysUntilShoot(b, input.today)
      if (days === null || days > 0) return { ok: false, reason: 'The shoot has not happened yet' }
      // THE ORDER HOLDS ON A SAME-DAY SHOOT TOO (the owner, 14 Sep 2026: "they
      // have to share first, however quality check has to go through first
      // before sending the footage in"): review, then share, then footage
      if (gated && !planReviewPassed(b)) return { ok: false, reason: PLAN_REVIEW_WORDS }
      if (!b.brief_shared_at) return { ok: false, reason: 'Share the plan with the team first' }
      if (!b.editor_id) return { ok: false, reason: 'Name the editor on the shoot first — the footage is handed to them' }
      if (!text(b.editor_priorities) || !text(b.edit_deadline)) return { ok: false, reason: 'Write the editor priorities and the deadline first — that is the handover' }
      // the owner, 13 Sep 2026: "why can we click footage is in but [no] link
      // was pasted" — the editor has nothing to cut without the folder
      if (!text(b.footage_url)) return { ok: false, reason: 'Paste the footage folder link first — that is what the editor works from' }
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
  // the share stamp is an instant; its DAY is Melbourne's, not UTC's — at
  // 00:30 Melbourne the UTC date is still yesterday (a test caught it at
  // midnight, 13 Sep 2026)
  const shared = dayKeyInZone(text(b.brief_shared_at) || null, 'Australia/Melbourne') ?? ''
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
  return `The plan was shared ${n} day${n === 1 ? '' : 's'} before the shoot — it needs ${BRIEF_LEAD_DAYS}. A super admin can override with a reason.`
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
  // the client-wide view is the ACCOUNT MANAGER's: an editor or scheduler on
  // a client's team sees only the shoots they are named on (the owner, 12
  // Sep 2026: "shouldn't it be the ones they've tagged")
  if (viewer.role === 'account_manager' && clientIdsOfViewer.includes(b.client_id)) return true
  // the quality checker sees the plans asked of them (13 Sep 2026)
  if (viewer.role === 'quality_checker' && isAskedToReview(b, viewer.id)) return true
  return isOnShoot(b, viewer.id)
}

/* ── the one line under the strip: what happens next, and who ─────────── */

function shortDay(iso: string | null | undefined): string | null {
  const d = text(iso).slice(0, 10)
  if (!d) return null
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

/** An instant as a person reads it, in Melbourne: "Mon 14 Sept, 9:10 am". */
export function stampWords(iso: string | null | undefined): string | null {
  const t = new Date(text(iso))
  if (!text(iso) || Number.isNaN(t.getTime())) return null
  // a bare day (YYYY-MM-DD) is a calendar day, not an instant — no time on it
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(iso))) return new Date(`${text(iso)}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/^(\w{3}),/, '$1')
  return t.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    .replace(/^(\w{3}),/, '$1').replace(/\s?(am|pm)$/i, ' $1')
}

/* ── the client's answer, on the shoot ─────────────────────────────────── */

export type ClientDecision = 'approved' | 'changes'

/** The plan can go to the client once the nine parts are in, at any stage
 *  from Draft on — the creator often reviews it themselves and sends it
 *  (the owner, 13 Sep 2026); a closed shoot sends nothing. */
export function clientShareReady(b: SopShoot, input: ChecklistInput = {}): { ok: true } | { ok: false; reason: string } {
  if (b.status === 'wrapped') return { ok: false, reason: 'This shoot is closed' }
  const list = briefChecklist(b, input)
  if (!list.complete) return { ok: false, reason: 'Fill in the plan first.' }
  return { ok: true }
}

/** The stamps "Share the plan with the client" writes. Sharing again after
 *  the client asked for changes clears their answer, so the card waits on
 *  them once more. */
export function clientSharePatch(now: string, actorId: string): Record<string, unknown> {
  return {
    shared_with_client: true, client_shared_at: now, client_shared_by: actorId,
    client_decision: null, client_decided_at: null, client_decision_note: null,
  }
}

/** The client's answer from the portal, on the shoot. */
export function clientDecisionPatch(decision: ClientDecision, note: string | null, now: string): Record<string, unknown> {
  return { client_decision: decision, client_decided_at: now, client_decision_note: text(note).slice(0, 2000) || null }
}

/** Is the client's answer still wanted — shared, and not yet approved? */
export function clientDecisionOpen(b: SopShoot): boolean {
  return b.shared_with_client === true && b.client_decision !== 'approved'
}

/** Where the plan is with the client, in one line — null until it was
 *  shared from the shoot page. */
export function clientPlanWords(b: SopShoot): string | null {
  if (b.client_decision === 'approved') return `Client approved${stampWords(b.client_decided_at) ? ` ${stampWords(b.client_decided_at)}` : ''}`
  if (b.client_decision === 'changes') {
    const note = text(b.client_decision_note)
    return `Client asked for changes${stampWords(b.client_decided_at) ? ` ${stampWords(b.client_decided_at)}` : ''}${note ? `: ${note}` : ''}`
  }
  if (b.client_shared_at) return `With the client since ${stampWords(b.client_shared_at)}`
  if (b.shared_with_client) return 'On the client portal'
  return null
}

/* ── who did what: every stamp with its person and time ────────────────── */

export type NameOf = (userId: string | null | undefined) => string | null

const by = (nameOf: NameOf, id: string | null | undefined) => nameOf(id) ?? 'the team'
const withWhen = (iso: string | null | undefined) => { const w = stampWords(iso); return w ? `, ${w}` : '' }

/** "Created by Ada, Fri 12 Sept" — a row from before the column reads
 *  "by the team". */
export function createdWords(b: Pick<SopShoot, 'created_by' | 'owner_id' | 'created_at'>, nameOf: NameOf): string {
  return `Created by ${by(nameOf, b.created_by ?? b.owner_id)}${withWhen(b.created_at)}`
}

export type StampLine = { key: string; text: string; done: boolean }

/**
 * THE WHAT-HAPPENED LOG OF A SHOOT, read off its stamps (the owner, 13 Sep
 * 2026: "do we actually know … reviewed by who and created by who"). One
 * line per step, with the person and the time; a step not taken yet says
 * so. The same lines feed "Where it is" and the board card.
 */
export function stampLines(b: SopShoot, nameOf: NameOf, opts?: { planReview?: boolean }): StampLine[] {
  const lines: StampLine[] = []
  lines.push({ key: 'created', text: createdWords(b, nameOf), done: true })
  lines.push(b.brief_shared_at
    ? { key: 'shared', text: `Shared with the team by ${by(nameOf, b.brief_shared_by)}${withWhen(b.brief_shared_at)}`, done: true }
    : { key: 'shared', text: 'Not shared with the team yet', done: false })
  const people = peopleOnShoot(b)
  if (people.length > 0) {
    const acked = new Map(acksOf(b).map(a => [a.user_id, a.at]))
    const read = people.filter(id => acked.has(id)).map(id => `${by(nameOf, id)}${withWhen(acked.get(id))}`)
    const notYet = people.filter(id => !acked.has(id)).map(id => by(nameOf, id))
    lines.push({
      key: 'read',
      text: (read.length > 0 ? `Read by ${read.join('; ')}` : 'Nobody has read the plan yet') + (notYet.length > 0 ? ` · not yet: ${notYet.join(', ')}` : ''),
      done: notYet.length === 0,
    })
  }
  if (b.review_asked_at) {
    const to = (Array.isArray(b.review_asked_to) ? b.review_asked_to : []).map(id => by(nameOf, String(id)))
    lines.push({ key: 'review', text: `Review asked from ${to.length > 0 ? to.join(', ') : 'the team'} by ${by(nameOf, b.review_asked_by)}${withWhen(b.review_asked_at)}`, done: !!b.aligned_at && String(b.aligned_at) >= String(b.review_asked_at) })
  }
  if (opts?.planReview) {
    lines.push(planReviewPassed(b)
      ? { key: 'plan_review', text: `Passed quality review by ${by(nameOf, b.plan_reviewed_by)}${withWhen(b.plan_reviewed_at)}`, done: true }
      : b.review_asked_at
        ? { key: 'plan_review', text: `Waiting on the quality checker since ${stampWords(b.review_asked_at) ?? 'the ask'}`, done: false }
        : { key: 'plan_review', text: 'Quality review — not asked yet', done: false })
  }
  lines.push(b.aligned_at
    ? { key: 'aligned', text: `Aligned with the strategist — ticked by ${by(nameOf, b.aligned_by)}${withWhen(b.aligned_at)}`, done: true }
    : { key: 'aligned', text: 'Aligned with the strategist — not ticked yet', done: false })
  lines.push(b.client_confirmed_at
    ? { key: 'client_confirmed', text: `Location confirmed — ticked by ${by(nameOf, b.client_confirmed_by)}${withWhen(b.client_confirmed_at)}`, done: true }
    : { key: 'client_confirmed', text: 'Location — not ticked yet', done: false })
  if (b.client_shared_at || b.shared_with_client) {
    lines.push({ key: 'client_shared', text: b.client_shared_at ? `Shared with the client by ${by(nameOf, b.client_shared_by)}${withWhen(b.client_shared_at)}` : 'On the client portal', done: true })
    const answer = b.client_decision ? clientPlanWords(b) : null
    lines.push(answer
      ? { key: 'client_answer', text: answer, done: b.client_decision === 'approved' }
      : { key: 'client_answer', text: 'Waiting on the client', done: false })
  }
  lines.push(b.go_at
    ? { key: 'go', text: `Go by ${by(nameOf, b.go_by)}${withWhen(b.go_at)}${overrideWords(b) ? ` · ${overrideWords(b)}` : ''}`, done: true }
    : { key: 'go', text: 'Not confirmed as go yet', done: false })
  lines.push(b.reminder_sent_at
    ? { key: 'reminder', text: `Reminder sent by ${by(nameOf, b.reminder_sent_by)}${withWhen(b.reminder_sent_at)}`, done: true }
    : { key: 'reminder', text: 'Reminder not sent yet', done: false })
  lines.push(b.footage_handed_at
    ? { key: 'footage', text: `Footage in — ${b.footage_handed_by ? `by ${by(nameOf, b.footage_handed_by)}` : 'by itself, the morning after'}${withWhen(b.footage_handed_at)}`, done: true }
    : { key: 'footage', text: 'Footage not in yet', done: false })
  // THE EDITOR SAYS THEY HAVE IT (the owner, 14 Sep 2026: "how do we know
  // if he has received the footage?") — a line the moment it is handed over
  if (b.footage_handed_at) {
    lines.push(b.footage_received_at
      ? { key: 'footage_received', text: `Footage received by ${by(nameOf, b.footage_received_by)}${withWhen(b.footage_received_at)}`, done: true }
      : { key: 'footage_received', text: `Footage sent — ${by(nameOf, b.editor_id)} has not confirmed they have it yet`, done: false })
  }
  return lines
}

/* ── the plan, as text: for the email a crew member reads without the page ── */

function listWords(v: unknown, pick: (x: Record<string, unknown>) => string): string[] {
  if (!Array.isArray(v)) return []
  return v.map(x => (x && typeof x === 'object' ? pick(x as Record<string, unknown>) : String(x ?? ''))).map(s => s.trim()).filter(Boolean)
}

/** The nine parts as `label: value` lines, in the SOP's order — what the
 *  email carries so a crew member never needs the page. */
export function planAsText(b: SopShoot): { label: string; value: string }[] {
  const shots = listWords(b.shot_list, x => String(x.text ?? x.title ?? ''))
  const lines = listWords(b.planned_deliverables, x => String(x.title ?? (x.qty ? `${x.qty} × ${x.type ?? ''}` : '')))
  const when = [shortDay(b.shoot_date) ? `${shortDay(b.shoot_date)}` : '', text(b.call_time) ? `call time ${text(b.call_time)}` : '', text(b.location)].filter(Boolean).join(' · ')
  const editor = [text(b.editor_priorities), text(b.edit_deadline) ? `due ${shortDay(b.edit_deadline) ?? text(b.edit_deadline)}` : ''].filter(Boolean).join(' · ')
  const value: Record<BriefItemKey, string> = {
    objective: text(b.objective),
    deliverables: lines.join(', '),
    shot_list: shots.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    // the points wear their bullets everywhere they are drawn (15 Sep 2026)
    script: [bulletText(b.script), scriptsText(sanitiseScripts(b.scripts))].filter(Boolean).join('\n\n'),
    when_where: when,
    talent: text(b.talent),
    props: text(b.props_wardrobe),
    editor,
  }
  return BRIEF_ITEMS.map(i => ({ label: i.label, value: value[i.key] || 'Not filled in yet' }))
}

/**
 * THE FLOW, ON THE PAGE (the owner, 11 Sep 2026: "you need to explain to
 * be in the shoot creation page"). One sentence for where the shoot is and
 * what the next move is, naming who makes it. Read by the strip on the
 * shoot page and by the board card; the same rules `stageMove` and
 * `goReady` keep, so it never promises a button the route would refuse.
 */
export function nextStepWords(b: SopShoot, today: string, input: GoInput = {}): string {
  const stage = shootStage(b, today, { planReview: input.planReview?.required })
  const when = shortDay(b.shoot_date)
  const due = shortDay(b.edit_deadline)
  switch (stage) {
    case 'quality_review':
      if (planReviewPassed(b)) return 'Passed by the quality checker. Next: share the plan with the team.'
      return 'With the quality checker. Next: they press Pass the plan on the shoot page, or send it back with a note.'
    case 'drafting': {
      const list = briefChecklist(b, input)
      if (!list.complete) {
        return `Next: fill in the plan — ${list.missing.map(m => m.label.toLowerCase()).join(', ')} still to go — then share it with the team. Refused until all eight parts are filled.`
      }
      return 'Next: share the plan with the team. Everyone on it is emailed and asked to read it.'
    }
    case 'shared': {
      const ack = ackState(b)
      if (ack.total === 0) return 'Next: add the editor and the crew, so there is somebody to read the plan.'
      if (!ack.complete) return `Next: everyone on the shoot presses “I’ve read the plan” — on their Editor card, or the link in their email — waiting on ${ack.missing.length} of ${ack.total}.`
      if (!b.aligned_at || !b.client_confirmed_at) return 'Next: tick “Aligned with the strategist” and “Client and location confirmed”, then press Go.'
      if (!b.go_at && sharedLate(b)) return `${sharedLateWords(b)}`
      return 'Next: press Go. That books the shoot and puts the editor’s card on the Editor page.'
    }
    case 'confirmed':
      return `Confirmed${when ? ` for ${when}` : ''}. The editor’s card is on the Editor page${due ? `, due ${due}` : ''}. Next: Ops presses Reminder sent the day before the shoot.`
    case 'reminder_sent':
      return `Reminder sent. Next: the shoot${when ? ` on ${when}` : ''}. Nothing to press until then.`
    case 'shoot_day': {
      const days = daysUntilShoot(b, today)
      if (!text(b.footage_url)) {
        return days === 0
          ? 'Shooting today. Paste the footage folder link below once the footage is up — the editor is told the moment it is in.'
          : 'Shot, and the footage folder link is not in yet. Paste it below — the editor is told the moment it is in.'
      }
      if (days === 0) return 'Shooting today. The footage is handed to the editor tomorrow morning by itself — or press “Footage is in” once it is.'
      return 'Shot. The footage is handed to the editor this morning by itself — press “Footage is in” if it is already.'
    }
    case 'footage_handed':
      if (isFootageOnly(b)) return 'Footage only — this shoot was never planned here. Its cards are on the Editor page; nothing to press.'
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
export function footageDueTargets<T extends SopShoot>(shoots: readonly T[], today: string): { hand: T[]; askEditor: T[]; askFolder: T[] } {
  const hand: T[] = []
  const askEditor: T[] = []
  const askFolder: T[] = []
  for (const b of shoots) {
    if (b.footage_due_nudged_at || b.footage_handed_at || b.status === 'wrapped') continue
    if (!b.go_at && b.status !== 'locked' && b.status !== 'shot') continue
    const days = daysUntilShoot(b, today)
    if (days === null || days >= 0) continue
    if (!b.editor_id) askEditor.push(b)
    // THE LINK FIRST (the owner, 13 Sep 2026: "if shoot day is done but the
    // footage is not yet submitted, the person handling it would know they
    // need to put the link there"): nothing is handed to the editor without
    // the folder — the crew and the account managers are asked for it
    else if (!text(b.footage_url)) askFolder.push(b)
    else hand.push(b)
  }
  return { hand, askEditor, askFolder }
}

/** THE MORNING AFTER THE HANDOVER: an editor who has not pressed "Got the
 *  footage" is reminded once, and the account manager told (14 Sep 2026). */
export function footageReceiptTargets<T extends SopShoot>(shoots: readonly T[], today: string): T[] {
  return shoots.filter(b => {
    if (!b.footage_handed_at || b.footage_received_at || b.footage_receipt_nudged_at || b.status === 'wrapped' || !b.editor_id) return false
    // handed over before today, IN MELBOURNE — a stamp written at 00:30
    // here is "yesterday" in UTC, and must not be nudged the same morning
    const handedDay = new Date(String(b.footage_handed_at)).toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
    return handedDay < today
  })
}

/** May this person press "Got the footage"? The shoot's editor, once it is in. */
export function canConfirmFootage(b: Pick<SopShoot, 'editor_id' | 'footage_handed_at' | 'footage_received_at'>, userId: string): boolean {
  return !!b.footage_handed_at && !b.footage_received_at && b.editor_id === userId
}

/** A folder link pasted once the shoot has happened IS the handover: the
 *  editor is named, the day is here or gone, nobody handed it yet. */
export function footageReadyToHand(b: SopShoot, today: string): boolean {
  if (b.footage_handed_at || b.status === 'wrapped') return false
  if (!b.go_at && b.status !== 'locked' && b.status !== 'shot') return false
  if (!b.editor_id || !text(b.footage_url)) return false
  const days = daysUntilShoot(b, today)
  return days !== null && days <= 0
}

/* ── a shoot that was never planned here: footage only ─────────────────── */

/**
 * "SIMPLY TYPE THE SHOOT NAME THERE" (the owner, 13 Sep 2026): a card on
 * the Editor page can come from a shoot that was never planned in the app.
 * Typing its name makes a lightweight shoot — already shot, footage in, no
 * plan — so the card has a shoot to belong to and the Shoots board shows
 * it in Footage in. It never needs Go, a share or a reminder.
 */
export function footageOnlyPatch(now: string, actorId: string, shootDate: string): Record<string, unknown> {
  return {
    status: 'shot', shoot_date: shootDate.slice(0, 10),
    footage_handed_at: now, footage_handed_by: actorId,
    owner_id: actorId, created_by: actorId,
  }
}

/** Footage in, and nothing of a plan ever written: no share, no go, none of
 *  the nine parts bar the date. */
export function isFootageOnly(b: SopShoot): boolean {
  if (!b.footage_handed_at || b.brief_shared_at || b.go_at) return false
  return !text(b.objective) && !text(b.script) && !text(b.editor_priorities) && !text(b.talent)
    && !(Array.isArray(b.shot_list) && b.shot_list.length > 0)
    && !(Array.isArray(b.planned_deliverables) && b.planned_deliverables.length > 0)
}

export const FOOTAGE_ONLY_WORDS = 'No plan — footage only'

/* ── the footage folder: where the footage lives ───────────────────────── */

/**
 * "How do they get the Dropbox link?" (the owner, 11 Sep 2026). Whoever has
 * the footage pastes its folder on the shoot page. When the footage is
 * handed over — by a press or by the morning sweep — every card from the
 * shoot with no "Files to work from" folder yet gets it; a card somebody
 * already pointed at a folder keeps theirs. Pure: which cards, from which
 * link. Idempotent by construction.
 */
/**
 * THE FOOTAGE FOLDER REPLACED AFTER THE HAND-OVER (the owner, 16 Sep 2026: "I
 * submitted the wrong footage — let me submit again"): every card of the
 * shoot still pointing at the old link points at the new one — the folder
 * to work from, and the card's own link when it was the same. A card whose
 * folder somebody chose by hand is not touched. A new link of null takes
 * the folder off those cards.
 */
export function footageFolderReplace(
  b: Pick<SopShoot, 'id' | 'footage_url'>,
  oldUrl: string,
  items: readonly { id: string; batch_id?: string | null; raw_assets_url?: string | null; link_url?: string | null; work_kinds?: { slug?: string } | null }[],
): { id: string; raw_assets_url: string | null; link_url?: string | null }[] {
  const was = text(oldUrl)
  if (!was) return []
  const url = text(b.footage_url) || null
  return items
    .filter(i => i.batch_id === b.id && i.work_kinds?.slug !== 'shoot_brief' && text(i.raw_assets_url) === was)
    .map(i => ({ id: i.id, raw_assets_url: url, ...(text(i.link_url) === was ? { link_url: url } : {}) }))
}

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

/* ── call time: a picker, not a text box (the owner, 13 Sep 2026) ──────── */

export type CallTimeParts = { hour: number; minute: number; period: 'am' | 'pm' }

/** "7:30 am" → parts; also reads "07:30", "7.30am", "19:30". Null when it
 *  is not a time (an older shoot typed "early" — the box shows it as is). */
export function parseCallTime(raw: string | null | undefined): CallTimeParts | null {
  const t = String(raw ?? '').trim().toLowerCase()
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  if (minute > 59) return null
  let period: 'am' | 'pm' | null = (m[3] as 'am' | 'pm' | undefined) ?? null
  if (period) {
    if (hour < 1 || hour > 12) return null
  } else {
    if (hour > 23) return null
    period = hour >= 12 ? 'pm' : 'am'
    hour = hour % 12 || 12
  }
  return { hour, minute, period }
}

/** parts → the words the plan, the reminder email and the PDF all carry. */
export function formatCallTime(p: CallTimeParts): string {
  return `${p.hour}:${String(p.minute).padStart(2, '0')} ${p.period}`
}

/* ── ask for a review (13 Sep 2026) ────────────────────────────────────── */

/** The people a review is asked from: the ids given, else the account
 *  managers linked to the client (and a super admin among them), never the
 *  asker. Pure: the route resolves the rows. */
export function reviewersFor(
  askerId: string,
  picked: readonly string[] | null | undefined,
  managers: readonly { id: string; role: string; active_status?: boolean | null; quality_reviewer?: boolean | null }[],
  /** the quality review gate applies: the default is every active quality
   *  checker (the role or the flag), not the account managers */
  opts?: { quality?: boolean },
): string[] {
  const chosen = (picked ?? []).map(String).filter(Boolean)
  const ids = chosen.length > 0
    ? chosen
    : opts?.quality
      ? qualityCheckersOf(managers)
      : managers.filter(m => m.active_status !== false && (m.role === 'account_manager' || m.role === 'super_admin')).map(m => m.id)
  return [...new Set(ids)].filter(id => id !== askerId)
}

/** Every active quality checker — the role, or the flag on another role. */
export function qualityCheckersOf(
  people: readonly { id: string; role: string; active_status?: boolean | null; quality_reviewer?: boolean | null }[],
): string[] {
  return people.filter(p => p.active_status !== false && (p.role === 'quality_checker' || p.quality_reviewer === true)).map(p => p.id)
}

/** What the picker's default option says. */
export const REVIEW_DEFAULT_MANAGERS = 'The account managers on this client'
export const REVIEW_DEFAULT_QUALITY = 'The quality checker'
export const NO_QUALITY_CHECKER = 'No quality checker on the Team page yet — set one, or pick a person'

/** The stamps "Ask for a review" writes. */
export function reviewAskPatch(now: string, actorId: string, to: readonly string[]): Record<string, unknown> {
  // a fresh ask closes an earlier send-back
  return { review_asked_at: now, review_asked_by: actorId, review_asked_to: [...to], plan_sent_back_at: null, plan_sent_back_by: null, plan_sent_back_note: null }
}

/** "Send back with a note": the ask is closed (the shoot leaves the Quality
 *  review column), any pass is cleared, and the note is kept on the shoot
 *  so the writer reads it above the one button. */
export function planSendBackPatch(now: string, actorId: string, note: string): Record<string, unknown> {
  return {
    plan_reviewed_at: null, plan_reviewed_by: null,
    review_asked_at: null, review_asked_by: null, review_asked_to: null,
    plan_sent_back_at: now, plan_sent_back_by: actorId, plan_sent_back_note: note.trim().slice(0, 2000) || null,
  }
}

/* ── THE QUALITY REVIEW GATE ON A PLAN (13 Sep 2026) ──────────────────────
 * "for shoot briefs that has been created and assigned to AM or AM that
 * created it, must go through quality review too … not for super admins".
 * A plan written or held by anyone but a super admin is passed by a quality
 * checker before Go. Editing the plan after it was passed does NOT clear
 * the pass — the owner can ask for stricter later. */

export type PlanReviewRoles = { createdByRole?: string | null; ownerRole?: string | null }

/** Does the gate apply? Not when everyone who wrote or holds the plan is a
 *  super admin. A role the caller does not know counts as a super admin's
 *  (an old shoot with no creator on record is not held up). */
export function planReviewRequired(b: Pick<SopShoot, 'created_by' | 'owner_id'>, roles: PlanReviewRoles): boolean {
  const present: string[] = []
  if (b.created_by && roles.createdByRole) present.push(roles.createdByRole)
  if (b.owner_id && roles.ownerRole) present.push(roles.ownerRole)
  return present.some(r => r !== 'super_admin')
}

export const PLAN_REVIEW_WORDS = 'The quality checker has not passed the plan yet — ask for a review'

export const NOBODY_ON_SHOOT_WORDS = 'Pick the editor and the crew first — the plan is shared with them'

export function planReviewPassed(b: Pick<SopShoot, 'plan_reviewed_at'>): boolean {
  return !!b.plan_reviewed_at
}

/** The stamps "Pass the plan" writes — or clears, when it is taken back. */
export function planReviewPatch(now: string, actorId: string, pass: boolean): Record<string, unknown> {
  return pass
    ? { plan_reviewed_at: now, plan_reviewed_by: actorId }
    : { plan_reviewed_at: null, plan_reviewed_by: null }
}

/** The chip on the Shoots board card, when the gate applies. Nothing until
 *  somebody asks (the owner, 13 Sep 2026: "Needs quality review is
 *  indicating the user that it now needs quality review, so it's wrong");
 *  the column and Go's reason say what is required when the time comes. */
export function planReviewChip(b: Pick<SopShoot, 'plan_reviewed_at' | 'go_at' | 'review_asked_at'>, required: boolean): { tone: 'green' | 'amber'; text: string } | null {
  if (!required) return null
  if (planReviewPassed(b)) return { tone: 'green', text: 'Passed quality review' }
  if (b.go_at) return null
  if (b.review_asked_at) return { tone: 'amber', text: 'Waiting on the quality checker' }
  return null
}

/** Where the review is, in one line — null until asked. With the quality
 *  gate, "Pass the plan" is the sign-off; without it, the "Aligned with the
 *  strategist" tick is. */
export function reviewWords(b: SopShoot, nameOf: NameOf, opts?: { planReview?: boolean }): string | null {
  if (opts?.planReview) {
    if (planReviewPassed(b)) return `Passed quality review by ${nameOf(b.plan_reviewed_by) ?? 'the team'}${withWhen(b.plan_reviewed_at)}`
    if (!b.review_asked_at) return null
    const to = (Array.isArray(b.review_asked_to) ? b.review_asked_to : []).map(id => nameOf(String(id)) ?? 'the quality checker')
    return `Waiting on ${to.length > 0 ? to.join(', ') : 'the quality checker'} since ${stampWords(b.review_asked_at) ?? 'the ask'} — asked by ${nameOf(b.review_asked_by) ?? 'the team'}`
  }
  if (!b.review_asked_at) return null
  const to = (Array.isArray(b.review_asked_to) ? b.review_asked_to : []).map(id => nameOf(String(id)) ?? 'the team')
  const who = to.length > 0 ? to.join(', ') : 'the team'
  if (b.aligned_at && String(b.aligned_at) >= String(b.review_asked_at)) {
    return `Reviewed and aligned by ${nameOf(b.aligned_by) ?? 'the team'}${withWhen(b.aligned_at)}`
  }
  return `Review asked from ${who} by ${nameOf(b.review_asked_by) ?? 'the team'}${withWhen(b.review_asked_at)} — waiting on their tick`
}
