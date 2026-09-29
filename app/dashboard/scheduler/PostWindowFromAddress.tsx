'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useRow } from '@/lib/db-client'
import type { SocialPost } from '@/lib/db-types'
import { STAGE_PAGE, readPostState, type PostStage } from '../../lib/post-stage-core'
import { POST_APPROVAL_PAGE, postWindowHref } from '../../lib/post-board-core'
import { SCHEDULE_PAGE } from '../../lib/page-access-core'
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
export default function PostWindowFromAddress() {
  const params = useSearchParams()
  const router = useRouter()
  const postId = params.get('post')
  const live = useRow<SocialPost>('social_posts', postId)
  // a row from the post the address named a moment ago is not this post's
  const row = live.row && live.row.id === postId ? live.row : null
  const loading = live.loading || (!!live.row && !row)
  const firstStage = useRef<{ id: string; stage: PostStage | null } | null>(null)

  const stage = row ? readPostState(row as unknown as Record<string, unknown>)?.stage ?? null : null
  if (postId && row && firstStage.current?.id !== postId) firstStage.current = { id: postId, stage }
  const belongsToSchedule = !!firstStage.current && firstStage.current.id === postId
    && firstStage.current.stage !== null && STAGE_PAGE[firstStage.current.stage] === 'schedule'

  useEffect(() => {
    if (!postId || !row || !belongsToSchedule || !stage) return
    router.replace(postWindowHref({ id: row.id, client_id: row.client_id, stage }, SCHEDULE_PAGE, 'schedule'))
  }, [postId, row, stage, belongsToSchedule, router])

  const warned = useRef<string | null>(null)
  useEffect(() => {
    if (!postId || loading || row || warned.current === postId) return
    warned.current = postId
    toast.error('That post is not there any more. It may have been deleted.')
  }, [postId, loading, row])

  if (!postId || !row || belongsToSchedule) return null

  const close = () => router.replace(POST_APPROVAL_PAGE, { scroll: false })
  const done = (outcome: PostWindowOutcome) => {
    toast.success(outcome.link ? `${outcome.words}. The link to send: ${outcome.link}` : outcome.words)
    if (outcome.createdPostId) router.replace(`${POST_APPROVAL_PAGE}?post=${encodeURIComponent(outcome.createdPostId)}`, { scroll: false })
    else close()
  }
  return <OpenPostWindow key={postId} postId={postId} onClose={close} onDone={done} />
}
