'use client'

import { DELIVER_ONLY_CHIP } from '@/app/lib/deliver-only-core'
import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, MoreHorizontal, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { statusesIn, columnOf } from '../../lib/board-core'
import {
  cardActions, cardLines, initialsOf, moveTargets, postWaitingLine,
  type BoardViewCard, type BoardViewer, type CardAction, needsWorkFirst, UPLOAD_FIRST } from '../../lib/board-view-core'
import Chip from '../ui/Chip'
import WorkCard from '../ui/WorkCard'
import { cardTone, kindTone } from '../ui/tone'
import { riskChip } from '../../lib/card-flag-core'
import { footageAfterWords } from '../../lib/shoot-sop-core'
import { blockedChip, reviewWords } from '../../lib/editor-sop-core'

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
        <span className={`truncate text-[12px] font-semibold uppercase tracking-[0.02em] ${tone === 'ink' ? 'text-cream/70' : 'text-muted-foreground'}`}>
          {lines.client}
        </span>
      </span>
      <Chip tone={tone ? 'surface' : 'muted'} className="shrink-0">{lines.stage}</Chip>
    </button>
  )
}
export function BoardCard({
  card, viewer, names, today, busy, canEdit, onOpen, onAction, onMove, onLink, onKind, onHandTo, canDelete, onDelete, stats,
  statsHref, booking, tour, onAcknowledge, page,
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
  /** hand the card to somebody, with what you want them to do — the same
   *  right as any other edit: the holder or a manager */
  onHandTo?: (card: BoardViewCard) => void
  /** may this person delete the card — a manager, matching the route */
  canDelete?: boolean
  onDelete?: (card: BoardViewCard) => void
  /** in Posted: "42 interactions · +12 followers" — how the live post did */
  stats?: string | null
  /** the post's own page, when the card was posted from a composition. The
   *  stats line becomes the link to it: the numbers are what somebody wants
   *  more of, so they are where the way to more of them lives. */
  statsHref?: string | null
  /** "Booked on TikTok, Instagram · Thu 12:00 pm" — where the files are
   *  booked or went out, so a card in Ready to post or Posted says so */
  booking?: string | null
  /**
   * This is the card the walkthrough points at — the first one on the board,
   * and only that one, or the spotlight would have a dozen candidates. It
   * marks the two controls it talks about: the button that does the next
   * thing and, behind it, the dots. Both carry the SAME key, so a card whose
   * stage offers no button still has something to point at.
   */
  tour?: boolean
  /** "Acknowledge": the holder says they have seen it and are on it (the
   *  Video Editors SOP). Offered on a card that is theirs and not yet
   *  acknowledged; the page records it. */
  onAcknowledge?: (card: BoardViewCard) => void
  /** the Editor page draws the SOP's face: no kind of work, "3 of 6 finals
   *  in", who has it inside For Review, and a blocked line */
  page?: 'production' | 'editor' | 'scheduler'
}) {
  const lines = cardLines(card, { names, today, viewerId: viewer.id })
  // a risk flagged while the card was being made is over once it is booked or posted
  const risk = card.status === 'scheduled' || card.status === 'published' ? null : riskChip(card.risk ?? null)
  const askAck = !!onAcknowledge && card.owner_id === viewer.id && card.acknowledged === false
    && columnOf(card.status) === 'draft'
  const [briefOpen, setBriefOpen] = useState(false)
  const briefFolds = !!lines.brief && (lines.brief.length > BRIEF_FOLD || lines.brief.includes('\n'))
  const { primary, more } = cardActions(card, viewer)
  /** a post built from this piece is waiting on somebody — said on the card,
   *  because the bell was the only place it was ever said */
  const postWaiting = postWaitingLine(card, viewer)
  const targets = moveTargets(card, viewer)
  const column = columnOf(card.status)
  // the column already names the stage; the chip earns its place only where
  // one column holds more than one stage
  // the Editor page shows the editor's face to EVERYONE — a manager's tools
  // live on Post approval (the owner, 12 Sep 2026: "too many options")
  const editorFace = page === 'editor'
  const showStage = !editorFace && statusesIn(column).length > 1
  const review = editorFace ? reviewWords(card.status, (card as { reviewer_name?: string | null }).reviewer_name ?? null) : null
  // the maker's submit lives behind the seven-point quality check in the
  // open card (the Video Editors SOP §4); the face opens the card rather
  // than skipping the checks
  const faceOpensCard = editorFace && primary?.kind === 'transition' && (primary.to === 'quality_check' || primary.to === 'internal_review' || primary.to === 'revision_complete')
  const blockedLine = editorFace ? blockedChip(card as never) : null
  const finals = editorFace ? (card as { finals_in?: string | null }).finals_in ?? null : null
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
  const settled = card.status === 'scheduled' || card.status === 'published'
  const adhocPost = (card as { adhoc_post?: unknown }).adhoc_post === true
  const hasMenu = more.length > 0 || targets.length > 0 || canEdit || mayDelete

  return (
    <WorkCard
      onOpen={() => onOpen(card)}
      client={lines.client}
      title={lines.title}
      tone={tone}
      people={people}
      chips={<>
        {lines.kind && !editorFace && <Chip tone={kindTone(card.work_kinds?.color)}>{lines.kind}</Chip>}
        {showStage && <Chip tone={tone ? 'surface' : 'muted'}>{lines.stage}</Chip>}
        {review && <Chip tone={tone ? 'surface' : 'muted'}>{review}</Chip>}
        {finals && <Chip tone="green">{finals}</Chip>}
        {blockedLine && <Chip tone="red">{blockedLine}</Chip>}
        {lines.due && <Chip tone={lines.dueNow ? (tone === 'amber' ? 'surface' : 'amber') : 'muted'}>{lines.due}</Chip>}
        {lines.posted && <Chip tone="green">{lines.posted}</Chip>}
        {lines.delivered && <Chip tone="blue">{lines.delivered}</Chip>}
        {lines.deliverOnly && <Chip tone="muted">{DELIVER_ONLY_CHIP}</Chip>}
        {risk && <Chip tone="red">{risk}</Chip>}
      </>}
      note={<>
        {card.shoot_title && (
          <span className="mb-1 block text-muted-foreground [[data-tone=ink]_&]:text-cream/80">From the shoot: <span className="font-medium text-foreground [[data-tone=ink]_&]:text-cream">{card.shoot_title}</span>{card.shoot_date && footageAfterWords({ shoot_date: card.shoot_date }, today) ? ` · ${footageAfterWords({ shoot_date: card.shoot_date }, today)}` : ''}</span>
        )}
        {askAck && (
          <span className="mb-1 block font-medium text-foreground [[data-tone=ink]_&]:text-cream">New — press Acknowledge so the team knows you are on it.</span>
        )}
        {lines.brief && (
          <span
            className={`mb-1 block whitespace-pre-line text-foreground [[data-tone=ink]_&]:text-cream ${briefOpen ? '' : 'line-clamp-2'}`}
            title={briefOpen ? undefined : lines.brief}
          >
            {lines.brief}
          </span>
        )}
        {/* who holds it, and — beside it, never instead of it — who was
            actually asked for the next thing on it */}
        <span>{lines.assignee} · {lines.version}{lines.asked ? ` · ${lines.asked}` : ''}</span>
        {booking && (
          <span className="mt-1 block font-medium text-foreground [[data-tone=ink]_&]:text-cream">{booking}</span>
        )}
        {stats && card.status === 'published' && (
          statsHref ? (
            // above the card's own overlay, so the line is a real link rather
            // than one more place that opens the card
            <Link
              href={statsHref}
              onClick={e => e.stopPropagation()}
              className="relative z-10 mt-1 inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline [[data-tone=ink]_&]:text-cream"
            >
              {stats}
            </Link>
          ) : (
            <span className="mt-1 block font-medium text-foreground [[data-tone=ink]_&]:text-cream">{stats}</span>
          )
        )}
        {postWaiting && (
          <span className="mt-1 block font-medium text-foreground [[data-tone=ink]_&]:text-cream">{postWaiting}</span>
        )}
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
            {lines.link.label} <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            <span className="sr-only">opens in a new tab</span>
          </a>
        ) : (card as { adhoc_post?: unknown }).adhoc_post === true || editorFace ? null : canEdit ? (
          <Button variant="outline" disabled={busy}
            onClick={e => { e.preventDefault(); onLink(card) }}
            className="h-11 rounded-full border-dashed border-border bg-surface px-3.5 text-[13px] font-semibold [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            Add link
          </Button>
        ) : editorFace ? null : (
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

        {askAck && (
          <Button variant="outline" disabled={busy}
            onClick={e => { e.preventDefault(); onAcknowledge!(card) }}
            className="h-11 rounded-full border-border bg-surface px-4 text-[13px] font-semibold [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            Acknowledge
          </Button>
        )}
        {primary && faceOpensCard && (
          <Button disabled={busy} data-tour={tour ? 'board-card-action' : undefined}
            onClick={e => { e.preventDefault(); onOpen(card) }}
            className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60 [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink">
            {needsWorkFirst(card) ? UPLOAD_FIRST : 'Quality check, then submit'}
          </Button>
        )}
        {primary && !faceOpensCard && (() => {
          // an empty card cannot go for checking: say "Upload the final
          // first" on the button rather than a refusal after the press
          const blocked = primary.kind === 'transition' && (primary.to === 'quality_check' || primary.to === 'internal_review') && needsWorkFirst(card)
          return (
            <Button disabled={busy || blocked} data-tour={tour ? 'board-card-action' : undefined}
              title={blocked ? UPLOAD_FIRST : undefined}
              aria-label={blocked ? `${primary.label} — ${UPLOAD_FIRST}` : undefined}
              onClick={e => { e.preventDefault(); if (!blocked) onAction(card, primary) }}
              className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60 [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink">
              {busy ? 'Saving…' : blocked ? UPLOAD_FIRST : primary.label}
            </Button>
          )
        })()}
        {!primary && more.length > 0 && (
          <Button variant="outline" disabled={busy} data-tour={tour ? 'board-card-action' : undefined}
            onClick={e => { e.preventDefault(); onAction(card, more[0]) }}
            className="h-11 rounded-full border-border bg-surface px-4 text-[13px] font-semibold [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            {busy ? 'Saving…' : more[0].label}
          </Button>
        )}

        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More for this card" disabled={busy}
                data-tour={tour ? 'board-card-action' : undefined}
                className="h-11 w-11 rounded-full border-border bg-surface [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
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
                  {/* the link is where a shoot's work lives (a Drive or
                      Dropbox folder); an uploaded post carries its files,
                      so it has nothing to link (the owner, 11 Sep 2026) */}
                  {/* the scheduler's folder and the kind of work are the
                      manager's; an editor's face carries neither (the Video
                      Editors SOP gives an editor no such thing) */}
                  {!adhocPost && !editorFace && (
                    <DropdownMenuItem className="min-h-11" onClick={() => onLink(card)}>
                      {lines.link ? 'Change the Drive folder' : 'Drive folder to post from'}
                    </DropdownMenuItem>
                  )}
                  {/* a booked or posted card has nobody left to hand it to and
                      no kind left to change; an uploaded post's kind is "Post"
                      (the owner, 10 Sep 2026: "why is Hand to shown on a
                      posted card") */}
                  {!settled && !adhocPost && !editorFace && (
                    <DropdownMenuItem className="min-h-11" onClick={() => onKind(card)}>
                      Change the kind of work
                    </DropdownMenuItem>
                  )}
                  {onHandTo && !settled && (
                    <DropdownMenuItem className="min-h-11" onClick={() => onHandTo(card)}>
                      <UserPlus className="h-4 w-4" aria-hidden /> Hand to…
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {mayDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11 text-accent-red-deep focus:text-accent-red-deep"
                    onClick={() => onDelete!(card)}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Delete this card
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
