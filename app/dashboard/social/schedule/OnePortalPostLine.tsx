'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRow } from '@/lib/db-client'
import { postAct } from '@/app/lib/post-act-contract'
import type { PostState } from '@/app/lib/post-stage-core'
import {
  IF_NO_ANSWER_WORDS, REVIEW_WORDS, changedSinceApproval, ifNoAnswerOf, onePortal, readClientReview, reviewState,
  type IfNoAnswer,
} from '@/app/lib/one-portal-core'

/**
 * THE ONE PORTAL ON A POST (docs/ONE_PORTAL_SPEC.md §5), in the post window under its header, for a client on
 * the one portal only:
 *   - where the client's word stands — Approved, Not reviewed yet, Not approved with their note — and
 *     "Changed since the client approved" (R9: the approval stands; the team is shown);
 *   - the team's choice "If the client hasn't approved: Post anyway / Wait for the client" (R5).
 * Nothing is drawn for any other client.
 */
export default function OnePortalPostLine({ post, editable, onMoved, onOwnChange }: {
  post: PostState
  /** the person may change the post's settings (the window's own rule) */
  editable: boolean
  onMoved?: () => void
  /**
   * THIS CHOICE IS THE PERSON'S OWN WRITE, and it moves the post's rev. The window is told when it starts and
   * the post as the server answered (null = refused), so it is never read as "someone else changed this post" (5 Oct 2026,
   * Karly's Capila draft: she picked "Wait for the client", kept typing, and was told somebody else had changed it).
   */
  onOwnChange?: (phase: 'start' | 'end', answered: PostState | null) => void
}) {
  const { row: client } = useRow<{ id: string; portal_one?: boolean | null }>('clients', post.client_id)
  const [busy, setBusy] = useState(false)
  if (!onePortal(client)) return null
  if (post.stage === 'posted' || post.stage === 'cancelled') return null

  const review = readClientReview(post.client_review)
  const state = reviewState(post as never)
  const choice = ifNoAnswerOf(post)
  const set = async (next: IfNoAnswer) => {
    if (next === choice) return
    setBusy(true)
    onOwnChange?.('start', null)
    const r = await postAct(post.id, { action: 'set_if_no_answer', expect_rev: post.rev, if_no_answer: next })
    setBusy(false)
    onOwnChange?.('end', r.ok ? r.post : null)
    if (!r.ok) { toast.error(r.reason); return }
    toast.success(next === 'wait' ? 'It waits for the client — it comes off 15 minutes before its time unless they approve' : 'It goes out at its time, approved or not')
    onMoved?.()
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-inner border border-border p-2.5 text-[13px]" data-one-portal-line>
      {post.stage === 'booked' || review ? (
        <p>
          <span className="font-semibold">The client:</span>{' '}
          {state === 'not_approved' && review
            // on a Draft the note is already the header's "The client asked for a change" line — not twice
            ? <>Not approved{review.by && review.by !== 'the client' ? ` by ${review.by}` : ''}{review.note && post.stage !== 'draft' ? ` — “${review.note}”` : ''}</>
            : REVIEW_WORDS[state]}
          {state === 'approved' && review?.by && review.by !== 'the client' ? ` by ${review.by}` : ''}
        </p>
      ) : (
        <p className="text-muted-foreground">The client sees it on their portal once it is booked.</p>
      )}
      {changedSinceApproval(post as never) && (
        <p className="font-medium text-amber-700 dark:text-amber-300">Changed since the client approved — their approval stands; send them the preview if they should look again.</p>
      )}
      <label className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">If the client hasn&apos;t approved:</span>
        <select value={choice} disabled={!editable || busy} onChange={e => void set(e.target.value as IfNoAnswer)}
          className="min-h-9 rounded-full border border-border bg-surface px-3 text-[13px]" aria-label="If the client hasn't approved">
          {(['post', 'wait'] as const).map(k => <option key={k} value={k}>{IF_NO_ANSWER_WORDS[k]}</option>)}
        </select>
      </label>
    </div>
  )
}
