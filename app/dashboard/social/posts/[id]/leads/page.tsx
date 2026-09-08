import { notFound } from 'next/navigation'
import { requireSignedIn, AuthzError } from '../../../../../lib/authz'
import { loadPostLeads } from '../../../../../lib/post-leads'
import LeadsView from './LeadsView'

/**
 * WHO THIS POST BROUGHT IN — a page of its own, off the post's page.
 *
 * One row per person who liked or commented on THIS post, judged against the
 * follower list and the Inbox: new follower since the post (a lead), wrote
 * in, already following, not following, or gone. People who only touched
 * other posts are not here. Loaded on the server through the post's own
 * access gate; nothing on this path fetches from Instagram — the two buttons
 * on the page do that on purpose.
 */
export const dynamic = 'force-dynamic'

export default async function PostLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') notFound()
    const data = await loadPostLeads(user, id)
    return <LeadsView data={data} />
  } catch (e) {
    if (e instanceof AuthzError) notFound()
    throw e
  }
}
