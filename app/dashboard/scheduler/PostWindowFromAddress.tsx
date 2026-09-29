'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useRow } from '@/lib/db-client'
import type { SocialPost } from '@/lib/db-types'
import { postApprovalHref } from '../../lib/post-board-core'
import { POST_APPROVAL_BOARD } from '../../lib/overview-links-core'
import { OpenPostWindow, type PostWindowOutcome } from '../social/schedule/PostWindow'

/**
 * THE POST WINDOW, ON POST APPROVAL (review fix, 29 Sep 2026).
 *
 * Every card, list row and Waiting row on this page opens `?post=<id>` here —
 * the same window, with the same buttons, that opens anywhere else (the
 * owner's decision 2). It used to open only on the Schedule page, which the
 * quality checker cannot see, so they were asked to pass posts whose slides,
 * caption and notes they could not open.
 *
 * A post whose stage belongs to Schedule when the link is followed (Ready to
 * post, Booked in, Posted) is handed on to Schedule — nothing is booked here
 * (decision 1). A post that moves on while the window is open stays here
 * until the window closes, so the person reads the answer to their own press.
 */
export default function PostWindowFromAddress({ clientId = '' }: {
  /** the client the page is narrowed to — closing the window goes back to it (`?client=`) */
  clientId?: string
} = {}) {
  const params = useSearchParams()
  const router = useRouter()
  const postId = params.get('post')
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

  if (!postId || !row) return null

  const close = () => router.replace(postApprovalHref(clientId), { scroll: false })
  const done = (outcome: PostWindowOutcome) => {
    toast.success(outcome.link ? `${outcome.words}. The link to send: ${outcome.link}` : outcome.words)
    if (outcome.createdPostId) router.replace(`${POST_APPROVAL_BOARD}?post=${encodeURIComponent(outcome.createdPostId)}`, { scroll: false })
    else close()
  }
  return <OpenPostWindow key={postId} postId={postId} onClose={close} onDone={done} />
}
