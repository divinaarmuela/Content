'use client'

import { Archive, CheckCircle2, MessageCircle, MoreHorizontal, Trash2, Undo2, UserPlus } from 'lucide-react'
import { isMarkedDone } from '@/app/lib/done-core'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { columnOf } from '../../lib/board-core'
import {
  UPLOAD_FIRST, cardActions, cardLines, handedOver, handedToWords, initialsOf, moveTargets, needsWorkFirst,
  type BoardViewCard, type BoardViewer, type CardAction,
} from '../../lib/board-view-core'
import { riskChip } from '../../lib/card-flag-core'
import { reviewWords } from '../../lib/editor-sop-core'
import { priorityChip } from '../../lib/priority-core'
import { cardTone } from '../ui/tone'

/**
 * ONE CARD ON THE EDITOR BOARD, SMALL (the owner, 22 Oct 2026: "cards here are too big i mean the columns and all";
 * "u need to revamp this whole page"). The client, the title in two lines at most, then one row of small facts —
 * who has it, when it is due, the version, anything red — and the holder's initials. The brief, the folder and every
 * file live on the card's own page, which a press opens; the face keeps only the one next step and the "…" menu.
 *
 * Presentation only: the board decides what each press does (Board.tsx), exactly as for BoardCard.
 */

/** a thin bar down the left edge says the card's state before anything is read — the full tint was too loud this small */
const EDGE: Record<string, string> = {
  amber: 'before:bg-accent-amber', blue: 'before:bg-accent-blue', green: 'before:bg-accent-green',
  red: 'before:bg-accent-red', ink: 'before:bg-foreground', paper: 'before:bg-border',
}

const pill = 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold leading-none'
const PILL = {
  muted: 'bg-foreground/[0.06] text-muted-foreground',
  amber: 'bg-tint-amber text-foreground',
  red: 'bg-tint-red text-foreground',
  green: 'bg-tint-green text-foreground',
  blue: 'bg-tint-blue text-foreground',
} as const
const small = 'h-7 rounded-full px-2.5 text-[12px] font-semibold disabled:opacity-60'

export function EditorBoardCard({
  card, viewer, names, managers = [], today, busy, canEdit, onOpen, onAction, onMove, onHandTo, canDelete, onDelete, onArchive, onDone,
  onAcknowledge, tour,
}: {
  card: BoardViewCard
  viewer: BoardViewer
  names: Map<string, string>
  /** the client's account managers — named on every editor card (13 Sep 2026) */
  managers?: readonly string[]
  today: string
  busy?: boolean
  canEdit: boolean
  onOpen: (card: BoardViewCard) => void
  onAction: (card: BoardViewCard, action: CardAction) => void
  onMove: (card: BoardViewCard, action: CardAction) => void
  onHandTo?: (card: BoardViewCard) => void
  canDelete?: boolean
  onDelete?: (card: BoardViewCard) => void
  onArchive?: (card: BoardViewCard) => void
  /** MARK DONE, OR NOT (done-core, 30 Oct 2026) — an account manager, an editor or a super admin, at any stage */
  onDone?: (card: BoardViewCard, done: boolean) => void
  onAcknowledge?: (card: BoardViewCard) => void
  tour?: boolean
}) {
  const lines = cardLines(card, { names, today, viewerId: viewer.id })
  const tone = cardTone({ status: card.status, due: card.due_date, changesRequested: card.status === 'client_changes_requested', today })
  const risk = card.status === 'scheduled' || card.status === 'published' ? null : riskChip(card.risk ?? null)
  const askAck = !!onAcknowledge && card.owner_id === viewer.id && card.acknowledged === false && columnOf(card.status) === 'draft'
  const review = reviewWords(card.status, (card as { reviewer_name?: string | null }).reviewer_name ?? null)
  const handed = handedOver(card as never) ? handedToWords(card as never, names) : null
  const priority = priorityChip(card)
  const { primary, more: allMore } = cardActions(card, viewer)
  // a video at the quality check passes to colour grade OR straight to the client — both on the face (20 Oct 2026)
  const skipGrade = primary?.kind === 'transition' && primary.to === 'colour_grade'
    ? allMore.find(a => a.kind === 'transition' && a.to === 'client_review') ?? null
    : null
  const more = skipGrade ? allMore.filter(a => a !== skipGrade) : allMore
  const targets = moveTargets(card, viewer)
  // the maker's submit lives behind the quality checklist on the card's page (the Video Editors SOP §4)
  const faceOpensCard = primary?.kind === 'transition' && (primary.to === 'quality_check' || primary.to === 'internal_review' || primary.to === 'revision_complete')
  const blocked = !!primary && !faceOpensCard && primary.kind === 'transition' && (primary.to === 'quality_check' || primary.to === 'internal_review') && needsWorkFirst(card)
  const settled = card.status === 'scheduled' || card.status === 'published'
  const mayDelete = Boolean(canDelete && onDelete)
  const menuMore = primary ? more : more.slice(1)
  const hasMenu = menuMore.length > 0 || targets.length > 0 || (canEdit && !!onHandTo && !settled) || mayDelete || !!onArchive || !!onDone
  const holder = card.owner_id ? (names.get(card.owner_id) ?? lines.assignee) : null

  return (
    <div
      data-tone={tone ?? 'surface'}
      data-editor-card
      className={cn(
        'group relative flex flex-col gap-1.5 overflow-hidden rounded-[10px] border border-border bg-surface py-2 pl-3 pr-2 text-foreground transition-shadow hover:shadow-[0_2px_10px_rgba(11,11,11,0.08)]',
        tone && "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        tone && EDGE[tone],
      )}
    >
      {/* the whole card opens it — the buttons sit above this */}
      <button type="button" aria-label={`${lines.title} — ${lines.client}`} onClick={() => onOpen(card)}
        className="absolute inset-0 rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">{lines.client}</span>
        {lines.due && <span className={cn(pill, lines.dueNow ? PILL.amber : PILL.muted)}>{lines.due}</span>}
      </div>
      <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]" title={lines.title}>{lines.title}</p>

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {handed ? <span className={cn(pill, PILL.green)}>{handed}</span> : review && <span className={cn(pill, PILL.muted)}>{review}</span>}
        <span className={cn(pill, PILL.muted)}>{lines.version.replace(/^version /i, 'V')}</span>
        {priority && <span className={cn(pill, PILL[priority.tone])}>{priority.label}</span>}
        {risk && <span className={cn(pill, PILL.red)}>{risk}</span>}
        {card.my_open_task === true && <span className={cn(pill, PILL.amber)}><MessageCircle className="h-3 w-3" aria-hidden />New for you</span>}
        {holder && (
          <span title={`${holder}${managers.length ? ` · AM: ${managers.join(', ')}` : ''}`}
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-[10px] font-bold">
            {lines.assignee === 'You' ? 'You' : initialsOf(holder)}
          </span>
        )}
      </div>
      {/* who to ask (13 Sep 2026: "make sure on each task card of editor … the AM name is there") — one quiet line */}
      <p className="truncate text-[11px] text-muted-foreground">AM: {managers.length > 0 ? managers.join(', ') : 'none yet'}</p>
      {lines.changeNote && <p className="line-clamp-2 text-[12px] font-medium">Change: {lines.changeNote}</p>}

      {(askAck || primary || skipGrade || (!primary && more.length > 0) || hasMenu) && (
        <div className="relative z-10 flex flex-wrap items-center gap-1">
          {askAck && (
            <button type="button" disabled={busy} onClick={() => onAcknowledge!(card)} className={cn(small, 'border border-border bg-surface hover:bg-muted')}>
              I am on it
            </button>
          )}
          {primary && (
            <button type="button" disabled={busy || blocked} data-tour={tour ? 'board-card-action' : undefined}
              title={blocked ? UPLOAD_FIRST : undefined}
              onClick={() => { if (faceOpensCard) onOpen(card); else if (!blocked) onAction(card, primary) }}
              className={cn(small, 'max-w-full truncate bg-foreground text-background hover:bg-foreground/90')}>
              {busy ? 'Saving…' : faceOpensCard ? (needsWorkFirst(card) ? UPLOAD_FIRST : 'Check & submit') : blocked ? UPLOAD_FIRST : primary.label}
            </button>
          )}
          {skipGrade && (
            <button type="button" disabled={busy} onClick={() => onAction(card, skipGrade)}
              className={cn(small, 'max-w-full truncate border border-border bg-surface hover:bg-muted')}>
              {busy ? 'Saving…' : skipGrade.label}
            </button>
          )}
          {!primary && more.length > 0 && (
            <button type="button" disabled={busy} data-tour={tour ? 'board-card-action' : undefined} onClick={() => onAction(card, more[0])}
              className={cn(small, 'max-w-full truncate border border-border bg-surface hover:bg-muted')}>
              {busy ? 'Saving…' : more[0].label}
            </button>
          )}
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="More for this card" disabled={busy} data-tour={tour ? 'board-card-action' : undefined}
                  className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {menuMore.map(a => (
                  <DropdownMenuItem key={`${a.kind}-${a.to}`} onClick={() => onAction(card, a)}>{a.label}</DropdownMenuItem>
                ))}
                {targets.length > 0 && (
                  <>
                    {menuMore.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">Move</DropdownMenuLabel>
                    {targets.map(t => <DropdownMenuItem key={t.column} onClick={() => onMove(card, t.action)}>{t.label}</DropdownMenuItem>)}
                  </>
                )}
                {canEdit && onHandTo && !settled && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onHandTo(card)}><UserPlus className="h-4 w-4" aria-hidden /> Hand to…</DropdownMenuItem>
                  </>
                )}
                {onDone && (
                  <>
                    <DropdownMenuSeparator />
                    {isMarkedDone(card as never)
                      ? <DropdownMenuItem onClick={() => onDone(card, false)}><Undo2 className="h-4 w-4" aria-hidden /> Not done — back where it was</DropdownMenuItem>
                      : <DropdownMenuItem onClick={() => onDone(card, true)}><CheckCircle2 className="h-4 w-4" aria-hidden /> Mark done</DropdownMenuItem>}
                  </>
                )}
                {onArchive && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onArchive(card)}><Archive className="h-4 w-4" aria-hidden /> Archive</DropdownMenuItem>
                  </>
                )}
                {mayDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-accent-red-deep focus:text-accent-red-deep" onClick={() => onDelete!(card)}>
                      <Trash2 className="h-4 w-4" aria-hidden /> Delete this card
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  )
}
