'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Play, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dayKeyInZone, formatInZone } from '@/app/lib/timezone-core'
import { groupForList, monthCells } from '@/app/lib/social-schedule-core'
import { dropIntent, dropLabelAt, moveToDay, previewOrder } from '@/app/lib/schedule-drag-core'
import { previewPosts, type NetworkLine } from '@/app/lib/schedule-stage-core'
import type { LiveTile } from '@/app/lib/feed-preview-core'
import { feedPreviewNote } from '@/app/lib/portal-core'
import { networkName } from '@/app/lib/publish-core'
import { CLIENT_WORD_LABEL, CLIENT_WORD_TONE, clientWord, previewAccount, previewAccounts, previewCaption, previewCover, previewShape } from '@/app/lib/schedule-client-word-core'
import PlatformIcon from '../PlatformIcon'
import Chip from '../../ui/Chip'
import { AlertMark, NetworkLogos, STAGE_DIM, STAGE_RING, StageDot, Thumb, clockLabel } from './tiles'
import { automationLine } from '@/app/lib/comment-automation-core'
import { isFileDrag, inNameOrder } from '@/app/lib/schedule-upload-core'
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
  // the comment-to-DM automation set up while scheduling: "Automation: BOOK → DM with link · waiting for the post"
  const out = post.stage === 'booked' || post.stage === 'posted'
  const auto = post.state.automation?.on
    ? automationLine(post.state.automation, out ? { made: true, active: true, live: post.stage === 'posted', stats: null } : null)
    : null
  const extra = f.alert || f.networks.length > 0 || post.source_deleted || auto
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
          {auto && <p className="text-[12px] text-muted-foreground" data-post-automation-line>{auto}</p>}
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
    // no box of its own to scroll — the page scrolls (page.tsx: the month is as tall as its posts)
    <div className="flex flex-col rounded-inner border border-border bg-surface">
      <div className="sticky top-0 z-10 grid grid-cols-7 bg-surface">
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
                const dropped = inNameOrder(Array.from(e.dataTransfer.files ?? []))
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
              {/* EVERY POST OF THE DAY, as a line with its time and name (Karly, 26 Oct 2026: "it's cutting off … is there
                  a way we can have it show like the weekly display to see the whole month at a time?") — no "+N more" */}
              <div className="flex flex-col gap-1">
                {[...list].sort((a, b) => String(a.scheduled_for ?? '').localeCompare(String(b.scheduled_for ?? ''))).map(p => {
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
                        'relative flex min-h-9 w-full items-center gap-1.5 overflow-hidden rounded-tile border border-border bg-surface p-1 text-left focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue',
                        STAGE_DIM[p.facts.tone],
                        STAGE_RING[p.facts.tone],
                        drag.moving?.postId === p.id && 'rotate-1 ring-2 ring-accent-blue',
                        drag.saving.has(p.id) && 'animate-pulse opacity-60',
                      )}
                    >
                      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-[4px]">
                        <Thumb slide={p.slides[0] ?? null} label={p.item_title ?? 'Post'} className="h-full w-full" />
                        <StageDot tone={p.facts.tone} className="absolute left-0.5 top-0.5 h-2 w-2 border" />
                      </span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block text-[10px] font-semibold tabular-nums text-muted-foreground">{clockLabel(p.scheduled_for ?? null, tz)}</span>
                        <span className="block truncate text-[11px] font-semibold">{p.item_title ?? 'Post'}</span>
                      </span>
                      {warn && <AlertMark label={warn} className="h-3 w-3 shrink-0 text-[9px]" />}
                      {/* every network, small — a post for two is not a post for one (audit S14) */}
                      <NetworkLogos platforms={p.platforms} size={9} max={3} className="shrink-0" />
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type PreviewAccountRow = { id: string; platform: string; username?: string | null; name?: string | null; active?: boolean | null }

const CLIENT_MARK_CLS: Record<'amber' | 'red' | 'green' | 'grey', string> = {
  amber: 'bg-amber-400 text-black',
  red: 'bg-red-600 text-white',
  green: 'bg-emerald-600 text-white',
  grey: 'bg-ink/80 text-cream',
}

/** where the client stands on a post still to go out, on its tile (schedule-client-word-core) */
function ClientWordMark({ post, className }: { post: SchedulePostRow; className?: string }) {
  const word = clientWord(post)
  if (!word) return null
  return (
    <span data-client-word={word}
      className={cn('rounded-lg px-2 py-0.5 text-[10px] font-semibold leading-tight sm:text-[11px]', CLIENT_MARK_CLS[CLIENT_WORD_TONE[word]], className)}>
      {CLIENT_WORD_LABEL[word]}
    </span>
  )
}

/**
 * THE FEED AS IT WILL LOOK (the owner, 24 Sep 2026, pointing at Later's visual Instagram planner).
 *
 * The posts going out sit above the account's OWN feed as it is right now, read from the platform, so the next post
 * can be judged against what it will actually join. Only Ready to post and Booked in (`previewPosts`): a cancelled
 * post or one still being approved is not going to be in this feed (audit S8). What already went out is drawn once —
 * from the feed itself. Nothing here posts anything.
 *
 * EVERY CONNECTED PLATFORM, ONE AT A TIME (the owner, 27 Nov 2026: "client portal feed has all the platforms but here
 * there is none … its only showing instagram"): a button per account on Instagram, Facebook, TikTok and LinkedIn —
 * the portal's own four — and the feed of the one pressed. Instagram and TikTok are grids, Facebook and LinkedIn a
 * column of posts with their words, as the post window's Feed preview draws them.
 *
 * AND WHERE THE CLIENT STANDS, ON EACH TILE (the same day: "post anyway or approved and scheduled or awaiting client
 * or whatever status we have from post approval"): `clientWord`, beside the stage and the time.
 */
export function PreviewGrid({ posts, tz, onOpen, accounts, barAccountId }: {
  posts: SchedulePostRow[]
  tz: string
  onOpen: (post: SchedulePostRow) => void
  /** every account of the client; the Preview offers the connected ones on its four networks */
  accounts: readonly PreviewAccountRow[]
  /** the account picked in the bar above the calendar, when one is */
  barAccountId?: string | null
}) {
  const offered = previewAccounts(accounts)
  const [pickedId, setPickedId] = useState<string | null>(null)
  // a press in the bar above is the newer wish
  useEffect(() => { setPickedId(null) }, [barAccountId])
  const account = previewAccount(accounts, pickedId, barAccountId)
  const accountId = account?.id ?? null

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

  if (!account) {
    return <Empty>This client has no Instagram, Facebook, TikTok or LinkedIn account connected, so there is no feed to preview.</Empty>
  }
  const network = String(account.platform).toLowerCase()
  const name = networkName(network)
  // the feed was read: what already went out is drawn from it, not twice. WHILE IT IS BEING READ nothing posted is
  // drawn from our own rows either — they used to stand among what is going out for a few seconds, then drop away
  // (seen on the live page, 27 Nov 2026: Facebook showed 21 tiles "going out", then 7). Only a feed that could not
  // be read falls back to them.
  const feedShown = live === null || !reason
  // what has not gone out yet first, the latest at the top — the order it will actually appear in — then what is up
  const ordered = previewOrder(previewPosts(posts, new Set([account.id]), feedShown))
  const feed = live ?? []
  const shape = previewShape(network)
  const note = feedPreviewNote(network, feed.length, live === null ? 'reading' : reason ? 'unreadable' : 'read')
  const when = (p: SchedulePostRow) => formatInZone(p.scheduled_for ?? '', tz, 'full') ?? 'No time yet'
  const title = (p: SchedulePostRow) => `${p.item_title ?? 'Post'} · ${p.facts.label} · ${when(p)}${clientWord(p) ? ` · ${CLIENT_WORD_LABEL[clientWord(p)!]}` : ''}`
  const handleOf = (a: PreviewAccountRow) => a.username
    ? (a.platform === 'linkedin' || a.platform === 'facebook' ? a.username : `@${a.username}`)
    : a.name ?? networkName(a.platform)

  return (
    <div className="flex flex-col gap-3 pb-6" data-preview-feed={network}>
      <div role="tablist" aria-label="Which account's feed" className="flex flex-wrap gap-1.5">
        {offered.map(a => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === account.id} data-preview-account={a.platform}
            onClick={() => setPickedId(a.id)}
            className={cn('flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold',
              a.id === account.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface hover:bg-muted')}>
            <PlatformIcon platform={a.platform} size={16} />
            {handleOf(a)}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {ordered.length === 0
          ? `Nothing is going out on ${name} yet.`
          : `${ordered.length} ${ordered.length === 1 ? 'post' : 'posts'} going out on ${name}, latest first, above what is live there now.`}
        {reason === 'not_connected' ? ' Connect the account to see its own posts.' : ''}
      </p>

      {ordered.length === 0 && feed.length === 0 ? (
        <Empty>{live === null ? `Reading ${name}…` : `Nothing is going out on ${name} yet, and nothing is live there to show.`}</Empty>
      ) : shape === 'cards' ? (
        <ul className="flex max-w-[520px] flex-col gap-3">
          {ordered.map(p => {
            const cover = previewCover(p, account.id)
            const words = previewCaption(p, account.id)
            return (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p)} aria-label={title(p)} data-preview-post={p.id}
                  className={cn('flex w-full flex-col overflow-hidden rounded-inner border border-border bg-card text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue', STAGE_RING[p.facts.tone])}>
                  <span className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-0.5 text-[12px] font-semibold text-cream">
                      <StageDot tone={p.facts.tone} className="border-0" /> {p.facts.label} · {when(p)}
                    </span>
                    <ClientWordMark post={p} />
                  </span>
                  {words && <span className="px-3 pb-2.5"><span className="line-clamp-3 whitespace-pre-line break-words text-[14px]">{words}</span></span>}
                  {cover && <span className="relative block aspect-[4/5] max-h-[420px] w-full overflow-hidden bg-foreground/[0.06]"><Thumb slide={cover as never} label={p.item_title ?? 'Post'} className="absolute inset-0 h-full w-full" /></span>}
                </button>
              </li>
            )
          })}
          {feed.map(t => (
            <li key={t.id} className="overflow-hidden rounded-inner border border-border bg-card">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-[12px] text-muted-foreground">
                <span>Posted{t.at ? ` · ${formatInZone(t.at, tz, 'full') ?? ''}` : ''}</span>
                {t.permalink && <a href={t.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4">Open</a>}
              </div>
              {t.caption && <div className="px-3 pb-2.5"><p className="line-clamp-3 whitespace-pre-line break-words text-[14px]">{t.caption}</p></div>}
              {t.thumbnail && (
                <div className="relative aspect-[4/5] max-h-[420px] w-full overflow-hidden bg-foreground/[0.06]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.thumbnail} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        // BIG ENOUGH TO READ: the grid takes the room there is, up to the width a profile is read at
        <div className={cn('grid w-full grid-cols-3 gap-1', shape === 'tall-grid' ? 'max-w-[660px]' : 'max-w-[780px]')}>
          {ordered.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpen(p)}
              aria-label={title(p)}
              title={title(p)}
              data-preview-post={p.id}
              className={cn('relative overflow-hidden border border-border focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue',
                shape === 'tall-grid' ? 'aspect-[9/16]' : 'aspect-[4/5]', STAGE_RING[p.facts.tone])}
            >
              <Thumb slide={(previewCover(p, account.id) ?? null) as never} label={p.item_title ?? 'Post'} className="h-full w-full" />
              {/* ON A PHONE a tile is about 120px wide: the mark wraps instead of being cut ("Client: not appr…", seen in the
                  render, 27 Nov 2026), and the badge keeps the time — the dot beside it says the stage */}
              <ClientWordMark post={p} className="absolute left-1 top-1 max-w-[calc(100%-8px)] text-left sm:left-1.5 sm:top-1.5" />
              <span className="absolute bottom-1 left-1 right-1 flex items-center justify-center gap-1.5 rounded-lg bg-ink/80 px-1.5 py-1 text-center text-[10px] font-semibold leading-tight text-cream sm:bottom-1.5 sm:left-1.5 sm:right-1.5 sm:px-2 sm:text-[11px]">
                <StageDot tone={p.facts.tone} className="border-0" />
                <span><span className="hidden sm:inline">{p.facts.label} · </span>{when(p)}</span>
              </span>
            </button>
          ))}
          {/* the account's own posts, as they are now — opens the real post, never this dashboard's copy */}
          {feed.map(t => (
            <a
              key={t.id}
              href={t.permalink ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={`Already posted${t.at ? ` · ${formatInZone(t.at, tz, 'full') ?? ''}` : ''}`}
              aria-label={`Already posted: ${t.caption.slice(0, 80) || 'post'}`}
              className={cn('relative overflow-hidden border border-border bg-foreground/[0.06]', shape === 'tall-grid' ? 'aspect-[9/16]' : 'aspect-[4/5]')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.thumbnail && <img src={t.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />}
              {t.mediaType === 'video' && <Play className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white drop-shadow" aria-hidden />}
              {t.mediaType === 'carousel' && <Copy className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white drop-shadow" aria-hidden />}
            </a>
          ))}
        </div>
      )}
      {note && <p className="text-[13px] text-muted-foreground" data-preview-note>{note}</p>}
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
