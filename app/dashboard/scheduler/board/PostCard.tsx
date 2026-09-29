'use client'

import Link from 'next/link'
import { AlertTriangle, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { OfferedAction, PostActionList, PostState, StageTone } from '../../../lib/post-stage-core'
import type { PostCardFace } from '../../../lib/post-board-core'
import Chip from '../../ui/Chip'
import WorkCard, { type WorkTone } from '../../ui/WorkCard'
import PlatformIcon from '../../social/PlatformIcon'

/** A stage tone as a card tint: the neutral ones leave the card plain. */
export function cardTint(tone: StageTone): WorkTone | undefined {
  return tone === 'surface' || tone === 'muted' ? undefined : tone
}

/**
 * ONE POST ON THE POST APPROVAL BOARD.
 *
 * Every word on it is a fact read off the post (`postCardFace`): the stage
 * chip, who has it and since when, a missed time, who asked for a change,
 * "Emailed to …" only when this version was, and who approved it and how.
 * Every button is from `boardActions` — the list the post window, the Move
 * menu, a drop and Waiting on you all use — and a button a rule stops is
 * drawn disabled with the rule's reason beside it, never hidden.
 *
 * The whole card opens the post window (`windowHref`). Presentation only.
 */
export function PostCard({
  post, face, actions, moves, busy, error, windowHref, schedule, onPress, tour,
}: {
  post: PostState
  face: PostCardFace
  actions: PostActionList
  /** "Move to Quality check — Send for quality check": the keyboard's drag */
  moves: { lane: string; label: string; action: OfferedAction }[]
  busy: boolean
  /** the refusal for this post's last press, drawn beside its buttons */
  error: string | null
  windowHref: string
  /** an approved post's way forward: the Schedule page, where it is booked */
  schedule: { label: string; href: string } | null
  onPress: (post: PostState, action: OfferedAction) => void
  /** the first card on the board carries the walkthrough's marks */
  tour?: boolean
}) {
  const { primary, secondary, danger } = actions
  // the button on the face: the main one, or the first of the rest — and when
  // a rule stops it, its reason is drawn beside it
  const blockedPrimary = (primary ?? secondary[0])?.blocked ?? null
  const hasMenu = secondary.length > 0 || moves.length > 0 || danger !== null
  const tint = cardTint(face.tone)

  return (
    <WorkCard
      href={windowHref}
      client={face.client}
      title={face.title}
      thumb={face.thumbs.find(t => t.type === 'image')?.url}
      tone={tint}
      chips={<>
        <Chip tone={tint ? 'surface' : face.stage.tone}>{face.stage.label}</Chip>
        {face.missed && <Chip tone="red">{face.missed}</Chip>}
        {face.version && <Chip tone="muted">{face.version}</Chip>}
        {face.steps && <Chip tone="muted">{face.steps}</Chip>}
        {face.networks.length > 0 && (
          <span className="inline-flex items-center gap-1" aria-label={`Goes to ${face.networks.map(n => n.label).join(', ')}`}>
            {face.networks.map(n => <PlatformIcon key={n.platform} platform={n.platform} size={20} />)}
          </span>
        )}
      </>}
      note={<>
        <span className="block font-medium text-foreground [[data-tone=ink]_&]:text-cream">
          {face.waiting.line}{face.waiting.sinceWords ? <span className="font-normal text-muted-foreground [[data-tone=ink]_&]:text-cream/70"> · {face.waiting.sinceWords}</span> : null}
        </span>
        {face.changes && <span className="mt-1 block text-foreground [[data-tone=ink]_&]:text-cream">{face.changes}</span>}
        {face.sent && <span className="mt-1 block">{face.sent}</span>}
        {face.answerBy && <span className="mt-1 block font-medium text-foreground [[data-tone=ink]_&]:text-cream" data-answer-by>{face.answerBy}</span>}
        {face.approval && <span className="mt-1 block font-medium text-foreground [[data-tone=ink]_&]:text-cream">{face.approval}</span>}
        {face.posted && <span className="mt-1 block">{face.posted}</span>}
        {face.when && <span className="mt-1 block">Goes out {face.when}</span>}
        {face.problem && (
          <span className="mt-1 flex items-start gap-1.5 font-medium text-foreground [[data-tone=ink]_&]:text-cream">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {face.problem}
          </span>
        )}
      </>}
      actions={<>
        {primary && (
          <Button
            disabled={busy || !!blockedPrimary}
            data-tour={tour ? 'board-card-action' : undefined}
            title={blockedPrimary ?? undefined}
            onClick={e => { e.preventDefault(); onPress(post, primary) }}
            className="h-auto min-h-11 max-w-full whitespace-normal rounded-full bg-foreground px-4 py-2 text-left text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60 [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink">
            {busy ? 'Working…' : primary.label}
          </Button>
        )}
        {!primary && secondary[0] && (
          <Button variant="outline" disabled={busy || !!secondary[0].blocked}
            data-tour={tour ? 'board-card-action' : undefined}
            title={secondary[0].blocked ?? undefined}
            onClick={e => { e.preventDefault(); onPress(post, secondary[0]) }}
            className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-border bg-surface px-4 py-2 text-left text-[13px] font-semibold [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            {busy ? 'Working…' : secondary[0].label}
          </Button>
        )}
        {schedule && (
          <Link href={schedule.href}
            className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-semibold text-foreground hover:bg-muted [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
            {schedule.label}
          </Link>
        )}
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More for this post" disabled={busy}
                className="h-11 w-11 rounded-full border-border bg-surface [[data-tone=ink]_&]:border-cream/40 [[data-tone=ink]_&]:bg-transparent [[data-tone=ink]_&]:text-cream">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {(primary ? secondary : secondary.slice(1)).map(a => (
                <DropdownMenuItem key={a.action} className="min-h-11 flex-col items-start gap-0.5"
                  disabled={!!a.blocked} onClick={() => onPress(post, a)}>
                  <span>{a.label}</span>
                  {a.blocked && <span className="text-[12px] text-muted-foreground">{a.blocked}</span>}
                </DropdownMenuItem>
              ))}
              {moves.length > 0 && (
                <>
                  {(primary ? secondary : secondary.slice(1)).length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">Move</DropdownMenuLabel>
                  {moves.map(m => (
                    <DropdownMenuItem key={m.lane} className="min-h-11" onClick={() => onPress(post, m.action)}>
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {danger && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11 flex-col items-start gap-0.5 text-accent-red-deep focus:text-accent-red-deep"
                    disabled={!!danger.blocked} onClick={() => onPress(post, danger)}>
                    <span>{danger.label}</span>
                    {danger.blocked && <span className="text-[12px] text-muted-foreground">{danger.blocked}</span>}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* why the main button is stopped, or why the last press was refused —
            beside the buttons, never somewhere else (decision 2) */}
        {(error || blockedPrimary) && (
          <p role={error ? 'alert' : undefined} className="basis-full pt-1 text-[12px] font-medium text-foreground [[data-tone=ink]_&]:text-cream">
            {error ?? blockedPrimary}
          </p>
        )}
      </>}
    />
  )
}
