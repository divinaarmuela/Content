'use client'

import { ExternalLink, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { statusesIn, columnOf } from '../../lib/board-core'
import {
  cardActions, cardLines, initialsOf, moveTargets,
  type BoardViewCard, type BoardViewer, type CardAction,
} from '../../lib/board-view-core'
import Chip from '../ui/Chip'
import WorkCard from '../ui/WorkCard'
import { cardTone, kindTone } from '../ui/tone'

/**
 * ONE CARD ON THE BOARD.
 *
 * Client, title, kind, the link with its label, who holds it, when it is
 * due — one line each, no paragraphs. One control, labelled with what it
 * does; anything else sits behind "More", including the keyboard's way of
 * moving the card between columns. The whole card opens the item page.
 *
 * Presentation only: the board decides what each press does.
 */
export function BoardCard({
  card, viewer, names, today, busy, canEdit, onAction, onMove, onLink, onKind,
}: {
  card: BoardViewCard & { work_kinds?: { name: string; slug?: string; color?: string } | null }
  viewer: BoardViewer
  names: Map<string, string>
  today: string
  /** something is being saved on this card — the buttons wait */
  busy?: boolean
  /** may this person set the link or the kind — the holder or a manager */
  canEdit: boolean
  onAction: (card: BoardViewCard, action: CardAction) => void
  onMove: (card: BoardViewCard, action: CardAction) => void
  onLink: (card: BoardViewCard) => void
  onKind: (card: BoardViewCard) => void
}) {
  const lines = cardLines(card, { names, today, viewerId: viewer.id })
  const { primary, more } = cardActions(card, viewer)
  const targets = moveTargets(card, viewer)
  const column = columnOf(card.status)
  // the column already names the stage; the chip earns its place only where
  // one column holds more than one stage
  const showStage = statusesIn(column).length > 1
  const tone = cardTone({
    status: card.status,
    due: card.due_date,
    changesRequested: card.status === 'client_changes_requested',
    today,
  })
  const people = card.owner_id
    ? [{ id: card.owner_id, initials: initialsOf(names.get(card.owner_id) ?? (lines.assignee === 'You' ? 'You' : '')), name: names.get(card.owner_id) ?? lines.assignee }]
    : []
  const hasMenu = more.length > 0 || targets.length > 0 || canEdit

  return (
    <WorkCard
      href={`/dashboard/production/${card.id}`}
      client={lines.client}
      title={lines.title}
      tone={tone}
      people={people}
      chips={<>
        {lines.kind && <Chip tone={kindTone(card.work_kinds?.color)}>{lines.kind}</Chip>}
        {showStage && <Chip tone={tone ? 'surface' : 'muted'}>{lines.stage}</Chip>}
        {lines.due && <Chip tone={lines.dueNow ? (tone === 'amber' ? 'surface' : 'amber') : 'muted'}>{lines.due}</Chip>}
      </>}
      note={<>
        <span>{lines.assignee} · {lines.version}</span>
        {lines.changeNote && (
          <span className="mt-1 block font-medium text-foreground">Change: {lines.changeNote}</span>
        )}
      </>}
      actions={<>
        {lines.link ? (
          <a
            href={lines.link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground hover:bg-surface/80 [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream"
          >
            {lines.link.label} <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          </a>
        ) : canEdit ? (
          <Button variant="outline" disabled={busy}
            onClick={e => { e.preventDefault(); onLink(card) }}
            className="h-11 rounded-full border-dashed border-border bg-surface px-3.5 text-[13px] font-semibold [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            Add link
          </Button>
        ) : null}

        {primary && (
          <Button disabled={busy}
            onClick={e => { e.preventDefault(); onAction(card, primary) }}
            className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90 [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink">
            {busy ? 'Saving…' : primary.label}
          </Button>
        )}
        {!primary && more.length > 0 && (
          <Button variant="outline" disabled={busy}
            onClick={e => { e.preventDefault(); onAction(card, more[0]) }}
            className="h-11 rounded-full border-border bg-surface px-4 text-[13px] font-semibold [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            {busy ? 'Saving…' : more[0].label}
          </Button>
        )}

        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More for this card" disabled={busy}
                className="h-11 w-11 rounded-full border-border bg-surface [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {(primary ? more : more.slice(1)).map(a => (
                <DropdownMenuItem key={`${a.kind}-${a.to}`} className="min-h-11"
                  onClick={() => onAction(card, a)}>
                  {a.label}
                </DropdownMenuItem>
              ))}
              {targets.length > 0 && (
                <>
                  {(primary ? more : more.slice(1)).length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
                    Move
                  </DropdownMenuLabel>
                  {targets.map(t => (
                    <DropdownMenuItem key={t.column} className="min-h-11" onClick={() => onMove(card, t.action)}>
                      {t.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11" onClick={() => onLink(card)}>
                    {lines.link ? 'Replace the link' : 'Add a link'}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="min-h-11" onClick={() => onKind(card)}>
                    Change the kind of work
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </>}
    />
  )
}
