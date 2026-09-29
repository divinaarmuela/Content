'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Play, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dayKeyInZone, formatInZone } from '@/app/lib/timezone-core'
import { groupForList, monthCells } from '@/app/lib/social-schedule-core'
import { dropIntent, dropLabelAt, moveToDay, previewOrder } from '@/app/lib/schedule-drag-core'
import { previewPosts, type NetworkLine } from '@/app/lib/schedule-stage-core'
import { feedWords, type LiveTile } from '@/app/lib/feed-preview-core'
import Chip from '../../ui/Chip'
import { AlertMark, NetworkLogos, STAGE_DIM, STAGE_RING, StageDot, Thumb, clockLabel } from './tiles'
import { isFileDrag } from '@/app/lib/schedule-upload-core'
import { RAIL_DRAG_TYPE } from './MediaRail'
import { DROP_KINDS } from './WeekGrid'
import { POST_ID_ATTR, TILE_DRAG_TYPE, type DragSchedule } from './useDragSchedule'
import type { SchedulePostRow } from './useSchedulePosts'

/**
 * The other ways to look at the same posts: a month, a list, the feed
 * preview and the stories.
 *
 * The grouping is the core's (`monthCells`, `groupForList`), so a post lands
 * on the same day here as it does on the week grid — in the CLIENT's zone,
 * which is the only zone a posting time means anything in. What a post is
 * CALLED is its stage's words (`post.facts`, from `post-stage-core`), never a
 * second spelling made up here.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * The bin was pressed and confirmed. Resolves to null when it went through,
 * or to the server's own sentence when it was refused — shown beside the bin,
 * not in a toast at the other end of the screen (the owner's decision 2).
 */
export type BinHandler = (post: SchedulePostRow) => Promise<string | null>

const LINE_TONE: Record<NetworkLine['tone'], string> = {
  // WORDS, not dots: these are sentences on a row, so they answer to the
  // 4.5:1 text rule. The brand green and red do not, so the readable pair
  // carries the text.
  done: 'text-accent-green-deep', trouble: 'text-accent-red-deep', waiting: 'text-muted-foreground',
}
const LINE_GLYPH: Record<NetworkLine['tone'], string> = { done: '✓', trouble: '✕', waiting: '·' }

/** What ONE network did with the post — from the post's own outcomes (audit S15). */
function NetworkMark({ n }: { n: NetworkLine }) {
  return (
    <span className={cn('inline-flex items-center gap-1', LINE_TONE[n.tone])} title={n.error ?? undefined}>
      <span aria-hidden>{LINE_GLYPH[n.tone]}</span>
      {n.network} · {n.label}
      {n.url && (
        <a
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center gap-0.5 font-semibold underline underline-offset-2"
        >
          View<ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only"> on {n.network}, opens in a new tab</span>
        </a>
      )}
    </span>
  )
}

/**
 * The bin on a row: `postActions`' danger action and nothing else — "Delete
 * draft" on a draft that was never sent (the row is really deleted, T23),
 * "Cancel post" anywhere else (T20). Its question and any refusal sit right
 * next to it.
 */
function Bin({ post, onBin }: { post: SchedulePostRow; onBin: BinHandler }) {
  const bin = post.bin
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  if (!bin) return null
  if (bin.blocked) {
    return (
      <span className="flex max-w-[200px] shrink-0 items-center gap-2">
        <button
          type="button"
          disabled
          aria-label={`${bin.label} — ${bin.blocked}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground opacity-50"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </button>
        <span className="text-[12px] text-muted-foreground">{bin.blocked}</span>
      </span>
    )
  }
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => { setRefusal(null); setAsking(true) }}
        aria-label={bin.label}
        title={bin.label}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
      </button>
    )
  }
  return (
    <span role="group" aria-label={bin.label} className="flex max-w-[320px] shrink-0 flex-col items-end gap-1.5">
      <span className="text-right text-[12px] font-semibold">{bin.confirm ?? `${bin.label}?`}</span>
      {refusal && <span role="alert" className="text-right text-[12px] text-accent-red-deep">{refusal}</span>}
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => { setAsking(false); setRefusal(null) }}
          className="min-h-11 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted"
        >
          Keep it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const why = await onBin(post)
            setBusy(false)
            if (why) setRefusal(why)
            else setAsking(false)
          }}
          className="min-h-11 rounded-full bg-accent-red px-3 text-[12px] font-semibold text-cream disabled:opacity-60"
        >
          {busy ? 'Working…' : bin.label}
        </button>
      </span>
    </span>
  )
}

/** A post as one line: media, time, where it stands, what each network did, and the bin. */
function PostRow({ post, tz, onOpen, onBin }: {
  post: SchedulePostRow
  tz: string
  onOpen: (post: SchedulePostRow) => void
  /** the bin — absent where a view offers none */
  onBin?: BinHandler
}) {
  const f = post.facts
  const extra = f.alert || f.networks.length > 0 || post.source_deleted
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-inner border border-border bg-surface px-3 py-2 transition-shadow hover:shadow-md',
        STAGE_DIM[f.tone],
      )}
    >
      <div className="flex min-h-11 items-start gap-3">
        <button
          type="button"
          onClick={() => onOpen(post)}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-inner text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
        >
          <Thumb
            slide={post.slides[0] ?? null}
            label={post.item_title ?? 'Post'}
            className="h-11 w-11 shrink-0 rounded-tile"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-[15px] font-semibold">{post.item_title ?? 'Post'}</span>
              <Chip tone={f.tone}>{f.label}</Chip>
            </span>
            <span className="block truncate text-[13px] text-muted-foreground">
              {clockLabel(post.scheduled_for, tz) || 'No time yet'}
              {' · '}
              {f.line}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 pt-1">
            <NetworkLogos platforms={post.platforms} size={14} max={4} />
            <StageDot tone={f.tone} />
          </span>
        </button>
        {onBin && <Bin post={post} onBin={onBin} />}
      </div>
      {extra && (
        // beside the thumbnail's edge, outside the button: the network links
        // are links of their own, and a link inside a button is neither
        <div className="flex flex-col gap-0.5 pl-14">
          {/* WHAT STOPS IT, in words — a red "!" and the sentence, on a
              phone too, never only in a hover title (audit S13) */}
          {f.alert && (
            <p className="flex items-start gap-1.5 text-[13px] font-medium text-accent-red-deep">
              <AlertMark label="Needs attention" className="mt-0.5 shrink-0" />
              {f.alert}
            </p>
          )}
          {/* WHAT EACH NETWORK DID — "went out on Instagram, LinkedIn did not" */}
          {f.networks.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
              {f.networks.map(n => <NetworkMark key={n.platform} n={n} />)}
            </p>
          )}
          {post.source_deleted && (
            <p className="text-[12px] text-muted-foreground">Its card was deleted — the post is kept here.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function ListView({ posts, tz, todayKey, onOpen, onBin, pinned, empty = 'Nothing on the schedule this week.' }: {
  posts: SchedulePostRow[]
  tz: string
  /** the client's today, so the first headings read "Today" and "Tomorrow" */
  todayKey?: string | null
  onOpen: (post: SchedulePostRow) => void
  /** the row's bin: Delete draft or Cancel post, as `postActions` says */
  onBin?: BinHandler
  /** a group that leads the list whatever its days — the missed times */
  pinned?: { label: string; posts: SchedulePostRow[] } | null
  /** what an empty list says */
  empty?: string
}) {
  const groups = groupForList(posts, tz, todayKey)
  const lead = pinned && pinned.posts.length > 0 ? pinned : null
  if (groups.length === 0 && !lead) return <Empty>{empty}</Empty>
  return (
    <div className="flex flex-col gap-5 pb-4">
      {lead && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent-red-deep">{lead.label}</h2>
          {lead.posts.map(p => <PostRow key={p.id} post={p} tz={tz} onOpen={onOpen} onBin={onBin} />)}
        </section>
      )}
      {groups.map(group => (
        <section key={group.dayKey || 'none'} className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {group.label}
          </h2>
          {group.posts.map(p => <PostRow key={p.id} post={p} tz={tz} onOpen={onOpen} onBin={onBin} />)}
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
                {list.slice(0, 4).map(p => {
                  const warn = p.facts.alert ?? (p.facts.missed ? p.facts.label : null)
                  // the same sentence to the eye and to a screen reader: the
                  // thumbnail's alt names the post but not where it stands
                  const said = [
                    p.item_title ?? 'Post', p.facts.label, p.facts.alert,
                    drag.blockedReason(p) ?? 'Drag it to another day to move it',
                  ].filter(Boolean).join(' · ')
                  return (
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
                      aria-label={said}
                      title={said}
                      className={cn(
                        'relative h-11 w-11 overflow-hidden rounded-tile border border-border focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue',
                        STAGE_DIM[p.facts.tone],
                        STAGE_RING[p.facts.tone],
                        drag.moving?.postId === p.id && 'rotate-2 ring-2 ring-accent-blue',
                        drag.saving.has(p.id) && 'animate-pulse opacity-60',
                      )}
                    >
                      <Thumb slide={p.slides[0] ?? null} label={p.item_title ?? 'Post'} className="h-full w-full" />
                      <StageDot tone={p.facts.tone} className="absolute left-0.5 top-0.5 h-2 w-2 border" />
                      {warn && <AlertMark label={warn} className="absolute right-0.5 top-0.5 h-3 w-3 text-[9px]" />}
                      {/* every network, small — a post for two is not a post for one (audit S14) */}
                      <NetworkLogos platforms={p.platforms} size={8} max={2} className="absolute bottom-0.5 right-0.5" />
                    </button>
                  )
                })}
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

/**
 * THE FEED AS IT WILL LOOK (the owner, 24 Sep 2026, pointing at Later's visual Instagram planner).
 *
 * The posts going out sit above the account's OWN grid as it is right now,
 * read from the platform, so the next post can be judged against what it will
 * actually join. Instagram only, and only Ready to post and Booked in
 * (`previewPosts`): a cancelled post, a TikTok-only post or a post still
 * being approved is not going to be in this feed (audit S8). What already went
 * out is drawn once — from the feed itself. Nothing here posts anything.
 */
export function PreviewGrid({ posts, tz, onOpen, accountId, handle, instagramIds }: {
  posts: SchedulePostRow[]
  tz: string
  onOpen: (post: SchedulePostRow) => void
  /** the Instagram account whose feed sits underneath, when one is picked */
  accountId?: string | null
  handle?: string | null
  /** the client's Instagram account ids — the only channels this preview is of */
  instagramIds: ReadonlySet<string>
}) {
  const [live, setLive] = useState<LiveTile[] | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  useEffect(() => {
    if (!accountId) { setLive(null); setReason(null); return }
    let alive = true
    setLive(null); setReason(null)
    void fetch(`/api/social/schedule/feed?account=${encodeURIComponent(accountId)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive) { setLive(Array.isArray(j?.tiles) ? j.tiles : []); setReason(j?.reason ?? null) } })
      .catch(() => { if (alive) { setLive([]); setReason('unreadable') } })
    return () => { alive = false }
  }, [accountId])
  // the feed was read: what already went out is drawn from it, not twice
  const feedShown = live !== null && !reason
  // what has not gone out yet first, soonest at the top left — the order it
  // will actually appear in — then what is already up, newest first
  const ordered = previewOrder(previewPosts(posts, instagramIds, feedShown))
  const feed = live ?? []
  if (instagramIds.size === 0) {
    return <Empty>This client has no Instagram account connected, so there is no feed to preview.</Empty>
  }
  if (ordered.length === 0 && feed.length === 0) {
    return <Empty>{accountId && live === null ? 'Reading the feed…' : 'Nothing is going out on Instagram yet, so there is nothing to preview.'}</Empty>
  }
  return (
    <div className="flex max-w-xl flex-col gap-2 pb-4">
      <p className="text-[13px] text-muted-foreground">
        {feedWords(ordered.length, feed.length, handle ?? null)}
        {reason === 'not_connected' ? ' Connect the account to see its own grid.' : ''}
      </p>
      <div className="grid grid-cols-3 gap-1">
      {ordered.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p)}
          aria-label={`${p.item_title ?? 'Post'} · ${p.facts.label} · ${formatInZone(p.scheduled_for ?? '', tz, 'full') ?? 'No time yet'}`}
          title={`${p.item_title ?? 'Post'} · ${p.facts.label} · ${formatInZone(p.scheduled_for ?? '', tz, 'full') ?? ''}`}
          className={cn('relative aspect-square overflow-hidden border border-border focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue', STAGE_RING[p.facts.tone])}
        >
          <Thumb slide={p.slides[0] ?? null} label={p.item_title ?? 'Post'} className="h-full w-full" />
          <StageDot tone={p.facts.tone} className="absolute left-1.5 top-1.5" />
          <span className="absolute bottom-1 left-1 rounded-full bg-ink/80 px-1.5 py-0.5 text-[10px] font-semibold text-cream">{p.facts.label}</span>
        </button>
      ))}
      {/* the account's own grid, as it is now — opens the real post, never this dashboard's copy */}
      {feed.map(t => (
        <a
          key={t.id}
          href={t.permalink ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={`Already posted${t.at ? ` · ${formatInZone(t.at, tz, 'full') ?? ''}` : ''}`}
          aria-label={`Already posted: ${t.caption.slice(0, 80) || 'post'}`}
          className="relative aspect-square overflow-hidden border border-border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.thumbnail ?? ''} alt="" loading="lazy" className="h-full w-full object-cover" />
          {t.mediaType === 'video' && <Play className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white drop-shadow" aria-hidden />}
          {t.mediaType === 'carousel' && <Copy className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white drop-shadow" aria-hidden />}
        </a>
      ))}
      </div>
    </div>
  )
}

/** The stories for the week — a story is gone in a day, so it gets its own
 *  short list rather than a slot on the grid. A post is a story when any of
 *  its networks posts it as one (`per_channel[…].kind`, audit S3). */
export function StoriesView({ posts, tz, onOpen, onBin }: {
  posts: SchedulePostRow[]
  tz: string
  onOpen: (post: SchedulePostRow) => void
  onBin?: BinHandler
}) {
  if (posts.length === 0) return <Empty>No stories on the schedule this week.</Empty>
  return (
    <div className="flex flex-col gap-2 pb-4">
      {posts.map(p => <PostRow key={p.id} post={p} tz={tz} onOpen={onOpen} onBin={onBin} />)}
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
