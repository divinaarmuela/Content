'use client'

import { useState } from 'react'
import { ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'
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
 * Client, title, kind, the link with its label, what needs doing, who holds
 * it, when it is due — one line each. What needs doing is clamped to two
 * lines with a "Read all" control when there is more; the whole card OPENS
 * the card beside the board (`onOpen`) — it never navigates away, so the
 * board stays where it was. One control, labelled with what it does; anything else
 * sits behind "More", including the keyboard's way of moving the card
 * between columns. A card with no link says so — "No link yet" — to anyone
 * who cannot add one.
 *
 * Presentation only: the board decides what each press does.
 */

/** the brief fits two lines below roughly this many characters */
const BRIEF_FOLD = 110

/**
 * ONE CARD IN A FOLDED LANE — one line: the title, the client, the stage.
 *
 * A folded lane holds the stages this person does not work, so the card
 * carries no button: pressing it opens the card beside the board, where
 * every action lives. The stage chip is always on, because a folded lane
 * always holds more than one stage. Same tint as the full card, so a card
 * that needs attention is still obvious at a glance.
 */
export function CompactCard({ card, today, onOpen }: {
  card: BoardViewCard
  today: string
  onOpen: (card: BoardViewCard) => void
}) {
  const lines = cardLines(card, { today })
  const tone = cardTone({
    status: card.status,
    due: card.due_date,
    changesRequested: card.status === 'client_changes_requested',
    today,
  })
  const TINT: Record<NonNullable<typeof tone>, string> = {
    amber: 'bg-tint-amber', blue: 'bg-tint-blue', green: 'bg-tint-green', red: 'bg-tint-red',
    paper: 'bg-paper', ink: 'bg-ink text-cream',
  }
  return (
    <button
      type="button"
      data-tone={tone ?? 'surface'}
      onClick={() => onOpen(card)}
      title={`${lines.title} — ${lines.client}`}
      className={`flex min-h-11 w-full items-center gap-2 rounded-inner px-3 py-2 text-left transition-shadow hover:shadow-[0_2px_12px_rgba(11,11,11,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tone ? TINT[tone] : 'border border-border bg-surface text-foreground'
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-tight">{lines.title}</span>
        <span className={`truncate text-[11px] font-semibold uppercase tracking-[0.02em] ${tone === 'ink' ? 'text-cream/60' : 'text-muted-foreground'}`}>
          {lines.client}
        </span>
      </span>
      <Chip tone={tone ? 'surface' : 'muted'} className="shrink-0">{lines.stage}</Chip>
    </button>
  )
}
export function BoardCard({
  card, viewer, names, today, busy, canEdit, onOpen, onAction, onMove, onLink, onKind, canDelete, onDelete,
}: {
  card: BoardViewCard & { work_kinds?: { name: string; slug?: string; color?: string } | null }
  viewer: BoardViewer
  names: Map<string, string>
  today: string
  /** something is being saved on this card — the buttons wait */
  busy?: boolean
  /** may this person set the link or the kind — the holder or a manager */
  canEdit: boolean
  /** a press on the card itself — the board opens it beside itself */
  onOpen: (card: BoardViewCard) => void
  onAction: (card: BoardViewCard, action: CardAction) => void
  onMove: (card: BoardViewCard, action: CardAction) => void
  onLink: (card: BoardViewCard) => void
  onKind: (card: BoardViewCard) => void
  /** may this person delete the card — a manager, matching the route */
  canDelete?: boolean
  onDelete?: (card: BoardViewCard) => void
}) {
  const lines = cardLines(card, { names, today, viewerId: viewer.id })
  const [briefOpen, setBriefOpen] = useState(false)
  const briefFolds = !!lines.brief && (lines.brief.length > BRIEF_FOLD || lines.brief.includes('\n'))
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
  const mayDelete = Boolean(canDelete && onDelete)
  const hasMenu = more.length > 0 || targets.length > 0 || canEdit || mayDelete

  return (
    <WorkCard
      onOpen={() => onOpen(card)}
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
        {lines.brief && (
          <span
            className={`mb-1 block whitespace-pre-line text-foreground [[data-tone=ink]_&]:text-cream ${briefOpen ? '' : 'line-clamp-2'}`}
            title={briefOpen ? undefined : lines.brief}
          >
            {lines.brief}
          </span>
        )}
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
        ) : (
          <span className="inline-flex min-h-11 items-center rounded-full border border-dashed border-border px-3.5 text-[13px] font-semibold text-muted-foreground [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:text-cream/70">
            No link yet
          </span>
        )}

        {briefFolds && (
          <Button variant="outline" aria-expanded={briefOpen}
            onClick={e => { e.preventDefault(); setBriefOpen(o => !o) }}
            className="h-11 rounded-full border-border bg-surface px-3.5 text-[13px] font-semibold [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            {briefOpen ? 'Less' : 'Read all'}
          </Button>
        )}

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
              {mayDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11 text-accent-red focus:text-accent-red"
                    onClick={() => onDelete!(card)}>
                    <Trash2 className="h-4 w-4" /> Delete this card
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
