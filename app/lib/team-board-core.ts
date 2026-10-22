/**
 * TEAM BOARDS — the pure half (the owner, 21 Sep 2026: "create a boards page,
 * simply for internal — like the board in the shoot brief, but for the team
 * to use — and add a copy board link feature … only AMs and super admins can
 * create this board").
 *
 * And then, 22 Sep 2026: a board names its client (or is the team's own),
 * "so it will show the client's name". Since 22 Oct 2026 a board has no
 * stages — it is the team's own working space (see NO STAGES below).
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

/* NO STAGES (the owner, 22 Oct 2026: "I don't think we need quality check and
 * inspo or changes asked for boards — this is just internal for us to work").
 * The Inspo → Quality check → Changes asked → Approved flow of 22 Sep 2026 is
 * gone from Boards: no lanes, no stage chip, no send-in / approve / ask-for-
 * changes buttons, and the route no longer takes a `status`. A board's stored
 * `status`, `review_note`, `submitted_*` and `reviewed_*` are left where they
 * are, unread — nothing is deleted. */

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
