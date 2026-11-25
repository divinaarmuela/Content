'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { postAct } from '@/app/lib/post-act-contract'
import type { PostState } from '../../../lib/post-stage-core'
import {
  IF_NO_ANSWER_CHOICES, IF_NO_ANSWER_SAID, IF_NO_ANSWER_WORDS, ifNoAnswerOf, postPortalPath, type IfNoAnswer,
} from '../../../lib/one-portal-core'

/** the stages on which the choice may still be changed (post-stage-core: set_if_no_answer) */
const CHOICE_STAGES: readonly string[] = ['draft', 'quality_check', 'ready', 'booked']

/** Does this card's menu carry anything of the client's portal? */
export function portalMenuShows(post: Pick<PostState, 'stage'>, portal: { token: string | null } | null): boolean {
  return !!portal && (CHOICE_STAGES.includes(post.stage) || (post.stage === 'booked' && !!portal.token))
}

/**
 * THE CLIENT'S SIDE OF A POST, FROM ITS CARD (the owner, 25 Nov 2026: "when scheduled make it easy to change this
 * setting too" and "it should have a copy portal link on the card, but the general scheduling portal link").
 *
 * The choice "If the client hasn't approved" — Post anyway, Wait for the client, No approval needed — lived only
 * inside the post window, and so did the portal link. Both are on the card's own menu now, one press each, on a
 * post that is already booked as much as on a draft. The link is the post's own page on the client's Scheduling tab
 * when they are asked about it, and the Scheduling tab itself when the post needs no approval.
 */
export function PostPortalMenu({ post, portal, first }: {
  post: PostState
  portal: { token: string | null } | null
  /** nothing is drawn above it in the menu, so it needs no line over it */
  first: boolean
}) {
  const [busy, setBusy] = useState(false)
  if (!portalMenuShows(post, portal) || !portal) return null
  const choice = ifNoAnswerOf(post)
  const mayChoose = CHOICE_STAGES.includes(post.stage)
  const set = async (next: IfNoAnswer) => {
    if (next === choice || busy) return
    setBusy(true)
    const r = await postAct(post.id, { action: 'set_if_no_answer', expect_rev: post.rev, if_no_answer: next })
    setBusy(false)
    if (!r.ok) { toast.error(r.reason); return }
    toast.success(IF_NO_ANSWER_SAID[next])
  }
  const link = portal.token && post.stage === 'booked' && typeof window !== 'undefined'
    ? `${window.location.origin}${postPortalPath(portal.token, post)}`
    : null
  const copy = () => {
    if (!link) return
    void navigator.clipboard.writeText(link)
      .then(() => toast.success('Portal link copied — send it to the client'))
      .catch(() => toast.error('Could not copy — the link is: ' + link))
  }
  return (
    <>
      {!first && <DropdownMenuSeparator />}
      {mayChoose && (
        <>
          <DropdownMenuLabel className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">If the client hasn&apos;t approved</DropdownMenuLabel>
          {IF_NO_ANSWER_CHOICES.map(k => (
            <DropdownMenuItem key={k} className="min-h-11 gap-2" disabled={busy} data-if-no-answer={k}
              aria-checked={k === choice} role="menuitemradio" onClick={() => void set(k)}>
              <Check className={`h-4 w-4 shrink-0 ${k === choice ? '' : 'invisible'}`} aria-hidden />
              {IF_NO_ANSWER_WORDS[k]}
            </DropdownMenuItem>
          ))}
        </>
      )}
      {link && (
        <DropdownMenuItem className="min-h-11" onClick={copy} data-copy-portal-link>Copy portal link</DropdownMenuItem>
      )}
    </>
  )
}
