'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Calendar, Check, ChevronDown, ExternalLink, FileDown, MapPin, MessageCircle, Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Lane from '../../dashboard/ui/Lane'
import Chip from '../../dashboard/ui/Chip'
import type { PortalCard } from '../../lib/portal-data'
import {
  EMPTY_BOARD_LINE, PORTAL_COLUMNS, actedLine, planPdfHref, swipeOffset, swipeToApprove,
  waitingOnYou, type PortalColumnKey,
} from '../../lib/portal-core'
import { pickPortalTheme } from '../../lib/portal-theme'
import {
  APPROVED_TOAST, PLAN_APPROVED_TOAST, amPhrase, changesSentToast,
} from '../../lib/portal-words'
import { PostMetricsRow } from './PortalSections'

/**
 * THE CLIENT'S BOARD.
 *
 * Their work and their shoots as cards in the five columns, named for what
 * they mean to a client. Built from the restyle's Lane, Chip and card
 * classes so it looks like the agency's own dashboard, and dressed in the
 * client's brand colour and logo where the client record has them.
 *
 * Read-only except for the card that is with them: that one carries the link
 * to where the work lives, one tap to approve (a swipe from the right on a
 * phone), and the smaller "Ask for a change" which opens one box. Comments
 * are pinned to the card they are about.
 *
 * Two surfaces, one board: the share link acts with its token through
 * /api/portal/*; the signed-in client acts through the item API. Every action
 * is a route that already existed — nothing here invents a second path.
 */

type Surface =
  | { token: string }
  | { loggedIn: true; onChanged: () => void }

export default function PortalBoard({ cards, clientName, amName, brand, logoUrl, surface }: {
  cards: PortalCard[]
  clientName: string
  amName: string | null
  /** the client's brand profile in the scan's shape — the theme is derived from it */
  brand: Record<string, unknown> | null
  logoUrl: string | null
  surface: Surface
}) {
  const theme = pickPortalTheme(brand as Parameters<typeof pickPortalTheme>[0])
  const accent = theme.branded ? { background: theme.accent, color: theme.accentInk } : undefined
  const waiting = waitingOnYou(cards)
  const scroller = useRef<HTMLDivElement>(null)
  const reviewLane = useRef<HTMLDivElement>(null)

  // on a phone the board scrolls sideways; it opens on the column that has
  // something waiting on them, so the first thing they see is their move
  useEffect(() => {
    const el = scroller.current
    const lane = reviewLane.current
    if (!el || !lane || waiting === 0) return
    if (window.matchMedia('(min-width: 1024px)').matches) return
    el.scrollLeft = lane.offsetLeft - el.offsetLeft
  }, [waiting])

  const byColumn = (key: PortalColumnKey) => cards.filter(c => c.column === key)

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={clientName} className="h-9 w-auto max-w-[160px] object-contain" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] sm:text-[26px]">Your board</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {waiting > 0
              ? `${waiting} ${waiting === 1 ? 'thing is' : 'things are'} waiting on you — open it, then approve or ask for a change.`
              : 'Everything we are making for you, left to right, from first cut to done.'}
          </p>
        </div>
        {waiting > 0 && <Chip tone="amber">{waiting} waiting on you</Chip>}
      </header>

      {cards.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-14 text-center">
          <p className="mx-auto max-w-md text-[15px] text-muted-foreground">{EMPTY_BOARD_LINE}</p>
        </div>
      ) : (
        <div
          ref={scroller}
          className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3 sm:-mx-10 sm:px-10 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0"
        >
          {PORTAL_COLUMNS.map(col => {
            const list = byColumn(col.key)
            return (
              // the ref rides on a wrapper: Lane is a plain <section> and the
              // scroll above needs to find the column that matters
              <div
                key={col.key}
                ref={col.key === 'your_review' ? reviewLane : undefined}
                className="flex w-[84vw] shrink-0 snap-start sm:w-[340px] lg:w-auto"
              >
                <Lane
                  title={col.title}
                  count={list.length}
                  hint={<span className="hidden truncate text-[12px] text-muted-foreground xl:inline">· {col.hint}</span>}
                >
                  {list.length === 0 ? (
                    <p className="rounded-inner border border-dashed border-border px-3.5 py-5 text-center text-[13px] text-muted-foreground">
                      Nothing here right now.
                    </p>
                  ) : list.map(card => (
                    <PortalCardView key={`${card.kind}-${card.id}`} card={card} amName={amName} accent={accent} surface={surface} />
                  ))}
                </Lane>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[13px] text-muted-foreground">
        Questions? {amPhrase(amName).replace(/^\w/, c => c.toUpperCase())} is one message away.
      </p>
    </section>
  )
}

const TONE: Record<NonNullable<PortalCard['tone']>, string> = {
  amber: 'bg-tint-amber',
  green: 'bg-tint-green',
  blue: 'bg-tint-blue',
  ink: 'bg-ink text-cream',
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** One card, on its own — the board uses it, and so does a card's own page. */
export function PortalCardView({ card, amName, accent, surface }: {
  card: PortalCard
  amName: string | null
  /** the client's brand colour on the Approve button, when they have one */
  accent?: React.CSSProperties
  surface: Surface
}) {
  const router = useRouter()
  const token = 'token' in surface ? surface.token : null
  const ink = card.tone === 'ink'
  const muted = ink ? 'text-cream/70' : 'text-muted-foreground'

  // ── what the client has done to this card since the page loaded ──
  // The server has taken the decision but the page still holds the data it
  // was rendered with: a pressed button must never look like nothing happened
  const [acted, setActed] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'request_changes' | 'comment' | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [comments, setComments] = useState(card.comments)
  useEffect(() => setComments(card.comments), [card.comments])

  const canApprove = card.actions.approve && !acted && !!card.act_item_id
  const canAsk = card.actions.askForChange && !acted && !!card.act_item_id
  const canComment = card.actions.comment && !!card.comment_target

  const refresh = () => {
    router.refresh()
    if ('loggedIn' in surface) surface.onChanged()
  }

  const act = async (action: 'approve' | 'request_changes') => {
    if (!card.act_item_id || busy) return
    const text = note.trim()
    if (action === 'request_changes' && !text) {
      toast.error('Tell us what to change — a few words is enough')
      return
    }
    setBusy(action)
    try {
      if (token) {
        const res = await fetch('/api/portal/act', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, item_id: card.act_item_id, action, comment: action === 'request_changes' ? text : '' }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Something went wrong')
      } else {
        const res = await fetch(`/api/production/items/${card.act_item_id}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: action === 'approve' ? 'approved_for_scheduling' : 'client_changes_requested',
            ...(action === 'request_changes' ? { note: text } : {}),
          }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Something went wrong')
      }
      toast.success(action === 'approve'
        ? (card.kind === 'shoot' ? PLAN_APPROVED_TOAST : APPROVED_TOAST)
        : changesSentToast(amName))
      setActed(actedLine(card.kind, action))
      setAsking(false)
      setNote('')
      refresh()
    } catch (e) {
      if (e instanceof TypeError) {
        toast.message('Connection hiccup — refreshing to check…')
        refresh()
      } else {
        toast.error(e instanceof Error ? e.message : 'Something went wrong')
      }
    } finally {
      setBusy(null)
    }
  }

  const sendComment = async () => {
    const text = draft.trim()
    const target = card.comment_target
    if (!text || busy || !target) return
    setBusy('comment')
    try {
      if (token) {
        const res = await fetch('/api/portal/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, kind: target.kind, id: target.id, body: text }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not send — try again')
      } else {
        // the signed-in client has no shoot thread route of their own; a note
        // on a shoot goes on its brief, which is the thread the team reads too
        const itemId = target.kind === 'item' ? target.id : card.shoot?.brief_item_id
        if (!itemId) throw new Error('Comments on this one are not set up yet — ask your account manager.')
        const res = await fetch(`/api/production/items/${itemId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not send — try again')
      }
      // shown at once, in the client's own name; the reload replaces it with
      // the row the server wrote
      setComments(c => [...c, {
        id: `local-${Date.now()}`, created_at: new Date().toISOString(), body: text,
        author_name: 'You', from_team: false,
      }])
      setDraft('')
      toast.success(`Sent to ${amPhrase(amName)}.`)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send — try again')
    } finally {
      setBusy(null)
    }
  }

  // ── swipe from the right approves (phones) ──
  const start = useRef<{ x: number; y: number } | null>(null)
  const [dx, setDx] = useState(0)
  const onTouchStart = (e: React.TouchEvent) => {
    if (!canApprove) return
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return
    const mx = e.touches[0].clientX - start.current.x
    const my = e.touches[0].clientY - start.current.y
    // a mostly vertical drag is the board scrolling — let go of the card
    if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 12) { start.current = null; setDx(0); return }
    setDx(swipeOffset(mx))
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!start.current) return
    const mx = e.changedTouches[0].clientX - start.current.x
    const my = e.changedTouches[0].clientY - start.current.y
    start.current = null
    setDx(0)
    if (swipeToApprove(mx, my)) void act('approve')
  }

  const href = token
    ? (card.kind === 'shoot'
        ? (card.shoot?.shared ? `/portal/${token}/shoot/${card.id}` : null)
        : (card.comment_target ? `/portal/${token}/item/${card.id}` : null))
    : null
  const pdf = card.pdf ? planPdfHref(token, card.id) : null
  const line = acted ?? card.line

  return (
    <div className="relative">
      {/* the green underneath — revealed as the card slides left, so the
          swipe says what it is about to do before the finger lets go */}
      {canApprove && (
        <div aria-hidden className="absolute inset-0 flex items-center justify-end rounded-inner bg-tint-green pr-5 text-[14px] font-semibold text-foreground">
          <Check className="mr-1.5 h-4 w-4" /> Approve
        </div>
      )}
      <article
        data-tone={card.tone ?? 'surface'}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { start.current = null; setDx(0) }}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
        className={cn(
          'relative flex flex-col gap-2.5 rounded-inner p-3.5 transition-transform',
          card.tone ? TONE[card.tone] : 'border border-border bg-surface',
          ink ? '' : 'text-foreground',
          dx ? 'duration-0' : 'duration-200',
        )}
      >
        {card.preview_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.preview_url} alt="" loading="lazy" className="h-[92px] w-full rounded-tile object-cover" />
        )}
        <div className="flex items-center gap-2">
          {card.word && (
            <span className={cn('text-[12px] font-semibold uppercase tracking-[0.02em]', ink ? 'text-cream/60' : 'text-muted-foreground')}>
              {card.word}
            </span>
          )}
          {card.shoot?.date_label && (
            <span className={cn('ml-auto flex items-center gap-1 text-[12px]', muted)}>
              <Calendar className="h-3.5 w-3.5" /> {card.shoot.date_label}
            </span>
          )}
        </div>
        {href ? (
          <Link href={href} className="text-[15px] font-semibold leading-[1.25] underline-offset-4 hover:underline">{card.title}</Link>
        ) : (
          <span className="text-[15px] font-semibold leading-[1.25]">{card.title}</span>
        )}
        <p className={cn('text-[13px]', muted)}>{line}</p>
        {card.shoot?.location && (
          <p className={cn('flex items-center gap-1.5 text-[13px]', muted)}>
            <MapPin className="h-3.5 w-3.5 shrink-0" /> {card.shoot.location}
          </p>
        )}
        {card.status === 'published' && card.metrics && (
          <div className={ink ? 'text-cream' : ''}><PostMetricsRow item={{ metrics: card.metrics } as never} /></div>
        )}

        {/* where the work lives */}
        {(card.link || card.live_url || pdf) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {card.link && (
              <a href={card.link.url} target="_blank" rel="noreferrer noopener"
                className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> {card.link.label}
              </a>
            )}
            {card.live_url && (
              <a href={card.live_url} target="_blank" rel="noreferrer noopener"
                className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> See the live post
              </a>
            )}
            {pdf && (
              <a href={pdf}
                className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline">
                <FileDown className="h-3.5 w-3.5" /> The plan (PDF)
              </a>
            )}
          </div>
        )}

        {/* the plan, on the same card */}
        {card.shoot?.shared && (card.shoot.concept || card.shoot.planned_deliverables.length > 0 || card.shoot.shot_list.length > 0) && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setPlanOpen(v => !v)}
              className={cn('inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] font-semibold', muted)}>
              <ChevronDown className={cn('h-4 w-4 transition-transform', planOpen && 'rotate-180')} />
              {planOpen ? 'Hide the plan' : 'See the plan'}
            </button>
            {planOpen && (
              <div className={cn('flex flex-col gap-2.5 rounded-tile p-3 text-[13px]', ink ? 'bg-cream/10' : 'bg-foreground/[0.04]')}>
                {card.shoot.concept && <p className="whitespace-pre-wrap leading-relaxed">{card.shoot.concept}</p>}
                {card.shoot.planned_deliverables.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {card.shoot.planned_deliverables.map(d => (
                      <Chip key={d.id} tone={ink ? 'muted' : 'surface'}>{d.title}</Chip>
                    ))}
                  </div>
                )}
                {card.shoot.shot_list.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {card.shoot.shot_list.map(r => (
                      <li key={r.id} className="flex items-start gap-2">
                        <span className={cn('mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border', ink ? 'border-cream/50' : 'border-foreground/40')}>
                          {r.done && <Check className="h-3 w-3" />}
                        </span>
                        <span className={r.done ? 'opacity-60' : ''}>{r.text}{r.qty ? <span className="opacity-50"> ×{r.qty}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {href && card.shoot.board_cards > 0 && (
                  <Link href={href} className="inline-flex min-h-11 items-center text-[13px] font-semibold underline-offset-4 hover:underline">
                    See the planning board · {card.shoot.board_cards} cards
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* the decision — only on the card that is with them */}
        {(canApprove || canAsk) && (
          <div className="flex flex-col gap-2 pt-1">
            {asking ? (
              <>
                <textarea
                  rows={3}
                  value={note}
                  autoFocus
                  onChange={e => setNote(e.target.value)}
                  placeholder="What should change? A few words is enough."
                  className="w-full rounded-tile border border-border bg-background p-3 text-[14px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => act('request_changes')}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50">
                    <Send className="h-4 w-4" /> {busy === 'request_changes' ? 'Sending…' : 'Send'}
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => { setAsking(false); setNote('') }}
                    className="inline-flex min-h-11 items-center px-3 text-[14px] text-muted-foreground">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {canApprove && (
                  <button type="button" disabled={busy !== null} onClick={() => act('approve')}
                    style={accent}
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-none">
                    <Check className="h-4 w-4" /> {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                )}
                {canAsk && (
                  <button type="button" disabled={busy !== null} onClick={() => setAsking(true)}
                    className="inline-flex min-h-11 items-center justify-center px-3 text-[14px] font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50">
                    Ask for a change
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* comments, pinned to this card */}
        {canComment && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setOpen(v => !v)}
              className={cn('inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] font-semibold', muted)}>
              <MessageCircle className="h-4 w-4" />
              {comments.length === 0 ? 'Leave a comment' : `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
              <div className="flex flex-col gap-2.5">
                {comments.map(c => (
                  <div key={c.id} className={cn('rounded-tile p-2.5 text-[13px]', ink ? 'bg-cream/10' : 'bg-foreground/[0.04]')}>
                    <p className={cn('flex flex-wrap items-baseline gap-x-2 text-[12px]', muted)}>
                      <span className="font-semibold">{c.author_name}</span>
                      {c.from_team && <Chip tone={ink ? 'muted' : 'ink'} className="px-1.5 py-0.5 text-[10px]">MD Media</Chip>}
                      <span suppressHydrationWarning>{when(c.created_at)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{c.body}</p>
                  </div>
                ))}
                <div className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendComment() }}
                    placeholder="Say something about this one…"
                    className="min-h-11 w-full flex-1 resize-none rounded-tile border border-border bg-background p-2.5 text-[14px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button type="button" disabled={busy !== null || !draft.trim()} onClick={() => void sendComment()}
                    aria-label="Send comment"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </article>
    </div>
  )
}
