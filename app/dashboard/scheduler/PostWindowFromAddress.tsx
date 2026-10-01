'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useRow } from '@/lib/db-client'
import type { SocialPost } from '@/lib/db-types'
import { CANCELLED_NOTICE, postApprovalHref } from '../../lib/post-board-core'
import { rebookPost } from './board/rebook'
import { POST_APPROVAL_BOARD } from '../../lib/overview-links-core'
import { OpenPostWindow, type PostWindowOutcome } from '../social/schedule/PostWindow'

/**
 * THE POST WINDOW, ON POST APPROVAL (review fix, 29 Sep 2026).
 *
 * Every card, list row and Waiting row on this page links to `?post=<id>` and
 * opens here — the same window, with the same buttons, that opens anywhere
 * else (the owner's decision 2).
 *
 * THE WINDOW IS OPENED AND CLOSED HERE, NOT BY THE ROUTER (30 Sep 2026). Loaded
 * from any link with a query (an email, the bell, a refresh on `?post=`), this
 * page's router swallowed every later move on the same page: the X, a card
 * click, `router.replace` to a new query — the address was written straight
 * back and the window stayed open (the owner: "I can't close the modal with
 * X"). Other pages were not affected; the cause is inside Next's navigation,
 * and nothing here waits on it any more. A left click on a post link on this
 * page, and the X, set the window's post directly and rewrite the address in
 * place (keeping Next's own history state). The links stay real links, so a
 * middle click or ⌘-click still opens a new tab.
 */
const postOf = (href: string): string | null | undefined => {
  try {
    const u = new URL(href, window.location.origin)
    if (u.origin !== window.location.origin || u.pathname !== POST_APPROVAL_BOARD) return undefined
    return u.searchParams.get('post')
  } catch { return undefined }
}

const rewrite = (href: string) => {
  try { window.history.replaceState(window.history.state, '', href) } catch { /* the window still follows the state */ }
}

export default function PostWindowFromAddress({ clientId = '' }: {
  /** the client the page is narrowed to — closing the window goes back to it (`?client=`) */
  clientId?: string
} = {}) {
  const params = useSearchParams()
  const [postId, setPostId] = useState<string | null>(() => params.get('post'))
  // a move that DID go through the router (the bell, a link from another page) still opens its post
  const fromRouter = params.get('post')
  useEffect(() => { setPostId(fromRouter) }, [fromRouter])

  // a plain left click on a post link on this page opens it here, without a navigation
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self')) return
      const id = postOf(a.getAttribute('href') ?? '')
      if (!id) return
      e.preventDefault()
      setPostId(id)
      rewrite(a.getAttribute('href') ?? '')
    }
    const onPop = () => setPostId(new URLSearchParams(window.location.search).get('post'))
    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPop)
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('popstate', onPop) }
  }, [])

  const live = useRow<SocialPost>('social_posts', postId)
  // a row from the post the address named a moment ago is not this post's
  const row = live.row && live.row.id === postId ? live.row : null
  const loading = live.loading || (!!live.row && !row)
  // A POST IS ONLY "GONE" ONCE THE DATABASE HAS ANSWERED FOR IT (29 Sep 2026: a With-client card opened with
  // "That post is not there any more" — the check ran in the render before the row was even asked for, when
  // `loading` was still the previous address's `false`)
  const asked = useRef<string | null>(null)
  if (postId && live.loading) asked.current = postId
  const warned = useRef<string | null>(null)
  useEffect(() => {
    if (!postId || loading || row || asked.current !== postId || warned.current === postId) return
    warned.current = postId
    toast.error('That post is not there any more. It may have been deleted.')
  }, [postId, loading, row])

  const close = useCallback(() => {
    setPostId(null)
    rewrite(postApprovalHref(clientId))
  }, [clientId])

  if (!postId || !row) return null

  const done = (outcome: PostWindowOutcome) => {
    // cancelled in the window: say where it went, with Re-book on the spot (1 Oct 2026)
    if (outcome.stage === 'cancelled' && outcome.postId) {
      const cancelledId = outcome.postId
      toast.success(CANCELLED_NOTICE, { duration: 12_000, action: { label: 'Re-book', onClick: () => { void rebookPost(cancelledId) } } })
      close()
      return
    }
    toast.success(outcome.link ? `${outcome.words}. The link to send: ${outcome.link}` : outcome.words)
    if (outcome.createdPostId) {
      setPostId(outcome.createdPostId)
      rewrite(`${POST_APPROVAL_BOARD}?post=${encodeURIComponent(outcome.createdPostId)}`)
    } else close()
  }
  return <OpenPostWindow key={postId} postId={postId} onClose={close} onDone={done} />
}
