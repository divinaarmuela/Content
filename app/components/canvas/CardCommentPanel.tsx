'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ExternalLink, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasCard } from '../../lib/batch-brief-core'
import { canvasCardLabel } from '../../lib/canvas-comments-core'
import MentionBox from '../../dashboard/MentionBox'
import { extractMentions, type Mentionable } from '../../lib/mention-core'
import { cardThreads, cardWords, markQuotes, MAX_QUOTE, snapToWords, type PlanThread } from '../../lib/plan-comments-core'
import { LinkedText } from '../LinkedText'

export type CardComment = {
  id: string
  created_at: string
  body: string
  author_name: string
  from_team: boolean
  /** ON THE CARD'S OWN WORDS (29 Oct 2026): the words selected, a reply's first comment, and whether it is dealt with */
  anchor_quote?: string | null
  parent_id?: string | null
  resolved?: boolean | null
  card_id?: string | null
}
/** what a comment is: on the words selected, or a reply to a first comment */
export type CardCommentWhere = { quote?: string; parent_id?: string }

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })

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
  card, comments, onSend, onResolve, onClose, name, viewer, members, className,
}: {
  card: CanvasCard
  comments: CardComment[]
  /** post the words (and who they tag) — on the selected words, or as a reply; true when they landed */
  onSend: (body: string, mentionIds?: string[], where?: CardCommentWhere) => Promise<boolean>
  /** mark a thread dealt with, or open it again; absent = no Resolve on this side */
  onResolve?: (commentId: string, resolved: boolean) => Promise<boolean>
  /** TAGGING (22 Sep 2026): the people "@" offers — the team side passes the
   *  team and the box becomes a MentionBox; the client's side passes nobody */
  members?: (Mentionable & { email?: string; hint?: string })[]
  onClose: () => void
  /** the client's name, remembered on their device — the team side omits it */
  name?: { value: string; onChange: (v: string) => void }
  viewer: 'client' | 'team'
  className?: string
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  /** the card's words picked for the next comment (29 Oct 2026, "same goes for boards") */
  const [quote, setQuote] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  useEffect(() => { setDraft(''); setQuote(null) }, [card.id])

  const send = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    const ok = await onSend(body, members ? extractMentions(body, members).map(m => m.id) : undefined, quote ? { quote } : undefined)
    setBusy(false)
    if (ok) { setDraft(''); setQuote(null) }
  }

  // EVERY FIRST COMMENT IS A THREAD — its replies under it, and Resolve — as on the shoot plan
  const threads = useMemo(() => cardThreads(comments, card.id), [comments, card.id])
  const open = threads.filter(t => !t.root.resolved)
  const done = threads.filter(t => t.root.resolved)
  const words = cardWords(card)
  const lit = markQuotes(words, open.filter(t => t.root.anchor_quote).map(t => ({ id: t.root.id, quote: String(t.root.anchor_quote) })))

  // WORDS SELECTED ON THE CARD: read on every change of the selection, inside the card's words only
  const wordsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const read = () => {
      const sel = window.getSelection()
      const box = wordsRef.current
      if (!sel || sel.isCollapsed || !box || !box.contains(sel.anchorNode) || !box.contains(sel.focusNode)) return
      const q = sel.toString().replace(/\s+/g, ' ').trim()
      if (q.length >= 2) setQuote(snapToWords(box.textContent ?? '', q).slice(0, MAX_QUOTE))
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [])

  const label = canvasCardLabel(card)
  const repeatsWords = !!words && words.replace(/\s+/g, ' ').startsWith(label.replace(/…$/, ''))
  const image = card.kind === 'image' || card.kind === 'mockup' ? card.url : card.thumb

  return (
    <aside
      data-card-comments={card.id}
      aria-label={`Comments on ${label}`}
      // the "@" list hangs below the box, so a panel that offers it must not clip its own bottom (seen live, 22 Sep 2026)
      className={cn('flex flex-col rounded-card border border-border bg-popover text-popover-foreground shadow-lg', members ? 'overflow-visible' : 'overflow-hidden', className)}
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 self-center">
          {/* a note's name is its first words, cut short — and its whole words are right below (30 Oct 2026) */}
          {repeatsWords ? <p className="text-[15px] font-semibold">Comments on this card</p> : (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Comments on this card</p>
              <p className="truncate text-[15px] font-semibold">{label}</p>
            </>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close comments"
          className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-foreground/[0.06]">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* what the card is — enough to know you are talking about the right one */}
      {(image || words || (card.kind === 'link' && card.url)) && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={label} className="max-h-40 w-full rounded-inner object-cover" />
          )}
          {words && (
            <>
              <div ref={wordsRef} data-card-words={card.id}
                className="max-h-48 select-text overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                {lit.map((p, i) => p.ids.length
                  ? <mark key={i} className="cursor-pointer rounded-[2px] bg-accent-amber/50 text-foreground" title="Commented — see below"
                      onClick={() => document.getElementById(`card-thread-${p.ids[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>{p.text}</mark>
                  : <LinkedText key={i} text={p.text} />)}
              </div>
              <p className="text-[11px] text-muted-foreground">Select any words to comment on them.</p>
            </>
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
        {threads.length === 0 && (
          <li className="py-5 text-center text-[13px] text-muted-foreground">Nothing yet. Say what you think of this one.</li>
        )}
        {open.map(t => <CardThread key={t.root.id} t={t} viewer={viewer} onSend={onSend} onResolve={onResolve} replyName={name} />)}
        {done.length > 0 && (
          <li>
            <button type="button" onClick={() => setShowDone(v => !v)} className="min-h-9 text-[12px] font-semibold text-muted-foreground underline underline-offset-2">
              {showDone ? 'Hide' : 'Show'} {done.length} resolved comment{done.length === 1 ? '' : 's'}
            </button>
          </li>
        )}
        {showDone && done.map(t => <CardThread key={t.root.id} t={t} viewer={viewer} onSend={onSend} onResolve={onResolve} replyName={name} />)}
      </ol>

      <form className="flex flex-col gap-2 border-t border-border px-4 py-3" onSubmit={e => { e.preventDefault(); void send() }}>
        {quote && (
          <div className="flex items-start gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 border-l-2 border-accent-amber pl-2 text-[12px] italic text-muted-foreground">On “{quote}”</p>
            <button type="button" onClick={() => setQuote(null)} aria-label="Not on these words"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-foreground/[0.06]"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
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
        {members ? (
          <MentionBox
            value={draft}
            onChange={setDraft}
            members={members}
            placeholder={quote ? 'Comment on the selected words — type @ to tag someone…' : 'Leave a note on this card — type @ to tag someone…'}
            rows={2}
            disabled={busy}
            onSubmit={() => void send()}
            className="min-h-11 w-full resize-none rounded-tile border border-border bg-background p-3 text-[14px] text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        ) : (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={quote ? 'What would you like to say about these words?' : viewer === 'client' ? 'Say something about this card…' : 'Reply to the client, or leave a note on this card…'}
            rows={2}
            maxLength={4000}
            onKeyDown={e => {
              e.stopPropagation()
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send() }
            }}
            className="min-h-11 w-full resize-none rounded-tile border border-border bg-background p-3 text-[14px] text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        )}
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

/** one thread on a card: the words it is on, the first comment, its replies, a reply box and Resolve */
function CardThread({ t, viewer, onSend, onResolve, replyName }: {
  t: PlanThread<CardComment>
  viewer: 'client' | 'team'
  onSend: (body: string, mentionIds?: string[], where?: CardCommentWhere) => Promise<boolean>
  onResolve?: (commentId: string, resolved: boolean) => Promise<boolean>
  replyName?: { value: string; onChange: (v: string) => void }
}) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const resolved = !!t.root.resolved
  // a comment still on its way has no row to reply to or resolve yet
  const sending = t.root.id.startsWith('local-')
  const otherSide = viewer === 'client' ? 'MD Media' : 'Client'
  const send = async () => {
    if (!reply.trim() || busy) return
    setBusy(true)
    const ok = await onSend(reply.trim(), undefined, { parent_id: t.root.id })
    setBusy(false)
    if (ok) { setReply(''); setReplying(false) }
  }
  const line = (c: CardComment) => (
    <div key={c.id}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground">
        <span className="font-semibold text-foreground">{c.author_name}</span>
        {c.from_team !== (viewer === 'team') && (
          <span className="rounded bg-foreground px-1.5 py-px text-[10px] uppercase tracking-wider text-background">{otherSide}</span>
        )}
        <span suppressHydrationWarning>{when(c.created_at)}</span>
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-[1.45]">{c.body}</p>
    </div>
  )
  return (
    <li id={`card-thread-${t.root.id}`} className={cn('flex flex-col gap-2 rounded-inner px-3 py-2.5', resolved ? 'bg-foreground/[0.03] opacity-75' : t.root.anchor_quote ? 'bg-tint-amber/40' : 'bg-foreground/[0.04]')}>
      {t.root.anchor_quote && <p className="border-l-2 border-accent-amber pl-2 text-[12px] italic text-muted-foreground">“{t.root.anchor_quote}”</p>}
      {line(t.root)}
      {t.replies.length > 0 && <div className="flex flex-col gap-2 border-l-2 border-border pl-3">{t.replies.map(line)}</div>}
      {!sending && (
        <div className="flex flex-col gap-2">
          {replying && !resolved && (
            <>
              {replyName && !replyName.value.trim() && (
                <input value={replyName.value} onChange={e => replyName.onChange(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={60}
                  className="min-h-10 w-full rounded-tile border border-border bg-background px-3 text-[13px] sm:max-w-[200px]" />
              )}
              <div className="flex items-center gap-2">
                <input autoFocus value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply" aria-label="Reply" maxLength={4000}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void send() } }}
                  className="min-h-10 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-[13px]" />
                <button type="button" disabled={busy || !reply.trim()} onClick={() => void send()}
                  className="min-h-10 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background disabled:opacity-40">{busy ? 'Sending…' : 'Reply'}</button>
              </div>
            </>
          )}
          <div className="flex items-center gap-3">
            {!resolved && !replying && (
              <button type="button" onClick={() => setReplying(true)} className="min-h-9 text-[12px] font-semibold underline-offset-2 hover:underline">Reply</button>
            )}
            {onResolve && (
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onResolve(t.root.id, !resolved); setBusy(false) }}
                className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-foreground/[0.06]">
                <Check className="h-3.5 w-3.5" /> {resolved ? 'Open again' : 'Resolve'}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
