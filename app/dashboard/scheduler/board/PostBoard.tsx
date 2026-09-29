'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { LayoutGrid, List as ListIcon } from 'lucide-react'
import { STAGE_MEANING, type OfferedAction, type PostState } from '../../../lib/post-stage-core'
import {
  boardActions, dropOnPostLane, groupPosts, postMoveTargets, postApprovalWindowHref, scheduleLink,
} from '../../../lib/post-board-core'
import { SCHEDULE_PAGE } from '../../../lib/page-access-core'
import { usePersistedChoice } from '../../production/workHooks'
import { LaneBoard, type Lane as BoardLane } from '../../production/LaneBoard'
import Chip from '../../ui/Chip'
import { PostCard, cardTint } from './PostCard'
import type { BoardPost } from './usePostBoard'

const VIEWS = ['columns', 'list'] as const

/** What a lane says when it is empty, in its own words. */
const LANE_EMPTY: Record<string, string> = {
  draft: 'No drafts.',
  quality_check: 'Nothing waiting on the quality check.',
  with_client: 'Nothing with a client.',
  approved: 'Nothing approved in the last two weeks.',
}

/** The one line under a lane's name, for a screen reader and a hover. */
const LANE_MEANING: Record<string, string> = {
  draft: STAGE_MEANING.draft,
  quality_check: STAGE_MEANING.quality_check,
  with_client: STAGE_MEANING.with_client,
  approved: 'Approved. Booked on the Schedule page.',
}

/**
 * THE POST APPROVAL BOARD (SPEC §4.2, the owner's decision 1).
 *
 * Four lanes — Draft, Quality check, With client, Approved — each holding the
 * posts whose stage it holds (`groupPosts`, which reads `laneOf`). A card is
 * never drawn in one lane and acted on as another: its buttons, its Move menu
 * and a drop onto a lane all come from `boardActions` for the same post, and a
 * refused drop snaps back with the rule's own reason (audit B1, J9).
 *
 * The Columns or List choice is remembered; the List has ONE stage column
 * (audit B10). Cancelled posts sit folded under the board, each with Re-book.
 */
export function PostBoard({
  posts, cancelled, now, busyId, errorFor, onPress, initialLane, focus,
}: {
  posts: readonly BoardPost[]
  cancelled: readonly BoardPost[]
  now: string
  busyId: string | null
  errorFor: (id: string) => string | null
  onPress: (post: PostState, action: OfferedAction) => void
  initialLane?: string | null
  /** posts named in the address (`?post=`, `?item=`): outlined so they are found */
  focus?: ReadonlySet<string>
}) {
  const [view, setView] = usePersistedChoice('post-board-view', VIEWS, 'columns', 'view')
  const [dragging, setDragging] = useState<BoardPost | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const justDragged = useRef(false)

  const grouped = useMemo(
    () => groupPosts(posts.map(bp => ({ id: bp.post.id, stage: bp.post.stage, stage_at: bp.post.stage_at, bp }))),
    [posts])
  const reachable = useMemo(() => new Set(
    dragging ? postMoveTargets(dragging.post, dragging.hats, now, dragging.ctx).map(m => m.lane) : []),
  [dragging, now])
  const firstId = grouped.find(g => g.posts.length > 0)?.posts[0]?.id ?? null

  // a post named in the address is brought into view once it is drawn
  useEffect(() => {
    const first = focus ? [...focus][0] : null
    if (!first) return
    try { document.querySelector(`[data-post-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* nothing to scroll to */ }
  }, [focus])

  const drop = (laneKey: string) => {
    const held = dragging
    setDragging(null)
    setOver(null)
    if (!held) return
    const d = dropOnPostLane(held.post, laneKey, held.hats, now, held.ctx)
    // a refused move snaps back: nothing changed, and the reason is said
    if (!d.ok) { toast.error(d.reason); return }
    onPress(held.post, d.action)
  }

  const card = (bp: BoardPost) => {
    const actions = boardActions(bp.post, bp.hats, now, bp.ctx)
    return (
      <PostCard
        post={bp.post}
        face={bp.face}
        actions={actions}
        moves={postMoveTargets(bp.post, bp.hats, now, bp.ctx)}
        busy={busyId === bp.post.id}
        error={errorFor(bp.post.id)}
        windowHref={postApprovalWindowHref(bp.post)}
        schedule={scheduleLink(bp.post, SCHEDULE_PAGE)}
        onPress={onPress}
        tour={bp.post.id === firstId}
      />
    )
  }

  const lanes: BoardLane[] = grouped.map(({ lane, posts: inLane }) => {
    const key = lane.key
    const active = dragging !== null && reachable.has(key)
    const zone = (
      <div
        role="list"
        aria-label={`${lane.label} — drop a post here to move it`}
        onDragOver={e => { if (dragging) { e.preventDefault(); if (over !== key) setOver(key) } }}
        onDragLeave={() => { if (over === key) setOver(null) }}
        onDrop={e => { e.preventDefault(); drop(key) }}
        className={`flex min-h-[120px] flex-col gap-2.5 rounded-inner transition-colors ${
          dragging ? active ? over === key ? 'bg-tint-green ring-2 ring-accent-green' : 'bg-tint-green' : 'opacity-60' : ''
        }`}
      >
        {inLane.map(({ id, bp }) => (
            <div
              key={id}
              role="listitem"
              data-post-id={id}
              data-tour={id === firstId ? 'board-card' : undefined}
              draggable={!busyId}
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', id)
                justDragged.current = true
                setDragging(bp)
              }}
              onDragEnd={() => {
                setDragging(null); setOver(null)
                setTimeout(() => { justDragged.current = false }, 0)
              }}
              onClickCapture={e => { if (justDragged.current) { e.preventDefault(); e.stopPropagation() } }}
              className={`${dragging?.post.id === id ? 'opacity-50' : ''} ${focus?.has(id) ? 'rounded-inner ring-2 ring-accent-blue' : ''}`}
            >
              {card(bp)}
            </div>
        ))}
        {inLane.length === 0 && (
          <div className="rounded-inner border border-dashed border-border px-3 py-7 text-center text-[13px] text-muted-foreground">
            {LANE_EMPTY[key] ?? 'Nothing here.'}
          </div>
        )}
      </div>
    )
    return {
      key,
      title: lane.label,
      count: inLane.length,
      empty: LANE_EMPTY[key] ?? 'Nothing here.',
      cards: [],
      replace: zone,
      hint: <span className="sr-only">{LANE_MEANING[key]}</span>,
    }
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div role="group" aria-label="Columns or a list" className="inline-flex h-11 items-center rounded-full border border-border bg-surface p-1">
          {VIEWS.map(v => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>
              {v === 'columns' ? <LayoutGrid className="h-4 w-4" aria-hidden /> : <ListIcon className="h-4 w-4" aria-hidden />}
              {v === 'columns' ? 'Columns' : 'List'}
            </button>
          ))}
        </div>
      </div>

      {view === 'list' ? (
        <PostList groups={grouped.map(g => ({ label: g.lane.label, posts: g.posts.map(p => p.bp) }))} />
      ) : (
        <div data-tour="board-lanes">
          <LaneBoard lanes={lanes} initialLane={initialLane ?? undefined} ariaLabel="Posts, by stage" />
        </div>
      )}

      {cancelled.length > 0 && (
        <details className="group rounded-card border border-border bg-surface px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-semibold">
            Cancelled · {cancelled.length}
            <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
            <span className="text-[13px] font-normal text-muted-foreground">Cancelled in the last 30 days. Re-book one to start it again.</span>
          </summary>
          <div className="grid gap-2.5 pb-2 pt-1 md:grid-cols-2 xl:grid-cols-3">
            {cancelled.map(bp => <div key={bp.post.id}>{card(bp)}</div>)}
          </div>
        </details>
      )}
    </div>
  )
}

/**
 * THE LIST: one row per post, ONE stage column (audit B10 — the old list said
 * one thing under "Column" and another under "Stage").
 */
function PostList({ groups }: { groups: { label: string; posts: BoardPost[] }[] }) {
  const rows = groups.flatMap(g => g.posts)
  if (rows.length === 0) {
    return <p className="rounded-inner border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">No posts to approve right now.</p>
  }
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="border-b border-border text-[12px] uppercase tracking-[0.02em] text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-semibold">Post</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Stage</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Waiting on</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Goes out</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(bp => (
            <tr key={bp.post.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2.5">
                <Link href={postApprovalWindowHref(bp.post)} className="flex min-h-11 flex-col justify-center underline-offset-4 hover:underline">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">{bp.face.client}</span>
                  <span className="font-semibold">{bp.face.title}</span>
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <span className="flex flex-wrap gap-1.5">
                  <Chip tone={bp.face.stage.tone}>{bp.face.stage.label}</Chip>
                  {bp.face.missed && <Chip tone="red">{bp.face.missed}</Chip>}
                </span>
              </td>
              <td className="px-3 py-2.5">
                {bp.face.waiting.line}
                {bp.face.waiting.sinceWords && <span className="text-muted-foreground"> · {bp.face.waiting.sinceWords}</span>}
                {bp.face.problem && <span className="block font-medium">{bp.face.problem}</span>}
              </td>
              <td className={`px-3 py-2.5 ${cardTint(bp.face.tone) === 'red' ? 'font-medium' : ''}`}>{bp.face.when ?? 'No time yet'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

