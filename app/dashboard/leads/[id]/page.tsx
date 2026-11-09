import LeadPage from './LeadPage'

/** ONE LEAD, ON ITS OWN PAGE (the owner, 23 Sep 2026: the Leads page "needs fixing i think drawer and all") */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params
  // the route hands the id over still URL-encoded (a Calendly lead's id held `@` and `%`, 9 Nov 2026: the page broke)
  let id = raw
  // decode ONCE and only if still encoded: the stored id itself legitimately holds `%2E` (encodeKey), which a second
  // decode would wrongly turn into `.`
  if (/%(25|40)/i.test(raw)) { try { id = decodeURIComponent(raw) } catch {} }
  return <LeadPage id={id} />
}
