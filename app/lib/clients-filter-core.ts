/**
 * MY CLIENTS — which clients the Clients page shows (pure; tests/clients-filter-core.test.ts).
 *
 * Manal, via the owner, 26 Nov 2026: "When I click overview and click 'your clients' says 6? Then I click shows me
 * everyone's" — the Overview counted her own clients and its button opened the list of all 66. The owner: "for am
 * in clients make sure to show theirs … if 2 am show both".
 *
 * A client is "mine" when I am one of the people on it. A client with two account managers is on both their lists;
 * the page already draws every manager's name on the client, so both show. This narrows what is LISTED, nothing
 * more: who may open or change a client is still the server's to decide.
 */

type WithManagers = { managers?: { id: string }[] | null }

export function clientsOfMine<T extends WithManagers>(clients: readonly T[], myId: string | null | undefined): T[] {
  if (!myId) return []
  return clients.filter(c => (c.managers ?? []).some(m => m.id === myId))
}

/**
 * Does the page open on "My clients"? The link decides when it says (`?mine=1` from the Overview's "Your clients"
 * tile, `?mine=0` to see everyone); otherwise an account manager starts on their own and everybody else on all.
 */
export function startsOnMine(role: string | null | undefined, search: string): boolean {
  const asked = new URLSearchParams(search).get('mine')
  if (asked === '1') return true
  if (asked === '0') return false
  return role === 'account_manager'
}
