import Acquisition from '../Acquisition'

/** ONE PROSPECT, ON ITS OWN PAGE (the owner, 23 Sep 2026: "I don't like how it's appearing as a drawer — we need a page") */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <Acquisition view="pipeline" prospectId={id} />
}
