/**
 * WHO IS DOING WHAT — the Client and People filters on the three boards.
 *
 * The owner, 11 Sep 2026: "as super admin, acc managers, quality check allow
 * to filter by client and also more filter by employee like people so we can
 * know who's doing what". One rule, shared by Post approval, Editor and
 * Shoots: a card INVOLVES a person when they own it, were handed it to
 * post, were asked to check it, or (on a shoot) are its editor or crew. The
 * picker lists exactly the people on the visible cards, with how many each
 * holds, so nobody is offered a name that filters to nothing.
 *
 * Pure: no I/O, no React. The hook that remembers the choice and the
 * control that draws it live beside the boards.
 */

export type FilterCard = {
  id: string
  client_id?: string | null
  /** the card's holder (an editor, a designer, a manager on a task) */
  owner_id?: string | null
  /** the schedulers it was handed to */
  scheduler_ids?: unknown
  /** the people asked to check it (`asked-core`) */
  asked_ids?: unknown
  /** a shoot's editor and crew (`shoot-sop-core`) */
  editor_id?: string | null
  crew_ids?: unknown
}

export type Filters = { client: string | null; person: string | null }

export const NO_FILTERS: Filters = { client: null, person: null }

export type PersonRow = {
  id: string
  name: string
  /** the role, in the team's own word ("Editor or designer") */
  role: string
  initials: string
  /** how many of the visible cards involve them */
  count: number
}

export type ClientRow = { id: string; name: string; count: number }

/** Who may narrow a board to a person: the people whose job is to see
 *  everyone's work — managers, super admins and the quality reviewer. */
export function mayFilterPeople(viewer: { role: string; quality_reviewer?: boolean | null }): boolean {
  return viewer.role === 'super_admin' || viewer.role === 'account_manager' || viewer.quality_reviewer === true
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x ?? '')).filter(Boolean) : []
}

/** Everyone a card involves, once each, in the order they matter. */
export function peopleOnCard(card: FilterCard): string[] {
  const out: string[] = []
  const add = (id: string | null | undefined) => { if (id && !out.includes(id)) out.push(id) }
  add(card.owner_id)
  add(card.editor_id)
  for (const id of ids(card.scheduler_ids)) add(id)
  for (const id of ids(card.asked_ids)) add(id)
  for (const id of ids(card.crew_ids)) add(id)
  return out
}

export function cardInvolves(card: FilterCard, personId: string): boolean {
  return peopleOnCard(card).includes(personId)
}

/** Two letters for the avatar — "Ada Lovelace" → "AL", "ada" → "AD". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const two = parts.length >= 2 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)
  return (two || '—').toUpperCase()
}

/**
 * The People picker's rows: the people on these cards, busiest first, then
 * by name. Somebody on a card who is not in `who` (a deactivated account, a
 * row not yet on the wire) is listed as "Someone" rather than dropped, so
 * the count on the board and the count in the picker always agree.
 */
export function peopleOnCards(
  cards: readonly FilterCard[],
  who: ReadonlyMap<string, { name: string; role: string }>,
): PersonRow[] {
  const counts = new Map<string, number>()
  for (const c of cards) for (const id of peopleOnCard(c)) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts.entries()]
    .map(([id, count]) => {
      const w = who.get(id)
      const name = w?.name?.trim() || 'Someone'
      return { id, name, role: w?.role ?? '', initials: initialsOf(name), count }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** The Client picker's rows: the clients on these cards, by name. */
export function clientsOnCards(cards: readonly FilterCard[], names: ReadonlyMap<string, string>): ClientRow[] {
  const counts = new Map<string, number>()
  for (const c of cards) {
    const id = String(c.client_id ?? '')
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) ?? 'A client', count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function applyFilters<T extends FilterCard>(cards: readonly T[], f: Filters): T[] {
  return cards.filter(c =>
    (!f.client || String(c.client_id ?? '') === f.client)
    && (!f.person || cardInvolves(c, f.person)))
}

export function hasFilters(f: Filters): boolean {
  return f.client !== null || f.person !== null
}

/**
 * The line above a narrowed board: "Showing Ada's cards for Acme — 4 of 20".
 * Null when nothing is narrowed, so the line is drawn only when it says
 * something.
 */
export function filterWords(
  f: Filters, names: { person?: string | null; client?: string | null }, shown: number, total: number,
): string | null {
  if (!hasFilters(f)) return null
  const who = f.person ? `${names.person ?? 'Someone'}’s cards` : 'every card'
  const where = f.client ? ` for ${names.client ?? 'this client'}` : ''
  return `Showing ${who}${where} — ${shown} of ${total}`
}

/** An empty column under a filter says who and where, not "nothing being
 *  made" — that would be a lie about the board. */
export function filteredEmpty(
  laneLabel: string, f: Filters, names: { person?: string | null; client?: string | null },
): string | null {
  if (!hasFilters(f)) return null
  const who = f.person ? ` for ${names.person ?? 'them'}` : ''
  const where = f.client ? ` at ${names.client ?? 'this client'}` : ''
  return `No cards${who}${where} in ${laneLabel}`
}

/** A remembered or linked choice is only a guess: it must name one of the
 *  rows on offer, or it is nobody. */
export function validChoice(value: string | null, rows: readonly { id: string }[]): string | null {
  return value && rows.some(r => r.id === value) ? value : null
}
