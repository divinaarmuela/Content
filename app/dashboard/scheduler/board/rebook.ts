'use client'

import { toast } from 'sonner'
import { postAct } from '../../../lib/post-act-contract'

/**
 * RE-BOOK A POST JUST CANCELLED (T22), from the toast that says where it went (1 Oct 2026). The one act
 * route, against the post's rev as the server holds it now — read fresh, because the press that
 * cancelled it was the last thing this page knew. The server decides who may; a refusal is said.
 */
export async function rebookPost(postId: string, knownRev?: number | null): Promise<void> {
  let rev = typeof knownRev === 'number' ? knownRev : null
  if (rev === null) {
    try {
      const res = await fetch(`/api/social/schedule/${encodeURIComponent(postId)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({})) as { post?: { rev?: number } }
      rev = typeof json.post?.rev === 'number' ? json.post.rev : null
    } catch { /* said below */ }
  }
  if (rev === null) { toast.error('Could not reach the post — open it from Cancelled and press Re-book.'); return }
  const r = await postAct(postId, { action: 'rebook', expect_rev: rev })
  if (r.ok) toast.success(r.words)
  else toast.error(r.reason)
}
