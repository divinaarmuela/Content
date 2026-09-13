/**
 * THE VIDEO EDITORS SOP, AS RULES — pure, no I/O.
 *
 * The Team's Playbook (July 2026), pages 20–21, is the whole spec for the
 * Editor page and the editor's card. Every list here is the SOP's own list,
 * in its own words and order, so a person who has read the playbook finds
 * the same things on screen and nothing the playbook does not give them:
 *
 *   §1 where editors work      — Dropbox in, finals to Drive
 *   §2 before you start        — confirm the brief: objective, deliverables
 *                                (how many cuts, which formats), platform
 *                                specs, deadline; shot list, strategist notes,
 *                                brand guidelines, previous edits
 *   §4 quality control         — the seven checks before submitting
 *   §5 handover & source files — three ticks once approved
 *   §6 turnaround              — acknowledge the same day, flag risk early,
 *                                In Progress → For Review → For Handoff → Done
 *   §7 the 24-hour blocker rule — solve, ask (the table), escalate at 12 h
 *                                with Ops copied, flag leadership at 24 h
 */

import type { ItemStatus } from './workflow-core'
import type { BoardColumnKey } from './board-core'

/* ── §6 the four stages ─────────────────────────────────────────────────── */

export type EditorLaneKey = 'in_progress' | 'quality_check' | 'with_client' | 'for_handoff' | 'done'

export const EDITOR_LANES: readonly {
  key: EditorLaneKey
  /** the SOP's own words */
  label: string
  columns: BoardColumnKey[]
  /** a folded lane is narrow: the editor's part is done */
  folded: boolean
  empty: string
}[] = [
  { key: 'in_progress', label: 'In Progress', columns: ['draft'], folded: false, empty: 'Nothing to edit right now.' },
  // Abby's rule (11 Sep 2026): the maker's submit goes to Joy. The client's
  // look is its own column (the owner, 12 Sep 2026: "why does editing not
  // have with client"), so the editor sees approve / changes requested there
  { key: 'quality_check', label: 'Quality check', columns: ['quality_check'], folded: false, empty: 'Nothing with the quality reviewer.' },
  { key: 'with_client', label: 'With client', columns: ['with_client'], folded: false, empty: 'Nothing with a client.' },
  { key: 'for_handoff', label: 'For Handoff', columns: ['ready_to_post'], folded: false, empty: 'Nothing approved yet.' },
  { key: 'done', label: 'Done', columns: ['booked', 'posted', 'delivered'], folded: true, empty: 'Nothing done yet.' },
]

export const EDITOR_LANE_WORDS = EDITOR_LANES.map(l => l.label).join(', ')

/** Inside Quality check the editor is told who has it, in small words —
 *  the reviewer's first name when somebody wears the flag ("With Joy"). */
export function reviewWords(status: ItemStatus | string, reviewerName?: string | null): string | null {
  const first = String(reviewerName ?? '').trim().split(/\s+/)[0]
  switch (status) {
    case 'internal_review': return 'With the account manager'
    case 'quality_check': return first ? `With ${first}` : 'With the quality reviewer'
    case 'client_review': return 'With the client'
    case 'client_changes_requested': return 'The client asked for changes'
    default: return null
  }
}

/** The first flagged reviewer's name, for the chip — null when nobody wears it. */
export function reviewerNameOf(team: readonly { name?: string | null; email?: string | null; quality_reviewer?: boolean | null; active_status?: boolean | null }[]): string | null {
  const joy = team.find(u => u.quality_reviewer === true && u.active_status !== false)
  return joy ? (String(joy.name ?? '').trim() || String(joy.email ?? '').trim() || null) : null
}

/* ── §2 before you start ────────────────────────────────────────────────── */

export const NOT_GIVEN = 'Not given'

export type BriefRow = { key: string; label: string; value: string | null; href?: string | null }

/** What the card knows, what the shoot knows, what the client knows. */
export type BriefSources = {
  card: {
    brief?: string | null
    due_date?: string | null
    change_note?: string | null
    platform_targets?: unknown
    raw_assets_url?: string | null
    client_id: string
  }
  shoot?: {
    objective?: string | null
    planned_deliverables?: unknown
    shot_list?: unknown
    editor_priorities?: string | null
    edit_deadline?: string | null
    footage_url?: string | null
    script?: string | null
  } | null
  /** "9:16, up to 90 s, at least 1080 x 1920 px" per platform, already worded */
  specs?: readonly { platform: string; lines: readonly string[] }[]
  driveFolderUrl?: string | null
}

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

/** "5 reels, 1 long-form, 1 photo set" from the plan's lines. */
export function deliverablesWords(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  const titles = raw
    .map(r => (r && typeof r === 'object' ? clean((r as { title?: unknown }).title) : null))
    .filter((t): t is string => !!t)
  return titles.length ? titles.join(', ') : null
}

/** The shot list as one line per shot. */
export function shotListWords(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  const lines = raw
    .map(r => (typeof r === 'string' ? clean(r) : r && typeof r === 'object' ? clean((r as { text?: unknown }).text) : null))
    .filter((t): t is string => !!t)
  return lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : null
}

/**
 * The SOP's "confirm the brief" list, one row each, drawn always: a row with
 * nothing behind it says "Not given" rather than vanishing, so the editor
 * knows to ask before cutting ("if the brief doesn't say, ask before cutting,
 * don't guess").
 */
export function beforeYouStart(s: BriefSources): BriefRow[] {
  const shoot = s.shoot ?? null
  const specs = (s.specs ?? [])
    .filter(p => p.lines.length > 0)
    .map(p => `${p.platform}: ${p.lines.join(' · ')}`)
  const notes = [clean(shoot?.editor_priorities), clean(s.card.change_note)].filter((t): t is string => !!t)
  return [
    { key: 'objective', label: 'Objective', value: clean(shoot?.objective) ?? clean(s.card.brief) },
    { key: 'deliverables', label: 'Deliverables — how many cuts, which formats', value: deliverablesWords(shoot?.planned_deliverables) },
    { key: 'specs', label: 'Platform specs', value: specs.length ? specs.join('\n') : null },
    { key: 'deadline', label: 'Deadline', value: clean(s.card.due_date)?.slice(0, 10) ?? clean(shoot?.edit_deadline)?.slice(0, 10) ?? null },
    { key: 'shot_list', label: 'Shot list', value: shotListWords(shoot?.shot_list) },
    { key: 'script', label: 'Script or talking points', value: clean(shoot?.script) },
    { key: 'notes', label: 'Strategist notes', value: notes.length ? notes.join('\n') : null },
    { key: 'previous', label: 'Previous edits', value: 'What went out for this client', href: `/dashboard/editor?client=${encodeURIComponent(s.card.client_id)}&column=posted` },
  ]
}

/** §1 where the work comes from and where the finals go. */
export function workFrom(s: BriefSources): { footage: string | null; finalsFolder: string | null } {
  return {
    footage: clean(s.shoot?.footage_url) ?? clean(s.card.raw_assets_url),
    finalsFolder: clean(s.driveFolderUrl),
  }
}

/* ── §4 quality control before submitting ───────────────────────────────── */

export const QC_CHECKLIST: readonly { key: string; label: string }[] = [
  { key: 'watched', label: 'Watched the full export start to finish' },
  { key: 'text', label: 'Spelling and on-screen text checked against the brief' },
  { key: 'audio', label: 'Audio levels and sync' },
  { key: 'branding', label: 'Branding' },
  { key: 'transitions', label: 'Transitions' },
  { key: 'ratio', label: 'Correct aspect ratio and length for the platform' },
  { key: 'quality', label: 'Image and footage quality' },
]

export const QC_KEYS = QC_CHECKLIST.map(c => c.key)

/** Submit is allowed only when every check is ticked. */
export function qcComplete(ticked: readonly string[]): boolean {
  return QC_KEYS.every(k => ticked.includes(k))
}

/** The ticks as one history line: "QC done: watched, text, …". */
export function qcDetail(ticked: readonly string[]): string {
  return `QC done: ${QC_CHECKLIST.filter(c => ticked.includes(c.key)).map(c => c.label).join('; ')}`
}

/** Is the quality check on record for THIS version of the files? */
export function qcDoneFor(card: { qc_done_version?: number | null; current_version_number?: number | null }): boolean {
  const v = Number(card.current_version_number ?? 0)
  return v > 0 && Number(card.qc_done_version ?? 0) === v
}

/* ── §5 handover & source files ─────────────────────────────────────────── */

export const HANDOVER_ITEMS: readonly { key: 'drive' | 'source' | 'owner'; label: string }[] = [
  { key: 'drive', label: 'Final is in the Drive monthly folder' },
  { key: 'source', label: 'Source and project files handed off' },
  { key: 'owner', label: 'Next owner tagged' },
]

export function handoverState(card: {
  handover_drive_at?: string | null
  handover_source_at?: string | null
  link_url?: string | null
  scheduler_ids?: unknown
  status: ItemStatus | string
}): { key: 'drive' | 'source' | 'owner'; label: string; done: boolean; auto: boolean }[] {
  const schedulers = Array.isArray(card.scheduler_ids) ? card.scheduler_ids.length : 0
  const handedOn = schedulers > 0 || ['scheduled', 'published'].includes(String(card.status))
  return HANDOVER_ITEMS.map(h => ({
    ...h,
    done: h.key === 'drive' ? !!card.handover_drive_at
      : h.key === 'source' ? !!card.handover_source_at && !!clean(card.link_url)
      : handedOn,
    auto: h.key === 'owner',
  }))
}

/** The handover ticks belong on an approved card. */
export function showsHandover(status: ItemStatus | string): boolean {
  return ['approved_for_scheduling', 'scheduled', 'published'].includes(String(status))
}

/* ── §6 acknowledge the same day ────────────────────────────────────────── */

/** When the card became this person's — the latest hand-over, else its birth. */
export function assignedAtOf(
  card: { created_at?: string | null; owner_id?: string | null },
  activity: readonly { action: string; created_at?: string | null }[],
): string | null {
  if (!card.owner_id) return null
  const hands = activity
    .filter(a => ['handed_from_shoot', 'schedule_handoff', 'handoff', 'assigned'].includes(a.action))
    .map(a => String(a.created_at ?? ''))
    .filter(Boolean)
  const latest = hands.sort().at(-1) ?? null
  return latest ?? clean(card.created_at)
}

/** A card still unacknowledged the morning after it was assigned gets one nudge. */
export function ackNudgeDue(input: {
  assignedAt: string | null
  acknowledged: boolean
  ack_nudged_at?: string | null
  todayKey: string
}): boolean {
  if (!input.assignedAt || input.acknowledged || input.ack_nudged_at) return false
  return input.assignedAt.slice(0, 10) < input.todayKey
}

/* ── the shoot plan, read on the card (13 Sep 2026) ─────────────────────── */

export type PlanReadState =
  | { on: false }
  | { on: true; read: false }
  | { on: true; read: true; at: string }

/**
 * THE EDITOR NEVER OPENS THE SHOOT PAGE. "I've read the plan" is on their
 * card: shown when the card comes from a shoot and this person is on it (its
 * editor or its crew), pressed once, then the date it was pressed.
 */
export function planReadState(
  shoot: { editor_id?: string | null; crew_ids?: unknown; acknowledgements?: unknown } | null | undefined,
  userId: string | null | undefined,
): PlanReadState {
  if (!shoot || !userId) return { on: false }
  const crew = Array.isArray(shoot.crew_ids) ? shoot.crew_ids.map(String) : []
  if (shoot.editor_id !== userId && !crew.includes(userId)) return { on: false }
  const acks = Array.isArray(shoot.acknowledgements) ? shoot.acknowledgements as { user_id?: unknown; at?: unknown }[] : []
  const mine = acks.find(a => a && a.user_id === userId && typeof a.at === 'string')
  return mine ? { on: true, read: true, at: String(mine.at) } : { on: true, read: false }
}

/* ── §7 the 24-hour blocker rule ────────────────────────────────────────── */

export type BlockerNeed = 'footage' | 'brief' | 'context' | 'clarify'

/** The SOP's table: "If you need… → Go to". Who is a KIND of person; the
 *  server turns it into named people (the editors' lead flag, the client's
 *  account managers, the shoot's crew, leadership = super admins, Ops). */
export const BLOCKER_NEEDS: readonly {
  key: BlockerNeed
  label: string
  who: string
  ask: readonly ('crew' | 'lead' | 'account_manager' | 'leadership' | 'ops')[]
}[] = [
  { key: 'footage', label: 'Missing or corrupt footage', who: 'The videographer or Production', ask: ['crew', 'lead'] },
  { key: 'brief', label: 'Brief or creative direction', who: "The editors' lead or the account manager", ask: ['lead', 'account_manager'] },
  { key: 'context', label: 'Strategy or client context', who: "The editors' lead or leadership", ask: ['lead', 'leadership'] },
  { key: 'clarify', label: 'A brief clarified', who: "The editors' lead or leadership, then Ops", ask: ['lead', 'leadership', 'ops'] },
]

export function blockerNeed(key: unknown): (typeof BLOCKER_NEEDS)[number] | null {
  return BLOCKER_NEEDS.find(n => n.key === String(key ?? '')) ?? null
}

export const BLOCKER_NOTE_MAX = 500

/** "Waiting on missing or corrupt footage from Yusuf since Thu 11 Sept, 4:10 pm". */
export function blockerWords(card: {
  blocked_need?: string | null
  blocked_from_id?: string | null
  blocked_at?: string | null
}, nameOf: (id: string | null | undefined) => string | null, when: (iso: string) => string): string | null {
  const need = blockerNeed(card.blocked_need)
  if (!need || !card.blocked_at) return null
  const who = nameOf(card.blocked_from_id) ?? need.who
  return `Waiting on ${need.label.toLowerCase()} from ${who} since ${when(card.blocked_at)}`
}

export const HOUR = 3600_000

/** Which escalation is due now: the 12-hour follow-up with Ops copied, the
 *  24-hour flag to leadership, or nothing yet. Each fires once. */
export function blockerNudgeDue(card: {
  blocked_at?: string | null
  blocked_nudged_12_at?: string | null
  blocked_nudged_24_at?: string | null
}, nowMs: number): '12' | '24' | null {
  if (!card.blocked_at) return null
  const since = nowMs - new Date(card.blocked_at).getTime()
  if (!Number.isFinite(since)) return null
  if (since >= 24 * HOUR && !card.blocked_nudged_24_at) return '24'
  if (since >= 12 * HOUR && !card.blocked_nudged_12_at) return '12'
  return null
}

/** The SOP's own four steps, for the panel. */
export const BLOCKER_LADDER = [
  'Solve it yourself first (0–4 hours): the brief, the shot list, previous edits, the notes.',
  'Ask the right person (4–12 hours): pick what you need below and they are told now.',
  'At 12 hours the follow-up goes again with Ops copied.',
  'At 24 hours leadership is told: what is blocked, who was asked, when, and what you need.',
] as const

/** The face chip: "3 of 6 finals in" is elsewhere; this is the blocker. */
export function blockedChip(card: { blocked_at?: string | null; blocked_need?: string | null }): string | null {
  const need = blockerNeed(card.blocked_need)
  return card.blocked_at && need ? `Blocked: ${need.label.toLowerCase()}` : null
}
