/**
 * WHOSE PORTAL IS THIS? (the owner, 15 Sep 2026: "then yea, it's a separate
 * portal too" — "the business portal would be separate".)
 *
 * A client's portal link opens the BUSINESS portal: the shoots and pieces
 * made for the business, and nothing made for one of its people. A person
 * on the client has a link of their own that opens THEIR portal: only what
 * was made for them, titled with their name — and, when the shoot says so,
 * the business's name beside it. Pure: which rows belong on which portal,
 * and what the plan is called there.
 */
export type PortalScope =
  | { kind: 'business' }
  | { kind: 'person'; contactId: string; name: string }

/** Does this shoot or piece belong on this portal? */
export function belongsToPortal(row: { for_contact_id?: string | null }, scope: PortalScope): boolean {
  const who = row.for_contact_id ?? null
  return scope.kind === 'business' ? who === null : who === scope.contactId
}

/** The portal's own name: the business, or the person. */
export function portalName(clientName: string, scope: PortalScope): string {
  return scope.kind === 'person' ? scope.name : clientName
}

/**
 * What a shoot's plan is titled on the portal. On the business portal it is
 * the business. On a person's portal the two toggles decide: the business
 * name, the person's name, or both — and never neither, so a plan on a
 * portal always has a name (the person's wins when both are off).
 */
export function planPortalTitle(
  shoot: { portal_show_business?: boolean | null; portal_show_person?: boolean | null },
  clientName: string,
  scope: PortalScope,
): string {
  if (scope.kind === 'business') return clientName
  const business = shoot.portal_show_business !== false
  const person = shoot.portal_show_person !== false
  if (business && person) return `${clientName} · ${scope.name}`
  if (business) return clientName
  return scope.name
}

/** The toggles as they are saved: never both off. */
export function portalToggles(showBusiness: boolean, showPerson: boolean): { portal_show_business: boolean; portal_show_person: boolean } {
  if (!showBusiness && !showPerson) return { portal_show_business: false, portal_show_person: true }
  return { portal_show_business: showBusiness, portal_show_person: showPerson }
}

/** A person's portal address: their own token, the same door shape as the client's. */
export function personPortalPath(token: string): string {
  return `/portal/${encodeURIComponent(token)}`
}
