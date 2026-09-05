'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { dayKeyInZone, formatInZone } from '@/app/lib/timezone-core'
import { groupForList, monthCells } from '@/app/lib/social-schedule-core'
import { dropIntent, dropLabelAt, moveToDay, previewOrder } from '@/app/lib/schedule-drag-core'
import PlatformIcon from '../PlatformIcon'
import { STATUS_WORDS, StatusDot, Thumb, TONE_DIM, clockLabel } from './tiles'
import { isFileDrag } from '@/app/lib/schedule-upload-core'
import { RAIL_DRAG_TYPE } from './MediaRail'
import { DROP_KINDS } from './WeekGrid'
import { POST_ID_ATTR, TILE_DRAG_TYPE, type DragSchedule } from './useDragSchedule'
import type { SchedulePostRow } from './useSchedulePosts'

/**
 * The three other ways to look at the same week's posts: a month, a list, and
 * the feed preview.
 *
 * The grouping is the core's (`monthCells`, `groupForList`), so a post lands
 * on the same day here as it does on the week grid — in the CLIENT's zone,
 * which is the only zone a posting time means anything in.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A post as one line: media, time, what it is, where it goes. */
function PostRow({ post, tz, onOpen }: {
  post: SchedulePostRow
  tz: string
  onOpen: (post: SchedulePostRow) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      className={cn(
        'w-full text-left',
        'flex min-h-11 items-center gap-3 rounded-inner border border-border bg-surface px-3 py-2 transition-shadow hover:shadow-md',
        TONE_DIM[post.tone],
      )}
    >
      <Thumb
        slide={post.slides[0] ?? null}
        label={post.item_title ?? 'Post'}
        className="h-11 w-11 shrink-0 rounded-tile"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{post.item_title ?? 'Post'}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {clockLabel(post.scheduled_for, tz) || 'No time yet'}
          {' · '}
          {STATUS_WORDS[post.live_status]}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {post.platforms.slice(0, 3).map(c => <PlatformIcon key={c} platform={c} size={18} />)}
        <StatusDot tone={post.tone} />
      </span>
    </button>
  )
}

export function ListView({ posts, tz, todayKey, onOpen }: {
  posts: SchedulePostRow[]
  tz: string
  /** the client's today, so the first headings read "Today" and "Tomorrow" */
  todayKey?: string | null
  onOpen: (post: SchedulePostRow) => void
}) {
  const groups = groupForList(posts, tz, todayKey)
  if (groups.length === 0) return <Empty>Nothing planned in this week yet.</Empty>
  return (
    <div className="flex flex-col gap-5 pb-4">
      {groups.map(group => (
        <section key={group.dayKey || 'none'} className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {group.label}
          </h2>
          {group.posts.map(p => <PostRow key={p.id} post={p} tz={tz} onOpen={onOpen} />)}
        </section>
      ))}
    </div>
  )
}

export function MonthGrid({
  month, posts, tz, todayKey, onOpen, drag, onDropItem, onDropFiles,
  defaultTime = '11:00',
}: {
  /** 'YYYY-MM' — the month on screen */
  month: string
  posts: SchedulePostRow[]
  tz: string
  todayKey: string | null
  onOpen: (post: SchedulePostRow) => void
  /** dragging a tile onto another day — same time, different date */
  drag: DragSchedule
  /** a card was dragged out of the rail onto a day: start a post there, at
   *  the client's usual posting time (a month cell has no hour in it) */
  onDropItem: (itemId: string, iso: string) => void
  /** files dragged in off the desktop and dropped on a day */
  onDropFiles: (files: File[], iso: string) => void
  /** the client's usual posting time, 'HH:MM' */
  defaultTime?: string
}) {
  const cells = monthCells(month, tz)
  const [over, setOver] = useState<string | null>(null)
  const dayCells = useRef<Map<string, HTMLDivElement>>(new Map())

  /**
   * Where a finger is, in calendar terms — the month's answer.
   *
   * A day has no hours in it, so a point over a cell means "this day, at the
   * time the post already has". The week grid registers the same kind of
   * function; only one grid is ever on screen, so only one is ever registered.
   */
  useEffect(() => drag.registerResolver((x, y) => {
    for (const [key, el] of dayCells.current) {
      const box = el.getBoundingClientRect()
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      return moveToDay(drag.moving?.from ?? null, key, tz, defaultTime)
    }
    return null
  }), [drag, tz, defaultTime])

  /** the cell a move would land in, whichever way it is being moved — a
   *  keyboard move never touches `onDragOver`, and still has to show a target */
  const landingKey = dayKeyInZone(drag.moving?.to ?? null, tz)
  const byDay = new Map<string, SchedulePostRow[]>()
  for (const p of posts) {
    const key = dayKeyInZone(p.scheduled_for ?? null, tz)
    if (!key) continue
    byDay.set(key, [...(byDay.get(key) ?? []), p])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-inner border border-border bg-surface">
      <div className="grid grid-cols-7">
        {WEEKDAYS.map(d => (
          <div key={d} className="border-b border-border px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7">
        {cells.map(cell => {
          const list = byDay.get(cell.key) ?? []
          const landing = landingKey === cell.key ? drag.moving?.to ?? null : null
          return (
            <div
              key={cell.key}
              ref={el => {
                if (el) dayCells.current.set(cell.key, el)
                else dayCells.current.delete(cell.key)
              }}
              onDragOver={e => {
                // a photo coming off the desktop
                if (isFileDrag(e.dataTransfer.types)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  setOver(cell.key)
                  return
                }
                const kind = dropIntent(
                  e.dataTransfer.types, DROP_KINDS, drag.moving?.mode === 'mouse')
                if (!kind) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOver(cell.key)
                // a month cell has no hours in it, so the post keeps the time
                // of day it already had — dropping a 6 pm post on Friday must
                // not quietly make it a midnight post
                if (kind === 'post') drag.hoverAt(moveToDay(drag.moving?.from ?? null, cell.key, tz, defaultTime))
              }}
              onDragLeave={() => setOver(k => (k === cell.key ? null : k))}
              onDrop={e => {
                e.preventDefault()
                setOver(null)
                const dropped = Array.from(e.dataTransfer.files ?? [])
                if (dropped.length > 0) {
                  const start = moveToDay(null, cell.key, tz, defaultTime)
                  if (start) onDropFiles(dropped, start)
                  return
                }
                const at = moveToDay(drag.moving?.from ?? null, cell.key, tz, defaultTime)
                if (e.dataTransfer.getData(TILE_DRAG_TYPE) || drag.moving?.mode === 'mouse') {
                  drag.dropAt(at)
                  return
                }
                // a piece of media from the rail: start a post on that day, at
                // the time this client usually posts
                const itemId = e.dataTransfer.getData(RAIL_DRAG_TYPE)
                const start = moveToDay(null, cell.key, tz, defaultTime)
                if (itemId && start) onDropItem(itemId, start)
              }}
              className={cn(
                'flex min-h-[104px] flex-col gap-1 border-b border-l border-border p-1.5 [&:nth-child(7n+1)]:border-l-0',
                !cell.inMonth && 'bg-foreground/[0.02] text-muted-foreground',
                todayKey === cell.key && 'bg-foreground/[0.035]',
                over === cell.key && 'bg-tint-blue ring-2 ring-inset ring-accent-blue',
              )}
            >
              <span className="flex items-baseline gap-1.5 px-0.5 text-[12px] font-semibold">
                {cell.day}
                {landing && (
                  <span className="rounded-full bg-accent-blue px-1.5 py-0.5 text-[10px] font-bold text-cream" aria-hidden>
                    {dropLabelAt(landing, tz)}
                  </span>
                )}
              </span>
              <div className="flex flex-wrap gap-1">
                {list.slice(0, 4).map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpen(p)}
                    draggable={drag.blockedReason(p) === null && !drag.saving.has(p.id)}
                    onDragStart={e => { if (!drag.startMouse(p, e.dataTransfer)) e.preventDefault() }}
                    onKeyDown={e => drag.onTileKeyDown(p, e)}
                    // a finger held on a chip lifts it, exactly as in the week
                    onPointerDown={e => {
                      if (e.pointerType === 'touch' && drag.blockedReason(p) === null) {
                        drag.startTouch(p, { x: e.clientX, y: e.clientY })
                      }
                    }}
                    onPointerUp={() => drag.endTouchIntent()}
                    onPointerCancel={() => drag.endTouchIntent()}
                    {...{ [POST_ID_ATTR]: p.id }}
                    title={[
                      p.item_title ?? 'Post', STATUS_WORDS[p.live_status], p.block_reason,
                      drag.blockedReason(p) ?? 'Drag it to another day to move it',
                    ].filter(Boolean).join(' · ')}
                    className={cn(
                      'relative h-11 w-11 overflow-hidden rounded-tile border border-border',
                      TONE_DIM[p.tone],
                      drag.moving?.postId === p.id && 'rotate-2 ring-2 ring-accent-blue',
                      drag.saving.has(p.id) && 'animate-pulse opacity-60',
                    )}
                  >
                    <Thumb slide={p.slides[0] ?? null} label={p.item_title ?? 'Post'} className="h-full w-full" />
                    <StatusDot tone={p.tone} className="absolute left-0.5 top-0.5 h-2 w-2 border" />
                  </button>
                ))}
                {list.length > 4 && (
                  <span className="self-center text-[11px] font-semibold text-muted-foreground">
                    +{list.length - 4} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The feed as it will look: the posts in the order they go out. */
export function PreviewGrid({ posts, tz, onOpen }: {
  posts: SchedulePostRow[]
  tz: string
  onOpen: (post: SchedulePostRow) => void
}) {
  // what has not gone out yet first, soonest at the top left — the order it
  // will actually appear in — then what is already up, newest first
  const ordered = previewOrder(posts)
  if (ordered.length === 0) return <Empty>Nothing planned yet, so there is nothing to preview.</Empty>
  return (
    <div className="grid max-w-xl grid-cols-3 gap-1 pb-4">
      {ordered.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p)}
          title={`${p.item_title ?? 'Post'} · ${formatInZone(p.scheduled_for ?? '', tz, 'full') ?? ''}`}
          className={cn('relative aspect-square overflow-hidden border border-border', TONE_DIM[p.tone])}
        >
          <Thumb slide={p.slides[0] ?? null} label={p.item_title ?? 'Post'} className="h-full w-full" />
          <StatusDot tone={p.tone} className="absolute left-1.5 top-1.5" />
        </button>
      ))}
    </div>
  )
}

/** The stories planned for the week — a story is gone in a day, so it gets
 *  its own short list rather than a slot on the grid. */
export function StoriesView({ posts, tz, onOpen }: {
  posts: SchedulePostRow[]
  tz: string
  onOpen: (post: SchedulePostRow) => void
}) {
  if (posts.length === 0) return <Empty>No stories planned this week.</Empty>
  return (
    <div className="flex flex-col gap-2 pb-4">
      {posts.map(p => <PostRow key={p.id} post={p} tz={tz} onOpen={onOpen} />)}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-inner border border-border bg-surface p-6 text-center text-[15px] text-muted-foreground">
      {children}
    </div>
  )
}
