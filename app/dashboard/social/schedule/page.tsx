'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Images } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  scheduleWeekGrid, type SuggestedTime,
} from '@/app/lib/social-schedule-core'
import { dayKeyInZone, wallTimeIn, zoneLabel } from '@/app/lib/timezone-core'
import { loadFailedMessage } from '@/app/lib/support-core'
import { useRole } from '../../useRole'
import { usePersistedChoice } from '../../production/workHooks'
import type { ScopeViewer } from '@/app/lib/scope-client'
import MediaRail from './MediaRail'
import ProfilesBar, { VIEWS, type ScheduleViewName } from './ProfilesBar'
import WeekGrid, { StoriesStrip } from './WeekGrid'
import { ListView, MonthGrid, PreviewGrid, StoriesView } from './views'
import { useSchedulePosts } from './useSchedulePosts'
import { rangeLabel, shiftDays } from './week-nav'

/**
 * THE SCHEDULE: one client's week, media on the left, hours on the right.
 *
 * Read-only in this pass — it shows what is planned and where each post
 * stands. Starting a post, dragging one to a new time and writing a note all
 * arrive with the composer, and the page says so rather than offering a
 * control that does nothing.
 *
 * Three things it refuses to get wrong:
 *
 *  1. EVERY TIME IS THE CLIENT'S. The columns, the now-line and the labels are
 *     all in `clients.timezone` — a posting time is a fact about the audience,
 *     not about whoever is looking at the screen.
 *  2. THE STATUS IS DERIVED, NEVER STORED. `mirrorStatus` reads the item's
 *     approval and the publish jobs; a tile cannot claim "scheduled" because
 *     a row said so an hour ago.
 *  3. IT IS LIVE. Everything on it is a database listener, so an approval
 *     landing in another tab repaints this week without a refresh.
 */

const CLIENT_KEY = 'md-schedule-client'
const VIEW_KEY = 'md-schedule-view'

export default function SchedulePage() {
  const { me, noAccount } = useRole()
  const viewer: ScopeViewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])

  const [clientId, setClientId] = useState<string | null>(null)
  const [channel, setChannel] = useState<string | null>(null)
  const [view, setView] = usePersistedChoice<ScheduleViewName>(VIEW_KEY, VIEWS, 'Week', 'view')
  /** any day in the week on screen, as a 'YYYY-MM-DD' key */
  const [anchor, setAnchor] = useState<string | null>(null)
  /** the clock, for the now-line — a minute is close enough to "now" */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const data = useSchedulePosts(viewer, clientId)

  // the client picked last time, then the first one this person works for —
  // a page that opens on "pick a client" every morning is a page with a step
  // in front of it
  useEffect(() => {
    if (clientId || data.clients.length === 0) return
    let saved: string | null = null
    try { saved = localStorage.getItem(CLIENT_KEY) } catch { /* private mode */ }
    const known = saved && data.clients.some(c => c.id === saved) ? saved : data.clients[0].id
    setClientId(known)
  }, [clientId, data.clients])

  const pickClient = (id: string) => {
    setClientId(id)
    setChannel(null)
    try { localStorage.setItem(CLIENT_KEY, id) } catch { /* private mode */ }
  }

  const tz = data.tz
  const todayKey = dayKeyInZone(now, tz)
  // keyed on the DAY, not the minute: the clock ticking must not rebuild the
  // week under every memo that reads it
  const grid = useMemo(
    () => scheduleWeekGrid({ start: anchor ?? todayKey ?? '', tz }),
    [anchor, todayKey, tz])

  /** the week's posts, narrowed to one channel when a profile is selected */
  const weekPosts = useMemo(() => {
    const platform = data.accounts.find(a => a.id === channel)?.platform ?? null
    return data.posts.filter(p => {
      if (channel && !(p.channels.includes(channel) || (platform && p.channels.includes(platform)))) return false
      return true
    })
  }, [data.posts, data.accounts, channel])

  const inWeek = useMemo(() => {
    const keys = new Set(grid.days.map(d => d.iso))
    return weekPosts.filter(p => {
      const key = dayKeyInZone(p.scheduled_for ?? null, tz)
      return key !== null && keys.has(key)
    })
  }, [weekPosts, grid.days, tz])

  const weekNotes = useMemo(() => {
    const keys = new Set(grid.days.map(d => d.iso))
    return data.notes.filter(n => {
      const key = dayKeyInZone(n.at, tz)
      return key !== null && keys.has(key)
    })
  }, [data.notes, grid.days, tz])

  const stories = useMemo(
    () => inWeek.filter(p => String(p.item_type ?? '').toLowerCase() === 'story'), [inWeek])

  /**
   * Good times to post.
   *
   * The one thing on this page that is fetched rather than subscribed: it is
   * ninety days of results averaged into three hours a day, it changes when a
   * post lands and not before, and the rule that computes it needs analytics
   * rows this page has no other reason to hold.
   */
  const [suggested, setSuggested] = useState<SuggestedTime[]>([])
  const network = data.accounts.find(a => a.id === channel)?.platform
    ?? data.accounts[0]?.platform ?? 'instagram'
  useEffect(() => {
    if (!clientId) { setSuggested([]); return }
    let cancelled = false
    const url = `/api/social/schedule/suggested?clientId=${encodeURIComponent(clientId)}`
      + `&network=${encodeURIComponent(network)}&tz=${encodeURIComponent(tz)}`
    fetch(url)
      .then(r => (r.ok ? r.json() : { times: [] }))
      .then(json => { if (!cancelled) setSuggested((json.times ?? []) as SuggestedTime[]) })
      .catch(() => { /* a missing suggestion is a missing hint, not a broken week */ })
    return () => { cancelled = true }
  }, [clientId, network, tz])

  /** a slot is a hint about an EMPTY time — one within the hour of a post
   *  already there is noise */
  const weekSlots = useMemo(() => {
    const taken = inWeek
      .map(p => (p.scheduled_for ? Date.parse(p.scheduled_for) : NaN))
      .filter(Number.isFinite)
    const keys = new Set(grid.days.map(d => d.iso))
    return suggested.filter(s => {
      if (!keys.has(s.dayKey)) return false
      const at = Date.parse(s.iso)
      return !taken.some(t => Math.abs(t - at) < 45 * 60_000)
    })
  }, [suggested, inWeek, grid.days])

  /** where "now" sits on the grid, in the client's zone */
  const nowTop = useMemo(() => {
    const wall = wallTimeIn(now, tz)
    if (!wall) return null
    const minutes = wall.hour * 60 + wall.minute
    if (minutes < grid.fromHour * 60 || minutes > grid.toHour * 60) return null
    return grid.headerPx + ((minutes - grid.fromHour * 60) / 60) * grid.rowPx
  }, [now, tz, grid])

  const rail = (
    <MediaRail
      media={data.media}
      waiting={data.waiting}
      clientName={data.client?.name ?? null}
      loading={data.loading}
    />
  )

  if (noAccount) {
    return <p className="py-10 text-[15px] text-muted-foreground">{loadFailedMessage('the schedule')}</p>
  }

  return (
    <div className="flex flex-col">
      <ProfilesBar
        clients={data.clients}
        clientId={clientId}
        onClient={pickClient}
        accounts={data.accounts}
        channel={channel}
        onChannel={setChannel}
        view={view}
        onView={setView}
      />

      <div className="flex min-h-0 flex-1 gap-4 pt-3">
        {/* The rail is a column on a desktop and a bottom sheet on a phone:
            at 390px a 236px column would leave no calendar at all. */}
        <aside className="hidden w-[236px] shrink-0 flex-col rounded-card border border-border bg-surface p-3.5 lg:flex">
          {rail}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* date bar */}
          <div className="flex items-center gap-3 pb-3">
            <button
              type="button"
              onClick={() => setAnchor(todayKey)}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setAnchor(shiftDays(grid.days[0].iso, -7))}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
            >
              <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setAnchor(shiftDays(grid.days[0].iso, 7))}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
            >
              <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <span className="text-[16px] font-semibold">{rangeLabel(grid.days)}</span>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-[12px] font-semibold text-muted-foreground sm:inline">
                {zoneLabel(tz)}
              </span>
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold lg:hidden"
                  >
                    <Images className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                    Media
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[85vh] bg-popover p-4">
                  <SheetTitle className="pb-2 text-section-title">Media</SheetTitle>
                  <div className="h-[65vh]">{rail}</div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {data.error ? (
            <p className="rounded-inner border border-border bg-surface p-6 text-[15px] text-muted-foreground">
              {loadFailedMessage('the schedule')}
            </p>
          ) : data.loading ? (
            <Skeleton className="h-[520px] w-full rounded-inner" />
          ) : view === 'Week' ? (
            <>
              {/* On a phone the week grid becomes the list: seven 44px columns
                  in 390px is four pixels a post. */}
              <div className="hidden min-h-0 flex-1 flex-col md:flex">
                <StoriesStrip stories={stories} tz={tz} />
                <WeekGrid
                  grid={grid}
                  posts={inWeek}
                  notes={weekNotes}
                  suggested={weekSlots}
                  todayKey={todayKey}
                  nowTop={nowTop}
                />
              </div>
              <div className="md:hidden">
                <ListView posts={inWeek} tz={tz} />
              </div>
            </>
          ) : view === 'Month' ? (
            <MonthGrid
              month={grid.days[3].iso.slice(0, 7)}
              posts={weekPosts}
              tz={tz}
              todayKey={todayKey}
            />
          ) : view === 'List' ? (
            <ListView posts={inWeek} tz={tz} />
          ) : view === 'Preview' ? (
            <PreviewGrid posts={weekPosts} tz={tz} />
          ) : (
            <StoriesView posts={stories} tz={tz} />
          )}
        </main>
      </div>
    </div>
  )
}
