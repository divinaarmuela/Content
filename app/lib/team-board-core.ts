/**
 * TEAM BOARDS — the pure half (the owner, 21 Sep 2026: "create a boards page,
 * simply for internal — like the board in the shoot brief, but for the team
 * to use — and add a copy board link feature … no need for approvals … only
 * AMs and super admins can create this board").
 *
 * A team board is the shoot brief's canvas with nothing around it: no client,
 * no shoot, no review, no approval. A manager makes it and names it; anyone
 * on the team opens it, works on it, and shares it by its link. No I/O here.
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

/** making, renaming and deleting a board is a manager's: an account manager or a super admin */
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

/** the list's search: the name, or the name of whoever made it */
export function matchesBoardSearch(board: { name?: string | null }, makerName: string | null, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return String(board.name ?? '').toLowerCase().includes(needle) || String(makerName ?? '').toLowerCase().includes(needle)
}
