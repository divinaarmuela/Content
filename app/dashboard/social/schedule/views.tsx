'use client'

import { cn } from '@/lib/utils'
import { dayKeyInZone, formatInZone } from '@/app/lib/timezone-core'
import { groupForList, monthCells } from '@/app/lib/social-schedule-core'
import PlatformIcon from '../PlatformIcon'
import { STATUS_WORDS, StatusDot, Thumb, TONE_DIM, clockLabel } from './tiles'
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

export function ListView({ posts, tz, onOpen }: {
  posts: SchedulePostRow[]
  tz: string
  onOpen: (post: SchedulePostRow) => void
}) {
  const groups = groupForList(posts, tz)
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

export function MonthGrid({ month, posts, tz, todayKey, onOpen }: {
  /** 'YYYY-MM' — the month on screen */
  month: string
  posts: SchedulePostRow[]
  tz: string
  todayKey: string | null
  onOpen: (post: SchedulePostRow) => void
}) {
  const cells = monthCells(month, tz)
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
          return (
            <div
              key={cell.key}
              className={cn(
                'flex min-h-[92px] flex-col gap-1 border-b border-l border-border p-1.5 [&:nth-child(7n+1)]:border-l-0',
                !cell.inMonth && 'bg-foreground/[0.02] text-muted-foreground',
                todayKey === cell.key && 'bg-foreground/[0.035]',
              )}
            >
              <span className="px-0.5 text-[12px] font-semibold">{cell.day}</span>
              <div className="flex flex-wrap gap-1">
                {list.slice(0, 4).map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpen(p)}
                    title={[p.item_title ?? 'Post', STATUS_WORDS[p.live_status], p.block_reason].filter(Boolean).join(' · ')}
                    className={cn('relative h-9 w-9 overflow-hidden rounded-tile border border-border', TONE_DIM[p.tone])}
                  >
                    <Thumb slide={p.slides[0] ?? null} label={p.item_title ?? 'Post'} className="h-full w-full" />
                    <StatusDot tone={p.tone} className="absolute left-0.5 top-0.5 h-2 w-2 border" />
                  </button>
                ))}
                {list.length > 4 && (
                  <span className="self-center text-[11px] font-semibold text-muted-foreground">
                    +{list.length - 4}
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
  const ordered = posts
    .filter(p => p.scheduled_for)
    .sort((a, b) => String(b.scheduled_for).localeCompare(String(a.scheduled_for)))
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
