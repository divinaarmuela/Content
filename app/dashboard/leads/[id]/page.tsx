import LeadPage from './LeadPage'

/** ONE LEAD, ON ITS OWN PAGE (the owner, 23 Sep 2026: the Leads page "needs fixing i think drawer and all") */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <LeadPage id={id} />
}
