/**
 * THE "WHO IS THIS POST FOR?" LIST — pure (29 Sep 2026).
 *
 * The New post window on Post approval took ~13 s to show its client list on
 * the live site. It drew the list from `useSchedulePosts`, which opened live
 * browser subscriptions to the WHOLE `clients` table (every column of every
 * client: brand_profile, notes, instagram_locations …) and the WHOLE
 * `team_user_clients` table, and waited on a second `/api/team/me` round trip,
 * all to show a list of names.
 *
 * Now the list is one request (`GET /api/clients/for-posting`) whose answer is
 * only `{ id, name }` for the clients this person may post for. The server
 * decides who may see what (`accessibleClientIds`, the same rule the Schedule
 * page's picker applies in the browser); this file is the shaping.
 */

export type ClientChoice = { id: string; name: string }

/**
 * The clients this person may pick between, as id + name only: the clients
 * they may touch (`allowed` null = every client), never an archived one,
 * sorted by name. The same set `useSchedulePosts`'s `pickable` draws.
 */
export function clientChoices(
  rows: readonly { id?: unknown; name?: unknown; status?: unknown }[],
  allowed: readonly string[] | null,
): ClientChoice[] {
  const ok = allowed === null ? null : new Set(allowed)
  const out: ClientChoice[] = []
  for (const r of rows) {
    const id = typeof r.id === 'string' ? r.id : ''
    if (!id) continue
    if (ok && !ok.has(id)) continue
    if (r.status === 'archived') continue
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Unnamed client'
    out.push({ id, name })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Read the route's answer; anything that is not a list of choices is an empty list. */
export function readClientChoices(json: unknown): ClientChoice[] {
  const list = json && typeof json === 'object' && Array.isArray((json as { clients?: unknown }).clients)
    ? (json as { clients: unknown[] }).clients : []
  return list.filter((c): c is ClientChoice =>
    !!c && typeof c === 'object' && typeof (c as ClientChoice).id === 'string' && typeof (c as ClientChoice).name === 'string')
    .map(c => ({ id: c.id, name: c.name }))
}
