'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasCard } from '../../lib/batch-brief-core'
import { canvasCardLabel } from '../../lib/canvas-comments-core'

export type CardComment = {
  id: string
  created_at: string
  body: string
  author_name: string
  from_team: boolean
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * The comments on ONE card of the planning board — what the card is, who
 * said what and when, and a box to add to it. The same panel on both sides
 * of the glass: the client's portal and the team's shoot page render it
 * with their own rows and their own send. Never a thread for the whole
 * board — the panel opens for the card that was picked and says which one
 * at the top.
 *
 * On a phone it sits under the canvas, full width; from lg up, beside it.
 * Every control is a 44px target.
 */
export default function CardCommentPanel({
  card, comments, onSend, onClose, name, viewer, className,
}: {
  card: CanvasCard
  comments: CardComment[]
  /** post the words; true when they landed */
  onSend: (body: string) => Promise<boolean>
  onClose: () => void
  /** the client's name, remembered on their device — the team side omits it */
  name?: { value: string; onChange: (v: string) => void }
  viewer: 'client' | 'team'
  className?: string
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft('') }, [card.id])

  const send = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    const ok = await onSend(body)
    setBusy(false)
    if (ok) setDraft('')
  }

  const label = canvasCardLabel(card)
  const image = card.kind === 'image' || card.kind === 'mockup' ? card.url : card.thumb
  const otherSide = viewer === 'client' ? 'MD Media' : 'Client'

  return (
    <aside
      data-card-comments={card.id}
      aria-label={`Comments on ${label}`}
      className={cn('flex flex-col overflow-hidden rounded-card border border-border bg-popover text-popover-foreground shadow-lg', className)}
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Comments on this card</p>
          <p className="truncate text-[15px] font-semibold">{label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close comments"
          className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-foreground/[0.06]">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* what the card is — enough to know you are talking about the right one */}
      {(image || (card.kind === 'note' && card.text) || (card.kind === 'link' && card.url)) && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={label} className="max-h-40 w-full rounded-inner object-cover" />
          )}
          {card.kind === 'note' && card.text && (
            <p className="line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{card.text}</p>
          )}
          {(card.kind === 'link' || card.kind === 'image') && card.url && (
            <a href={card.url} target="_blank" rel="noreferrer noopener"
              className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> {card.kind === 'link' ? 'Open the link' : 'Open full size'}
            </a>
          )}
        </div>
      )}

      <ol className="flex max-h-[40vh] min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3 lg:max-h-[50vh]">
        {comments.length === 0 && (
          <li className="py-5 text-center text-[13px] text-muted-foreground">Nothing yet. Say what you think of this one.</li>
        )}
        {comments.map(c => (
          <li key={c.id} className="rounded-inner bg-foreground/[0.04] px-3 py-2.5">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground">
              <span className="font-semibold text-foreground">{c.author_name}</span>
              {c.from_team !== (viewer === 'team') && (
                <span className="rounded bg-foreground px-1.5 py-px text-[10px] uppercase tracking-wider text-background">{otherSide}</span>
              )}
              <span suppressHydrationWarning>{when(c.created_at)}</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-[1.45]">{c.body}</p>
          </li>
        ))}
      </ol>

      <form className="flex flex-col gap-2 border-t border-border px-4 py-3" onSubmit={e => { e.preventDefault(); void send() }}>
        {name && (
          <input
            value={name.value}
            onChange={e => name.onChange(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            maxLength={60}
            className="min-h-11 w-full rounded-tile border border-border bg-background px-3 text-[14px] text-foreground outline-none focus:ring-2 focus:ring-ring sm:max-w-[240px]"
          />
        )}
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={viewer === 'client' ? 'Say something about this card…' : 'Reply to the client, or leave a note on this card…'}
          rows={2}
          maxLength={4000}
          onKeyDown={e => {
            e.stopPropagation()
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send() }
          }}
          className="min-h-11 w-full resize-none rounded-tile border border-border bg-background p-3 text-[14px] text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !draft.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40">
            <Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </aside>
  )
}
