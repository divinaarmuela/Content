/**
 * THE BOARDS PAGE'S FILTERS (the owner, 20 Oct 2026: "just put all in boards then … and then add the right filter
 * client filters not search"). Every Milanote board — shoot briefs included — lives on Boards, one per client; this
 * narrows the page to a client, and to where a board came from. Pure.
 */

/** every board, the team's own, or those brought over from Milanote */
export type BoardSource = 'all' | 'here' | 'milanote'
export const BOARD_SOURCES: readonly { key: BoardSource; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'here', label: 'Made here' }, { key: 'milanote', label: 'From Milanote' },
]
export function boardFromSource(b: { milanote_id?: string | null }, source: BoardSource): boolean {
  return source === 'all' || (source === 'milanote') === !!b.milanote_id
}

/** the client filter: every board, the team's own boards (no client), or one client's */
export const ALL_CLIENTS = '__all__'
export const NO_CLIENT_FILTER = '__none__'
export function boardForClient(b: { client_id?: string | null }, client: string): boolean {
  if (client === ALL_CLIENTS) return true
  if (client === NO_CLIENT_FILTER) return !b.client_id
  return b.client_id === client
}

/** the clients the dropdown offers: only those that have a board, by name */
export function clientsWithBoards(boards: readonly { client_id?: string | null }[], clients: readonly { id: string; name: string }[]): { id: string; name: string; count: number }[] {
  const count = new Map<string, number>()
  for (const b of boards) if (b.client_id) count.set(b.client_id, (count.get(b.client_id) ?? 0) + 1)
  return clients.filter(c => count.has(c.id)).map(c => ({ id: c.id, name: c.name, count: count.get(c.id)! })).sort((a, b) => a.name.localeCompare(b.name))
}
