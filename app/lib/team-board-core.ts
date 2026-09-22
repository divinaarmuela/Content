/**
 * TEAM BOARDS — the pure half (the owner, 21 Sep 2026: "create a boards page,
 * simply for internal — like the board in the shoot brief, but for the team
 * to use — and add a copy board link feature … only AMs and super admins can
 * create this board").
 *
 * And then, 22 Sep 2026, what the boards are FOR: "this is just inspo
 * boards" — an inspiration board for a client, "allow to edit / add to which
 * client, so it will show the client's name", and "ensure it goes through
 * the quality check stage and approved — essentially the same stage as the
 * brief flow with less columns". So a board names its client (or is the
 * team's own), and moves Inspo → Quality check → Approved, or back with a
 * note. An edit to an approved board puts it back to Inspo: what was
 * approved is no longer what is on it.
 *
 * A team board is the shoot brief's canvas with nothing around it. A manager
 * makes it and names it; anyone on the team opens it, works on it, and
 * shares it by its link. No I/O here.
 */

export type TeamBoardViewer = { id: string; role: string } | null | undefined

/** the address of a board inside the dashboard */
export function teamBoardPath(id: string): string {
  return `/dashboard/team-boards/${encodeURIComponent(id)}`
}

/** the link a person copies — the dashboard's own address, so it opens for anyone signed in on the team */
export function teamBoardLink(origin: string, id: string): string {
  return `${String(origin ?? '').replace(/\/+$/, '')}${teamBoardPath(id)}`
}

/** making, renaming, deleting a board — and saying which client it is for — is a manager's: an account manager or a super admin */
export function mayManageTeamBoards(viewer: TeamBoardViewer): boolean {
  return viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
}

/** working on a board — adding, moving, deleting cards — is anyone's on the team, never a client's */
export function mayEditTeamBoard(viewer: TeamBoardViewer): boolean {
  return !!viewer && viewer.role !== 'client'
}

/** THE QUALITY CHECK (22 Sep 2026): who may approve a board or ask for
 *  changes — the quality checker, and the managers, the same people who
 *  check a card's finished edit. */
export function mayReviewTeamBoard(viewer: TeamBoardViewer): boolean {
  return viewer?.role === 'quality_checker' || mayManageTeamBoards(viewer)
}

export const TEAM_BOARD_NAME_MAX = 80

/** a board's name, cleaned: trimmed, one line, bounded — null when nothing is left */
export function cleanBoardName(raw: unknown): string | null {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, TEAM_BOARD_NAME_MAX)
  return name || null
}

/** WHICH CLIENT (22 Sep 2026): a client's row id, or null for the team's
 *  own board. The id becomes part of a database path when it is looked up,
 *  so only a plain id shape passes (trap 9). */
export function cleanClientId(raw: unknown): string | null {
  const id = String(raw ?? '').trim()
  if (!id || id === 'none') return null
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/** the client's name for a board, or null for the team's own */
export function boardClientName(board: { client_id?: string | null }, clients: readonly { id: string; name?: string | null }[]): string | null {
  if (!board.client_id) return null
  const c = clients.find(x => x.id === board.client_id)
  return c ? String(c.name ?? '').trim() || 'A client' : 'A client'
}

/** what the board is called on a tile: the client's name, or that it is the team's own */
export const INTERNAL_BOARD_WORD = 'Internal'

/* ── the stages: the brief flow, with fewer columns ── */

export const TEAM_BOARD_STATUSES = ['draft', 'quality_check', 'changes_requested', 'approved'] as const
export type TeamBoardStatus = (typeof TEAM_BOARD_STATUSES)[number]
export const TEAM_BOARD_STATUS_LABEL: Record<TeamBoardStatus, string> = {
  draft: 'Inspo', quality_check: 'Quality check', changes_requested: 'Changes asked', approved: 'Approved',
}

/** a board's stage; absent or unknown = Inspo, which is where every board made before the stages existed sits */
export function boardStatusOf(board: { status?: string | null } | null | undefined): TeamBoardStatus {
  const s = String(board?.status ?? '')
  return (TEAM_BOARD_STATUSES as readonly string[]).includes(s) ? (s as TeamBoardStatus) : 'draft'
}

export const REVIEW_NOTE_MAX = 1000

/**
 * One step of the flow, and who may take it. Sending a board in for its
 * check is anyone's on the team, from Inspo or from Changes asked. Approving
 * it, or asking for changes (with a note saying what), is the checker's or
 * a manager's, and only while it is in the check. Nothing else is a step —
 * an approved board goes back to Inspo only by being edited (`statusAfterEdit`).
 */
export function checkBoardTransition(
  viewer: TeamBoardViewer, from: TeamBoardStatus, to: string, note?: unknown,
): { ok: true; note: string | null } | { ok: false; error: string } {
  if (!(TEAM_BOARD_STATUSES as readonly string[]).includes(to)) return { ok: false, error: 'That is not a stage a board can be in' }
  if (!mayEditTeamBoard(viewer)) return { ok: false, error: 'Boards are the team’s' }
  const words = String(note ?? '').trim().slice(0, REVIEW_NOTE_MAX)
  if (to === 'quality_check') {
    if (from !== 'draft' && from !== 'changes_requested') return { ok: false, error: from === 'quality_check' ? 'It is already in the quality check' : 'It is already approved' }
    return { ok: true, note: null }
  }
  if (to === 'approved' || to === 'changes_requested') {
    if (!mayReviewTeamBoard(viewer)) return { ok: false, error: 'Only the quality checker, an account manager or a super admin decides a board' }
    if (from !== 'quality_check') return { ok: false, error: 'Send it to the quality check first' }
    if (to === 'changes_requested' && !words) return { ok: false, error: 'Say what should change' }
    return { ok: true, note: to === 'changes_requested' ? words : null }
  }
  return { ok: false, error: 'A board goes back to Inspo by being worked on, not by a button' }
}

/** an edit to an approved board is a new board as far as the approval goes: back to Inspo */
export function statusAfterEdit(status: TeamBoardStatus): TeamBoardStatus {
  return status === 'approved' ? 'draft' : status
}

/** the boards page's columns, in the flow's order — every stage drawn, empty or not */
export function lanesOf<T extends { status?: string | null }>(boards: readonly T[]): { status: TeamBoardStatus; label: string; boards: T[] }[] {
  return TEAM_BOARD_STATUSES.map(status => ({ status, label: TEAM_BOARD_STATUS_LABEL[status], boards: boards.filter(b => boardStatusOf(b) === status) }))
}

/** "12 cards" / "1 card" / "Empty" — the line under a board's name on the list */
export function cardCountWords(cards: unknown): string {
  // arrows join cards; they are not something a person put on the board to read
  const n = Array.isArray(cards) ? cards.filter(c => c && typeof c === 'object' && (c as { kind?: unknown }).kind !== 'arrow').length : 0
  return n === 0 ? 'Empty' : n === 1 ? '1 card' : `${n} cards`
}

/** newest work first: the board somebody touched last leads the list */
export function sortTeamBoards<T extends { updated_at?: string | null; created_at?: string | null }>(rows: readonly T[]): T[] {
  const at = (r: T) => String(r.updated_at ?? r.created_at ?? '')
  return [...rows].sort((a, b) => at(b).localeCompare(at(a)))
}

/** the list's search: the name, the name of whoever made it, or the client it is for */
export function matchesBoardSearch(board: { name?: string | null }, makerName: string | null, q: string, clientName: string | null = null): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return String(board.name ?? '').toLowerCase().includes(needle)
    || String(makerName ?? '').toLowerCase().includes(needle)
    || String(clientName ?? '').toLowerCase().includes(needle)
}

/**
 * WHAT COUNTS AS WORKING ON AN APPROVED BOARD (the owner, 22 Sep 2026: The Glass
 * Den's approved board fell back to Inspo because "I accidentally added a
 * blank note"). Only a change to what the board SAYS OR SHOWS is work: a card
 * with content added, a card removed, a card's words, link, picture, Drive
 * files or colour changed. Dragging cards around, resizing them, stacking
 * them, or leaving an empty note that says nothing is not — what was
 * approved is still what is on the board.
 */
const PLACE_ONLY = new Set(['x', 'y', 'w', 'h', 'z', 'updated_at'])
type AnyCard = { id: string; kind?: string; text?: string | null; [k: string]: unknown }

/** a note or label with no words is nothing on the board */
export function isBlankCard(c: AnyCard | null | undefined): boolean {
  return !!c && (c.kind === 'note' || c.kind === 'label') && !String(c.text ?? '').trim()
}

function content(c: AnyCard): string {
  const keys = Object.keys(c).filter(k => !PLACE_ONLY.has(k)).sort()
  return JSON.stringify(keys.map(k => [k, c[k]]))
}

/** did this edit change what the board says or shows? */
export function editChangesContent(before: readonly AnyCard[], after: readonly AnyCard[]): boolean {
  const was = new Map(before.filter(c => !isBlankCard(c)).map(c => [c.id, content(c)]))
  const now = new Map(after.filter(c => !isBlankCard(c)).map(c => [c.id, content(c)]))
  if (was.size !== now.size) return true
  for (const [id, body] of now) if (was.get(id) !== body) return true
  return false
}
