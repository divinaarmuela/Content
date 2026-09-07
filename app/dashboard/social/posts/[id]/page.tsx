import { notFound } from 'next/navigation'
import { requireSignedIn, AuthzError } from '../../../../lib/authz'
import { loadPostPage } from '../../../../lib/post-page'
import PostView from './PostView'

/**
 * A PAGE FOR EVERY POST.
 *
 * Its own address, keyed by the post — so a card that carries three posts
 * links to three pages, and a person can send somebody one of them.
 *
 * Loaded on the server, from the database, through the card's own access gate
 * (`loadPostPage` → `loadPostForUser`). NOTHING ON THIS PATH FETCHES: every
 * figure the page draws was written by a sweep that already runs, and the
 * page's own listeners keep it moving after that. A client account never gets
 * here — they have their portal page instead.
 */
export const dynamic = 'force-dynamic'

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') notFound()
    const data = await loadPostPage(user, id)
    return <PostView data={data} />
  } catch (e) {
    if (e instanceof AuthzError) notFound()
    throw e
  }
}
