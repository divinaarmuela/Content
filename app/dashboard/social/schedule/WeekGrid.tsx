'use client'

import Link from 'next/link'
import { Clock, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatInZone } from '@/app/lib/timezone-core'
import type { ScheduleWeekGrid, SuggestedTime } from '@/app/lib/social-schedule-core'
import type { ScheduleNote } from '@/lib/db-types'
import PlatformIcon from '../PlatformIcon'
import { STATUS_WORDS, StatusDot, Thumb, TONE_DIM } from './tiles'
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
    <div className="flex h-7 items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      <span>Stories</span>
      <span aria-hidden>·</span>
      {stories.length === 0 ? (
        <span className="normal-case tracking-normal">none this week</span>
      ) : (
        <span className="flex items-center gap-1.5 normal-case tracking-normal">
          {stories.slice(0, 6).map(s => (
            <span key={s.id} className="inline-flex items-center gap-1">
              <StatusDot tone={s.tone} className="border-0" />
              {formatInZone(s.scheduled_for ?? '', tz, 'time') ?? 'No time yet'}
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
export function PostTile({ post, tz, top, offGrid }: {
  post: SchedulePostRow
  tz: string
  top: number
  offGrid: boolean
}) {
  const when = formatInZone(post.scheduled_for ?? '', tz, 'time') ?? ''
  const words = STATUS_WORDS[post.live_status]
  const title = [post.item_title ?? 'Post', words, offGrid ? 'Outside the hours shown' : null]
    .filter(Boolean).join(' · ')

  return (
    <Link
      href={`/dashboard/production/${post.item_id}`}
      title={title}
      style={{ top, height: TILE_PX }}
      className={cn(
        'absolute inset-x-1.5 overflow-hidden rounded-tile border border-border bg-foreground/[0.06] transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue',
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
      {post.channels[0] && (
        <span className="absolute bottom-1.5 right-1.5">
          <PlatformIcon platform={post.channels[0]} size={18} />
        </span>
      )}
      <span className="sr-only">{title}</span>
    </Link>
  )
}

/** A note the team pinned to a day — never seen by a client, never posted. */
export function NoteTile({ note, top }: { note: ScheduleNote; top: number }) {
  return (
    <div
      style={{ top }}
      title={note.text}
      className="absolute inset-x-1.5 flex h-10 items-center gap-1.5 rounded-tile border border-border bg-paper px-2 text-[11px] font-semibold"
    >
      <StickyNote className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="truncate">{note.text}</span>
    </div>
  )
}

/** A good time to post, from this client's own numbers where they have
 *  enough of them — the sentence saying which is on the hover. */
export function SlotHint({ slot, top }: { slot: SuggestedTime; top: number }) {
  return (
    <div
      style={{ top }}
      title={slot.why}
      className="absolute inset-x-1.5 flex h-10 items-center justify-end rounded-tile border border-dashed border-accent-blue/45 bg-tint-blue px-2"
    >
      <Clock className="h-3 w-3 text-accent-blue-deep dark:text-cream" strokeWidth={2.2} aria-hidden />
      <span className="sr-only">{slot.why}</span>
    </div>
  )
}

export default function WeekGrid({
  grid, posts, notes, suggested, todayKey, nowTop,
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
}) {
  const tz = grid.tz

  return (
    <div className="flex min-h-0 flex-1 overflow-auto">
      {/* the hour rail */}
      <div className="flex w-12 shrink-0 flex-col">
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
          const dayNotes = notes.filter(n => grid.tileTop(n.at)?.dayIndex === day.index)
          const daySlots = suggested.filter(s => s.dayKey === day.iso)
          const isToday = todayKey === day.iso
          return (
            <div
              key={day.iso}
              className={cn(
                'relative min-w-0 flex-1 border-l border-border first:border-l-0',
                isToday && 'bg-foreground/[0.035]',
              )}
              style={{ minHeight: grid.height }}
            >
              <div
                style={{ height: grid.headerPx }}
                className="flex items-baseline justify-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
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
                  ? <SlotHint key={slot.iso} slot={slot} top={pos.top} />
                  : null
              })}

              {dayNotes.map(note => {
                const pos = grid.tileTop(note.at)
                return pos ? <NoteTile key={note.id} note={note} top={pos.top} /> : null
              })}

              {dayPosts.map(post => {
                const pos = grid.tileTop(post.scheduled_for)!
                return (
                  <PostTile
                    key={post.id}
                    post={post}
                    tz={tz}
                    top={pos.top}
                    offGrid={pos.offGrid}
                  />
                )
              })}

              {isToday && nowTop !== null && (
                <div
                  aria-label="Now"
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
