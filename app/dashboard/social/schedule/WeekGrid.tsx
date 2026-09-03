'use client'

import { useState } from 'react'
import { Clock, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScheduleWeekGrid, SuggestedTime } from '@/app/lib/social-schedule-core'
import type { ScheduleNote } from '@/lib/db-types'
import PlatformIcon from '../PlatformIcon'
import { STATUS_WORDS, StatusDot, Thumb, TONE_DIM, clockLabel } from './tiles'
import { RAIL_DRAG_TYPE } from './MediaRail'
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
export function PostTile({ post, tz, top, offGrid, lane, lanes, onOpen }: {
  post: SchedulePostRow
  tz: string
  top: number
  offGrid: boolean
  /** which of the side-by-side slots this tile takes at this time */
  lane: number
  lanes: number
  /** open the post in the composer */
  onOpen: (post: SchedulePostRow) => void
}) {
  const when = clockLabel(post.scheduled_for, tz)
  const title = [
    post.item_title ?? 'Post',
    STATUS_WORDS[post.live_status],
    // the same sentence the server would refuse with, so the tile and the API
    // never explain the same block two different ways
    post.block_reason,
    offGrid ? 'Outside the hours shown' : null,
  ].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onOpen(post) }}
      title={title}
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
export function NoteTile({ note, top }: { note: ScheduleNote; top: number }) {
  return (
    <div
      style={{ top }}
      title={note.text}
      // the day column opens the composer on a click; a note is a thing on
      // the calendar, not an empty patch of it, so clicking one must not
      // start a post at the note's time
      onClick={e => e.stopPropagation()}
      className="absolute inset-x-1.5 flex h-10 items-center gap-1.5 rounded-tile border border-border bg-paper px-2 text-[11px] font-semibold"
    >
      <StickyNote className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="truncate">{note.text}</span>
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
}) {
  const tz = grid.tz
  const [dropDay, setDropDay] = useState<number | null>(null)

  /** the time a pointer at `clientY` is over, in the client's zone */
  const timeAt = (el: HTMLElement, dayIndex: number, clientY: number): string | null => {
    const box = el.getBoundingClientRect()
    return grid.slotAt(dayIndex, clientY - box.top)?.iso ?? null
  }

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
              onClick={e => {
                const iso = timeAt(e.currentTarget, day.index, e.clientY)
                if (iso) onSlot(iso)
              }}
              onDragOver={e => {
                if (!e.dataTransfer.types.includes(RAIL_DRAG_TYPE)) return
                e.preventDefault()
                setDropDay(day.index)
              }}
              onDragLeave={() => setDropDay(d => (d === day.index ? null : d))}
              onDrop={e => {
                e.preventDefault()
                setDropDay(null)
                const itemId = e.dataTransfer.getData(RAIL_DRAG_TYPE)
                const iso = timeAt(e.currentTarget, day.index, e.clientY)
                if (itemId && iso) onDropItem(itemId, iso)
              }}
              className={cn(
                'relative min-w-0 flex-1 border-l border-border first:border-l-0',
                isToday && 'bg-foreground/[0.035]',
                dropDay === day.index && 'bg-tint-blue ring-2 ring-inset ring-accent-blue',
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
                return pos ? <NoteTile key={note.id} note={note} top={pos.top} /> : null
              })}

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
