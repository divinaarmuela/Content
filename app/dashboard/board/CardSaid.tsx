'use client'

import type { ReactNode, RefObject } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Chip from '../ui/Chip'
import { splitSlideTag } from '../../lib/slide-comment-core'

/**
 * WHAT WAS SAID — the one comments section, drawn the same on the Editor
 * drawer and the Post approval drawer (the owner, 13 Sep 2026: "the chat tab
 * is not like the post approval one, why is it different… make them the same
 * UI"). Both read the same `item_comments` rows and post to the same route,
 * so a note written on one page is read on the other. The drawer owns the
 * data and the send; this owns the look.
 */
export type SaidRow = {
  id: string
  author_id?: string | null
  body?: string | null
  created_at?: string | null
  visibility?: string | null
}

export default function CardSaid({
  rows, nameOf, roleOf, meId, when,
  isManager, clientName, readsClient,
  draft, setDraft, sending, onSend,
  toClient, setToClient,
  placeholder, replyLabel, onClearReply, noteBox, extras,
}: {
  rows: SaidRow[]
  nameOf: (uid: string | null | undefined) => string | null
  roleOf: (uid: string | null | undefined) => string | null
  meId: string | null | undefined
  /** the time, in the viewer's words */
  when: (iso: string) => string
  isManager: boolean
  clientName: string | null | undefined
  /** may this viewer read the client's own comments at all */
  readsClient: boolean
  draft: string
  setDraft: (v: string) => void
  sending: boolean
  onSend: () => void
  /** managers: a note for the team, or a reply the client sees on their portal */
  toClient: boolean
  setToClient: (v: boolean) => void
  /** the box's hint for somebody who is not a manager ("Write to Karly…") */
  placeholder?: string
  /** Post approval: "About photo 2 of 5" while a reply is pinned to one file */
  replyLabel?: string | null
  onClearReply?: () => void
  noteBox?: RefObject<HTMLTextAreaElement | null>
  /** anything drawn under the heading first: where to look, the change asked for */
  extras?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4" data-card-said>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">What was said</p>
      {extras}
      {!readsClient && (
        <p className="text-[12px] text-muted-foreground">The client’s own comments are read by the account manager; what they asked for is in the change note.</p>
      )}
      {rows.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing yet.</p>}
      {rows.map(c => {
        const { label, rest } = splitSlideTag(String(c.body ?? ''))
        return (
          <div key={c.id} className="rounded-inner bg-foreground/[0.04] p-3 text-[13px]">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground">
              <span className="font-semibold text-foreground">{c.author_id === meId ? 'You' : (nameOf(c.author_id) ?? 'Someone')}</span>
              <span>{c.created_at ? when(String(c.created_at)) : ''}</span>
              {label && <span className="italic">on {label.toLowerCase()}</span>}
              {c.visibility === 'client' && <Chip tone="blue" className="px-2 py-0.5">Client sees this</Chip>}
              {roleOf(c.author_id) === 'client' && <Chip tone="amber" className="px-2 py-0.5">Client</Chip>}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{rest}</p>
          </div>
        )
      })}
      {isManager && (
        <div className="flex w-fit items-center gap-1 rounded-full border border-border bg-surface p-1 text-[13px] font-semibold">
          <button type="button" aria-pressed={!toClient} onClick={() => setToClient(false)}
            className={cn('inline-flex min-h-11 items-center rounded-full px-3', !toClient ? 'bg-foreground text-background' : 'text-muted-foreground')}>Note for the team</button>
          <button type="button" aria-pressed={toClient} onClick={() => setToClient(true)}
            className={cn('inline-flex min-h-11 items-center rounded-full px-3', toClient ? 'bg-foreground text-background' : 'text-muted-foreground')}>Reply to {clientName ?? 'the client'}</button>
        </div>
      )}
      {replyLabel && onClearReply && (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
          {replyLabel}
          <button type="button" onClick={onClearReply} className="-my-2 inline-flex min-h-11 items-center underline underline-offset-4">the whole post instead</button>
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea ref={noteBox} rows={2} value={draft} onChange={e => setDraft(e.target.value)}
          aria-label={isManager && toClient ? `A reply to ${clientName ?? 'the client'}` : 'A note for the team'}
          placeholder={isManager
            ? (toClient ? 'They see this on their portal — no email is sent' : 'A note for the team — @name to tag someone')
            : (placeholder ?? 'A note for the team — @name to tag someone')}
          className="min-h-11 flex-1 resize-none rounded-inner border border-border bg-surface p-2.5 text-[14px]" />
        <Button className="h-11 w-11 rounded-full p-0" disabled={sending || !draft.trim()} onClick={onSend} aria-label="Add note">
          <MessageCircle className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
