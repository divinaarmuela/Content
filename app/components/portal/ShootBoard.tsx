'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import BriefCanvas from '../../dashboard/production/shoots/[id]/BriefCanvas'
import { CanvasCommentsProvider } from '../canvas/CanvasComments'
import { PortalTokenProvider } from '../../lib/instagram-video-client'
import CardCommentPanel from '../canvas/CardCommentPanel'
import type { CanvasCard } from '../../lib/batch-brief-core'
import type { PortalCardComment } from '../../lib/portal-core'
import { commentsOnCard, countByCard, findCanvasCard } from '../../lib/canvas-comments-core'
import { amPhrase } from '../../lib/portal-words'

export type ShootBoardSurface =
  | { token: string }
  | { loggedIn: true; onChanged: () => void }

const NAME_KEY = 'mdm-portal-name'

/**
 * THE PLANNING BOARD, OPEN, ON THE CLIENT'S PORTAL.
 *
 * The very same canvas the team draws on — read-only (`canEdit={false}`, an
 * `onOp` that always refuses), with its board tiles, breadcrumbs and
 * autoplay — shown open under the shoot's card, by the owner's rule. No
 * toggle, no "show the board" link.
 *
 * And the client can talk about any card on it: a tap on a card opens that
 * card's thread beside the board (under it on a phone), with who said what
 * and when, and a box to add to it — signed with their name, remembered on
 * the device. The comment is a normal shoot comment carrying the card's id,
 * so the team sees it on the same card on their shoot page, and their reply
 * lands back here. A board tile still opens the board inside it; its bubble
 * opens its thread.
 *
 * The canvas is another agent's file; this reaches it through one context
 * (the badge on every card) and one event listener on the wrapper around it
 * — never through its props or its markup.
 */
export default function ShootBoard({
  shootId, boardName, cards, comments, surface, clientName, amName, initialCardId, fullHref, className,
}: {
  shootId: string
  boardName: string | null
  cards: CanvasCard[]
  /** the shoot's whole thread; the ones with a card_id are pinned to cards */
  comments: PortalCardComment[]
  surface: ShootBoardSurface
  clientName: string
  amName: string | null
  /** open on this card's thread (from ?card= in a notification link) */
  initialCardId?: string | null
  /** the shoot's own page, for the full-screen view — omitted when already there */
  fullHref?: string | null
  className?: string
}) {
  const router = useRouter()
  const token = 'token' in surface ? surface.token : null
  const [open, setOpen] = useState<string | null>(initialCardId ?? null)
  const [rows, setRows] = useState(comments)
  useEffect(() => setRows(comments), [comments])
  const [name, setName] = useState('')
  useEffect(() => {
    try { setName(localStorage.getItem(NAME_KEY) ?? '') } catch { /* private mode */ }
  }, [])

  const counts = useMemo(() => countByCard(rows), [rows])
  const openCard = useMemo(() => findCanvasCard(cards, open), [cards, open])
  const panelRef = useRef<HTMLDivElement>(null)

  const openThread = useCallback((cardId: string) => {
    setOpen(cardId)
    // on a phone the panel is below the board — bring it up to the thumb
    window.setTimeout(() => {
      if (window.matchMedia('(min-width: 1024px)').matches) return
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }, [])

  // A tap on a card opens its thread. Listened for in the capture phase on
  // the wrapper, so the canvas's own click (which would open its read-only
  // sheet) never fires for it. Taps on the card's own controls — play, sound,
  // a link, the comment bubble — and on a board tile (which opens the board)
  // pass through untouched.
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || t.closest('button, a, input, textarea, [data-comment-badge]')) return
      const host = t.closest<HTMLElement>('[data-cid]')
      const id = host?.dataset.cid
      if (!id) return
      const card = findCanvasCard(cards, id)
      if (!card || card.kind === 'board') return
      e.stopPropagation()
      e.preventDefault()
      openThread(id)
    }
    el.addEventListener('click', onClick, true)
    return () => el.removeEventListener('click', onClick, true)
  }, [cards, openThread])

  const refresh = () => {
    router.refresh()
    if ('loggedIn' in surface) surface.onChanged()
  }

  const send = async (body: string): Promise<boolean> => {
    if (!openCard) return false
    const who = name.trim().slice(0, 60)
    try { localStorage.setItem(NAME_KEY, who) } catch { /* fine */ }
    try {
      const res = token
        ? await fetch('/api/portal/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, kind: 'shoot', id: shootId, card_id: openCard.id, body, author_name: who }),
          })
        : await fetch(`/api/production/batches/${shootId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body, card_id: openCard.id }),
          })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not send — try again')
      // shown at once, in the client's own words; the reload replaces it
      // with the row the server wrote
      setRows(r => [...r, {
        id: `local-${Date.now()}`, created_at: new Date().toISOString(),
        body: who ? `${body}\n— ${who}` : body,
        author_name: clientName, from_team: false, card_id: openCard.id,
      }])
      toast.success(`Sent to ${amPhrase(amName)}.`)
      refresh()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send — try again')
      return false
    }
  }

  const ctx = useMemo(() => ({ counts, open: openThread, openCardId: open }), [counts, openThread, open])

  return (
    <section className={cn('flex flex-col gap-2', className)} data-shoot-board={shootId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[13px] font-semibold">{boardName || 'The planning board'}</p>
        <p className="text-[12px] text-muted-foreground">Tap any card to comment on it.</p>
        {fullHref && (
          <Link href={fullHref} className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline">
            <Maximize2 className="h-3.5 w-3.5" /> Open full screen
          </Link>
        )}
      </div>
      <CanvasCommentsProvider value={ctx}>
        <div className={cn('grid gap-3', openCard && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
          {/* the canvas reads `.dark` from <html>, where PortalShell puts the
              choice, so it follows the page */}
          <div ref={wrapRef} className="min-w-0 overflow-hidden rounded-inner border border-border">
            <PortalTokenProvider value={token}>
              <BriefCanvas cards={cards} references={[]} canEdit={false} clientName={clientName} onOp={async () => false} />
            </PortalTokenProvider>
          </div>
          {openCard && (
            <div ref={panelRef} className="min-w-0">
              <CardCommentPanel
                card={openCard}
                comments={commentsOnCard(openCard.id, rows)}
                onSend={send}
                onClose={() => setOpen(null)}
                name={token ? { value: name, onChange: setName } : undefined}
                viewer="client"
                className="lg:sticky lg:top-16"
              />
            </div>
          )}
        </div>
      </CanvasCommentsProvider>
    </section>
  )
}
