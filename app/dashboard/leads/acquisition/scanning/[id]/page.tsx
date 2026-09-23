import ConversationPage from './ConversationPage'

/** ONE SCANNED MESSAGE'S CONVERSATION (the owner, 23 Sep 2026: "a page which shows the convo") */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ConversationPage id={id} />
}
