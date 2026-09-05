'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScheduleWeekGrid, SuggestedTime } from '@/app/lib/social-schedule-core'
import { dropIntent, dropLabelAt, LONG_PRESS_MS } from '@/app/lib/schedule-drag-core'
import type { ScheduleNote } from '@/lib/db-types'
import PlatformIcon from '../PlatformIcon'
import { STATUS_WORDS, StatusDot, Thumb, TONE_DIM, clockLabel } from './tiles'
import { isFileDrag } from '@/app/lib/schedule-upload-core'
import { RAIL_DRAG_TYPE } from './MediaRail'
import { POST_ID_ATTR, TILE_DRAG_TYPE, type DragSchedule } from './useDragSchedule'
import { layoutLanes } from './week-nav'
import type { SchedulePostRow } from './useSchedulePosts'

/**
 * The week: seven columns of hour rows, a tile where a post sits.
 *
 * Every position on this grid comes from `scheduleWeekGrid` — `tileTop` puts
 * a tile at a time and `slotAt` reads a time back off a click, and they are
 * inverses on the quarter hour. Nothing here does its own arithmetic on an
 * offset, so the week the clocks change still has seven days in it.
 *
 * Hours run 06:00 to 20:00 because that is when anything is posted; a post
 * outside them is clamped to the edge and says so rather than being dropped
 * off the page.
 */

const TILE_PX = 80

/** The two things that can be dropped on a column, named once for both grids. */
export const DROP_KINDS = { post: TILE_DRAG_TYPE, media: RAIL_DRAG_TYPE }

/** "6 AM", "12 PM" — the hour rail down the left. */
function hourLabel(hour: number): string {
  const h12 = ((hour + 11) % 12) + 1
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`
}

export function StoriesStrip({ stories, tz }: { stories: SchedulePostRow[]; tz: string }) {
  return (
    <div className="flex h-7 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {/* indented past the hour rail, so it starts where the columns do */}
      <span className="w-12 shrink-0" aria-hidden />
      <span>Stories</span>
      <span aria-hidden>·</span>
      {stories.length === 0 ? (
        <span className="normal-case tracking-normal">none this week</span>
      ) : (
        <span className="flex items-center gap-1.5 normal-case tracking-normal">
          {stories.slice(0, 6).map(s => (
            <span key={s.id} className="inline-flex items-center gap-1">
              <StatusDot tone={s.tone} className="border-0" />
              {clockLabel(s.scheduled_for, tz)}
            </span>
          ))}
          {stories.length > 6 && <span>+{stories.length - 6} more</span>}
        </span>
      )}
    </div>
  )
}

/** One post on the grid: its media, when it goes out, where to, and the dot
 *  that says where it stands. */
export function PostTile({ post, tz, top, offGrid, lane, lanes, onOpen, drag }: {
  post: SchedulePostRow
  tz: string
  top: number
  offGrid: boolean
  /** which of the side-by-side slots this tile takes at this time */
  lane: number
  lanes: number
  /** open the post in the composer */
  onOpen: (post: SchedulePostRow) => void
  /** moving this post to another time, by mouse, finger or keyboard */
  drag: DragSchedule
}) {
  const when = clockLabel(post.scheduled_for, tz)
  const stuck = drag.blockedReason(post)
  const lifted = drag.moving?.postId === post.id
  const saving = drag.saving.has(post.id)
  const title = [
    post.item_title ?? 'Post',
    STATUS_WORDS[post.live_status],
    // the same sentence the server would refuse with, so the tile and the API
    // never explain the same block two different ways
    post.block_reason,
    offGrid ? 'Outside the hours shown' : null,
    stuck ?? 'Drag to move it, or press Space and use the arrow keys',
  ].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        // the click the browser sends after a finger finishes a drag is not
        // a request to open the post it just put down
        if (drag.recentlyMoved()) return
        onOpen(post)
      }}
      title={title}
      draggable={!stuck && !saving}
      onDragStart={e => {
        if (!drag.startMouse(post, e.dataTransfer)) e.preventDefault()
      }}
      // a finger resting on a tile lifts it; a tap still opens it
      onPointerDown={e => {
        if (e.pointerType === 'touch' && !stuck && !saving) {
          drag.startTouch(post, { x: e.clientX, y: e.clientY })
        }
      }}
      onPointerUp={() => drag.endTouchIntent()}
      onPointerCancel={() => drag.endTouchIntent()}
      onKeyDown={e => drag.onTileKeyDown(post, e)}
      // right-clicking a POST is not a request for a note at that post's time
      onContextMenu={e => e.stopPropagation()}
      {...{ [POST_ID_ATTR]: post.id }}
      style={{
        top,
        height: TILE_PX,
        left: `calc(6px + ${lane} * (100% - 12px) / ${lanes})`,
        width: `calc((100% - 12px) / ${lanes} - ${lanes > 1 ? 2 : 0}px)`,
        minWidth: lanes > 1 ? 40 : undefined,
      }}
      className={cn(
        'absolute overflow-hidden rounded-tile border border-border bg-foreground/[0.06] transition-shadow hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue',
        TONE_DIM[post.tone],
        offGrid && 'border-dashed',
        // NO `touch-action` here: the week is scrolled with a finger, and
        // most of a busy column is tiles. A press that turns into a drag stops
        // the page moving from the window instead (see `useDragSchedule`).
        !stuck && !saving && 'cursor-grab',
        // lifted: it follows the pointer, so it leans out of the grid
        lifted && 'z-20 rotate-2 scale-[1.02] cursor-grabbing shadow-xl ring-2 ring-accent-blue',
        // the move is with the server; it is not settled until it answers
        saving && 'animate-pulse opacity-60',
      )}
    >
      <Thumb slide={post.slides[0] ?? null} label={post.item_title ?? 'Post'} className="h-full w-full" />
      <StatusDot tone={post.tone} className="absolute left-1.5 top-1.5" />
      {when && (
        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/70 px-1.5 py-0.5 text-[10px] font-bold text-cream">
          {when}
        </span>
      )}
      {post.platforms[0] && (
        <span className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink">
          <PlatformIcon platform={post.platforms[0]} size={14} className="rounded-full" />
        </span>
      )}
      <span className="sr-only">{title}</span>
    </button>
  )
}

/** A note the team pinned to a day — never seen by a client, never posted. */
export function NoteTile({ note, top, onOpen }: {
  note: ScheduleNote
  top: number
  /** open it for rewriting, in place */
  onOpen?: (note: ScheduleNote) => void
}) {
  return (
    <button
      type="button"
      style={{ top }}
      title={`${note.text} — only your team sees this`}
      // the day column opens the composer on a click; a note is a thing on
      // the calendar, not an empty patch of it, so clicking one must not
      // start a post at the note's time
      onClick={e => { e.stopPropagation(); onOpen?.(note) }}
      className="absolute inset-x-1.5 flex min-h-11 items-center gap-1.5 rounded-tile border border-border bg-paper px-2 text-left text-[11px] font-semibold hover:border-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
    >
      <StickyNote className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="truncate">{note.text}</span>
    </button>
  )
}

/** Where a lifted tile would land: the dashed slot under the pointer, saying
 *  the time it would take. */
export function DropSlot({ top, iso, tz, offGrid }: {
  top: number
  iso: string
  tz: string
  /** the time is outside the hours drawn; the slot sits at the edge and the
   *  label still says the real time, rather than vanishing */
  offGrid?: boolean
}) {
  return (
    <div
      aria-hidden
      style={{ top }}
      className={cn(
        'pointer-events-none absolute inset-x-1.5 flex h-[80px] items-center justify-center rounded-tile border-2 border-dashed border-accent-blue bg-tint-blue',
        offGrid && 'h-10',
      )}
    >
      <span className="rounded-full bg-accent-blue px-2 py-0.5 text-[10px] font-bold text-cream">
        {dropLabelAt(iso, tz)}
      </span>
    </div>
  )
}

/** A good time to post, from this client's own numbers where they have
 *  enough of them — the sentence saying which is on the hover. */
export function SlotHint({ slot, top, tz, onPick }: {
  slot: SuggestedTime
  top: number
  tz: string
  onPick: (iso: string) => void
}) {
  return (
    <button
      type="button"
      style={{ top }}
      title={slot.why}
      onClick={e => { e.stopPropagation(); onPick(slot.iso) }}
      className="absolute inset-x-1.5 flex h-10 items-center justify-between gap-1 rounded-tile border border-dashed border-accent-blue/45 bg-tint-blue px-2 text-accent-blue-deep hover:bg-accent-blue/20 dark:text-cream"
    >
      <span className="truncate text-[10px] font-bold">
        {clockLabel(slot.iso, tz)}
      </span>
      <Clock className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden />
      <span className="sr-only">Good time to post — {slot.why}</span>
    </button>
  )
}

export default function WeekGrid({
  grid, posts, notes, suggested, todayKey, nowTop, onSlot, onOpen, onDropItem,
  onDropFiles, drag, noteDraft, noteEditor, onNoteAt, onNoteOpen, noteMode,
}: {
  grid: ScheduleWeekGrid
  posts: SchedulePostRow[]
  notes: ScheduleNote[]
  suggested: SuggestedTime[]
  /** the client's today, so the right column is tinted */
  todayKey: string | null
  /** where the now-line sits in the grid, in the CLIENT's zone — null when
   *  today is not in this week or the time is outside the hours shown */
  nowTop: number | null
  /** an empty patch of the week was clicked — start a post at that time */
  onSlot: (iso: string) => void
  /** a tile was clicked — open it */
  onOpen: (post: SchedulePostRow) => void
  /** a card was dragged out of the rail and dropped here */
  onDropItem: (itemId: string, iso: string) => void
  /** FILES were dragged in off the desktop and dropped on this time — upload
   *  them and start a post there, with no window in the way */
  onDropFiles: (files: File[], iso: string) => void
  /** moving a post that is already on the calendar */
  drag: DragSchedule
  /** a note being written, and where */
  noteDraft: { at: string; note: ScheduleNote | null } | null
  noteEditor: React.ReactNode
  /** somebody asked for a note at this time (right-click, or "Add note") */
  onNoteAt: (iso: string) => void
  onNoteOpen: (note: ScheduleNote) => void
  /** "Add note" is armed: the next click on the week writes one */
  noteMode: boolean
}) {
  const tz = grid.tz
  const [dropDay, setDropDay] = useState<number | null>(null)
  /** where a card dragged out of the RAIL would land — the same dashed slot a
   *  post tile gets, because this is the drag where nobody can guess the
   *  minute from the thing in their hand */
  const [railAt, setRailAt] = useState<string | null>(null)
  const columns = useRef<(HTMLDivElement | null)[]>([])

  /** the time a pointer at `clientY` is over, in the client's zone */
  const timeAt = (el: HTMLElement, dayIndex: number, clientY: number): string | null => {
    const box = el.getBoundingClientRect()
    return grid.slotAt(dayIndex, clientY - box.top)?.iso ?? null
  }

  /**
   * Where a finger is, in calendar terms.
   *
   * A dragged tile follows the pointer across the whole window, so the
   * ELEMENT under it is nobody's business — the hook asks the grid where a
   * screen point is instead, and the grid is the only thing that knows.
   */
  useEffect(() => drag.registerResolver((x, y) => {
    for (let i = 0; i < columns.current.length; i++) {
      const el = columns.current[i]
      if (!el) continue
      const box = el.getBoundingClientRect()
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      return grid.slotAt(i, y - box.top)?.iso ?? null
    }
    return null
    // `registerResolver` is stable; the hook's object is not, and re-running
    // this every render would churn the registration for nothing
  }), [grid, drag.registerResolver])

  const moveTo = drag.moving?.to ?? null
  const movePos = moveTo ? grid.tileTop(moveTo) : null
  const notePos = noteDraft ? grid.tileTop(noteDraft.at) : null
  const railPos = railAt ? grid.tileTop(railAt) : null

  /* A finger held on an empty patch of the week writes a note there — the
     touch equivalent of the right-click, and the same 400ms a tile takes to
     lift, so the two gestures cannot be told apart by accident. */
  const holding = useRef<number | null>(null)
  const clearHold = () => {
    if (holding.current !== null) { window.clearTimeout(holding.current); holding.current = null }
  }
  useEffect(() => clearHold, [])

  return (
    <div className="flex min-h-0 flex-1 overflow-auto">
      {/* the hour rail */}
      <div className="sticky left-0 z-10 flex w-12 shrink-0 flex-col bg-background">
        <div style={{ height: grid.headerPx }} />
        {grid.hours.map((h, i) => (
          <div
            key={h}
            style={{ height: grid.rowPx }}
            className={cn(
              'pt-0.5 text-[10px] font-semibold text-muted-foreground',
              i > 0 && 'border-t border-border',
            )}
          >
            {hourLabel(h)}
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 rounded-inner border border-border bg-surface">
        {grid.days.map(day => {
          const dayPosts = posts.filter(p => grid.tileTop(p.scheduled_for)?.dayIndex === day.index)
          const tops = new Map(dayPosts.map(p => [p.id, grid.tileTop(p.scheduled_for)!] as const))
          const { placed, overflow } = layoutLanes(
            dayPosts.map(p => ({ id: p.id, top: tops.get(p.id)!.top })), TILE_PX)
          const laneOf = new Map(placed.map(pl => [pl.id, pl] as const))
          const dayNotes = notes.filter(n => grid.tileTop(n.at)?.dayIndex === day.index)
          const daySlots = suggested.filter(s => s.dayKey === day.iso)
          const isToday = todayKey === day.iso
          return (
            <div
              key={day.iso}
              ref={el => { columns.current[day.index] = el }}
              onClick={e => {
                if (drag.recentlyMoved()) return
                const iso = timeAt(e.currentTarget, day.index, e.clientY)
                if (!iso) return
                // "Add note" armed turns the next click into a note rather
                // than a post — one mode, said out loud in the date bar
                if (noteMode) onNoteAt(iso)
                else onSlot(iso)
              }}
              // right-click is the calendar shorthand for "put a note here";
              // the visible way in is the "Add note" button
              onContextMenu={e => {
                const iso = timeAt(e.currentTarget, day.index, e.clientY)
                if (!iso) return
                e.preventDefault()
                onNoteAt(iso)
              }}
              onPointerDown={e => {
                if (e.pointerType !== 'touch' || e.target !== e.currentTarget) return
                const iso = timeAt(e.currentTarget, day.index, e.clientY)
                if (!iso) return
                clearHold()
                holding.current = window.setTimeout(() => {
                  holding.current = null
                  onNoteAt(iso)
                }, LONG_PRESS_MS)
              }}
              onPointerUp={clearHold}
              onPointerMove={clearHold}
              onPointerCancel={clearHold}
              onDragOver={e => {
                // a photo coming off the desktop: the same landing slot, and
                // 'copy' rather than 'move' because nothing is being taken
                // from anywhere
                if (isFileDrag(e.dataTransfer.types)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  setDropDay(day.index)
                  setRailAt(timeAt(e.currentTarget, day.index, e.clientY))
                  return
                }
                const kind = dropIntent(
                  e.dataTransfer.types, DROP_KINDS, drag.moving?.mode === 'mouse')
                if (!kind) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropDay(day.index)
                const at = timeAt(e.currentTarget, day.index, e.clientY)
                if (kind === 'post') drag.hoverAt(at)
                else setRailAt(at)
              }}
              onDragLeave={() => {
                setDropDay(d => (d === day.index ? null : d))
                setRailAt(null)
              }}
              onDrop={e => {
                e.preventDefault()
                setDropDay(null)
                setRailAt(null)
                const iso = timeAt(e.currentTarget, day.index, e.clientY)
                const dropped = Array.from(e.dataTransfer.files ?? [])
                if (dropped.length > 0) {
                  if (iso) onDropFiles(dropped, iso)
                  return
                }
                const kind = dropIntent(
                  [e.dataTransfer.getData(TILE_DRAG_TYPE) ? TILE_DRAG_TYPE : RAIL_DRAG_TYPE],
                  DROP_KINDS, drag.moving?.mode === 'mouse')
                if (kind === 'post') { drag.dropAt(iso); return }
                const itemId = e.dataTransfer.getData(RAIL_DRAG_TYPE)
                if (itemId && iso) onDropItem(itemId, iso)
              }}
              className={cn(
                'relative min-w-0 flex-1 border-l border-border first:border-l-0',
                isToday && 'bg-foreground/[0.035]',
                dropDay === day.index && 'bg-tint-blue ring-2 ring-inset ring-accent-blue',
                noteMode && 'cursor-copy',
              )}
              style={{ minHeight: grid.height }}
            >
              {/* the date stays put while the evening scrolls past */}
              <div
                style={{ height: grid.headerPx }}
                className={cn(
                  'sticky top-0 z-10 flex items-baseline justify-center gap-1.5 border-b border-border bg-surface text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground',
                )}
              >
                {day.weekday.slice(0, 3)}
                <b className="text-[16px] normal-case tracking-normal text-foreground">{day.day}</b>
              </div>

              {/* the hour lines, behind everything */}
              {grid.hours.slice(1).map((h, i) => (
                <div
                  key={h}
                  aria-hidden
                  style={{ top: grid.headerPx + (i + 1) * grid.rowPx }}
                  className="pointer-events-none absolute inset-x-0 border-t border-border"
                />
              ))}

              {daySlots.map(slot => {
                const pos = grid.tileTop(slot.iso)
                return pos && !pos.offGrid
                  ? <SlotHint key={slot.iso} slot={slot} top={pos.top} tz={tz} onPick={onSlot} />
                  : null
              })}

              {dayNotes.map(note => {
                const pos = grid.tileTop(note.at)
                if (!pos || noteDraft?.note?.id === note.id) return null
                return <NoteTile key={note.id} note={note} top={pos.top} onOpen={onNoteOpen} />
              })}

              {/* the note being written, where it will live */}
              {noteDraft && notePos && notePos.dayIndex === day.index && (
                <div className="absolute inset-x-1.5 z-30" style={{ top: notePos.top }}>
                  {noteEditor}
                </div>
              )}

              {dayPosts.map(post => {
                const pos = tops.get(post.id)!
                const lane = laneOf.get(post.id)
                if (!lane) return null
                return (
                  <PostTile
                    key={post.id}
                    post={post}
                    tz={tz}
                    top={pos.top}
                    offGrid={pos.offGrid}
                    lane={lane.lane}
                    lanes={lane.lanes}
                    onOpen={onOpen}
                    drag={drag}
                  />
                )
              })}

              {overflow.map(o => (
                <span
                  key={`more-${o.top}`}
                  style={{ top: o.top + TILE_PX - 18 }}
                  className="absolute right-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background"
                >
                  +{o.count}
                </span>
              ))}

              {movePos && movePos.dayIndex === day.index && moveTo && (
                <DropSlot top={movePos.top} iso={moveTo} tz={tz} offGrid={movePos.offGrid} />
              )}

              {railPos && railPos.dayIndex === day.index && railAt && (
                <DropSlot top={railPos.top} iso={railAt} tz={tz} offGrid={railPos.offGrid} />
              )}

              {isToday && nowTop !== null && (
                <div
                  role="presentation"
                  style={{ top: nowTop }}
                  className="pointer-events-none absolute inset-x-0 h-0.5 bg-accent-blue"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
