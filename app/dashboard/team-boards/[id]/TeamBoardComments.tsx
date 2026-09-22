'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTable } from '@/lib/db-client'
import type { TeamBoardComment, TeamUser } from '@/lib/db-types'
import { CanvasCommentsProvider } from '../../../components/canvas/CanvasComments'
import CardCommentPanel, { type CardComment } from '../../../components/canvas/CardCommentPanel'
import type { CanvasCard } from '../../../lib/batch-brief-core'
import { commentsOnCard, countByCard, findCanvasCard } from '../../../lib/canvas-comments-core'
import { tagNameOf } from '../../../lib/mention-core'

/**
 * THE TEAM'S SIDE OF A BOARD CARD'S THREAD (the owner, 22 Sep 2026: "make
 * sure in the boards internal comments is possible too, like tagging").
 *
 * Wraps the board's canvas the way BriefBoardComments wraps a shoot's:
 * every card wears a bubble with its comment count, and picking one opens
 * that card's thread beside the board (under it on a phone) — who said it,
 * when, and a box to reply where "@" offers the team. The rows are read
 * LIVE from `team_board_comments`, so a colleague's note, or the client's
 * from their portal page, appears without a refresh. `?card=` in the
 * address opens straight onto that card — the link a tag's email carries.
 */
export default function TeamBoardComments({ boardId, cards, team, children, className }: {
  boardId: string
  cards: CanvasCard[]
  /** every team_users row the page already reads live — authors and the people "@" can reach */
  team: readonly TeamUser[]
  children: React.ReactNode
  className?: string
}) {
  const where = useMemo(() => (r: TeamBoardComment) => r.board_id === boardId, [boardId])
  const orderBy = useMemo<[keyof TeamBoardComment & string, 'asc' | 'desc'][]>(() => [['created_at', 'asc']], [])
  const { rows } = useTable<TeamBoardComment>('team_board_comments', { where, orderBy })
  const [open, setOpen] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('card')
      if (id) setOpen(id)
    } catch { /* fine */ }
  }, [])

  const byId = useMemo(() => new Map(team.map(u => [u.id, u])), [team])
  const comments = useMemo<(CardComment & { card_id?: string | null })[]>(() => rows.map(r => {
    const author = r.author_id ? byId.get(r.author_id) : null
    const fromClient = author?.role === 'client'
    return {
      id: r.id,
      created_at: r.created_at,
      body: r.body,
      author_name: fromClient ? String(author?.name ?? 'Client').replace(/ \(client portal\)$/, '') : (author ? tagNameOf(author) : 'Team'),
      from_team: !fromClient,
      card_id: r.card_id ?? null,
    }
  }), [rows, byId])
  const members = useMemo(() => team
    .filter(u => u.role !== 'client' && u.active_status !== false)
    .map(u => ({ id: u.id, name: tagNameOf(u), email: String(u.email ?? '') })), [team])
  const counts = useMemo(() => countByCard(comments), [comments])
  const openCard = useMemo(() => findCanvasCard(cards, open), [cards, open])

  const openThread = useCallback((cardId: string) => {
    setOpen(cardId)
    window.setTimeout(() => {
      if (window.matchMedia('(min-width: 1024px)').matches) return
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }, [])

  const send = async (body: string, mentionIds?: string[]): Promise<boolean> => {
    if (!openCard) return false
    const res = await fetch(`/api/production/team-boards/${boardId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, card_id: openCard.id, ...(mentionIds?.length ? { mention_ids: mentionIds } : {}) }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => null))?.error ?? 'Could not send')
      return false
    }
    toast.success(mentionIds?.length ? 'Posted — the people you tagged are told' : 'Posted on this card')
    return true
  }

  const panel = openCard ? (
    <CardCommentPanel
      card={openCard}
      comments={commentsOnCard(openCard.id, comments)}
      onSend={send}
      onClose={() => setOpen(null)}
      viewer="team"
      members={members}
      className={fullscreen ? '' : 'lg:sticky lg:top-4'}
    />
  ) : null
  const ctx = useMemo(
    () => ({ counts, open: openThread, openCardId: open, panel: fullscreen ? panel : null, onFullscreen: setFullscreen }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counts, openThread, open, fullscreen, comments, members],
  )

  return (
    <CanvasCommentsProvider value={ctx}>
      <div className={cn('grid gap-3', openCard && !fullscreen && 'lg:grid-cols-[minmax(0,1fr)_340px]', className)}>
        <div className="min-w-0">{children}</div>
        {openCard && !fullscreen && (
          <div ref={panelRef} className="min-w-0">
            {panel}
          </div>
        )}
      </div>
    </CanvasCommentsProvider>
  )
}
