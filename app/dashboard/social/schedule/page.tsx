'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Images } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  matchesChannel, nowLineTop, onOneOfDays, scheduleWeekGrid, type SuggestedTime,
} from '@/app/lib/social-schedule-core'
import { dayKeyInZone, zoneLabel } from '@/app/lib/timezone-core'
import { loadFailedMessage } from '@/app/lib/support-core'
import { useRole } from '../../useRole'
import { usePersistedChoice } from '../../production/workHooks'
import PageTitle from '../../ui/PageTitle'
import type { ScopeViewer } from '@/app/lib/scope-client'
import MediaRail from './MediaRail'
import ProfilesBar, { VIEWS, type ScheduleViewName } from './ProfilesBar'
import WeekGrid, { StoriesStrip } from './WeekGrid'
import { ListView, MonthGrid, PreviewGrid, StoriesView } from './views'
import { useSchedulePosts } from './useSchedulePosts'
import { monthLabel, rangeLabel, shiftDays, shiftMonths } from './week-nav'

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
 *  2. THE STATUS IS DERIVED, NEVER STORED. `postTileFacts` reads the item's
 *     approval and THIS POST's jobs; a tile cannot claim "scheduled" because a
 *     row said so an hour ago, and an old post's cancelled job never speaks
 *     for the one that replaced it.
 *  3. IT IS LIVE. Everything on it is a database listener, so an approval
 *     landing in another tab repaints this week without a refresh.
 *
 * The layout is the approved mockup's: the media rail is a full-height column
 * pinned to the left of the calendar, and the whole thing fills the window —
 * a calendar that stops half way down the screen looks broken.
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
  /** any day in the week (or month) on screen, as a 'YYYY-MM-DD' key */
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
  const monthView = view === 'Month'
  const monthKey = (anchor ?? todayKey ?? '').slice(0, 7)

  /** the channel the profiles bar is filtering to, as the core reads it */
  const selected = useMemo(
    () => data.accounts.find(a => a.id === channel) ?? null, [data.accounts, channel])

  /** every post for this client on the selected channel */
  const channelPosts = useMemo(
    () => data.posts.filter(p => matchesChannel(p.channels, selected)),
    [data.posts, selected])

  const weekKeys = useMemo(() => new Set(grid.days.map(d => d.iso)), [grid.days])

  const inWeek = useMemo(
    () => channelPosts.filter(p => onOneOfDays(p.scheduled_for, tz, weekKeys)),
    [channelPosts, weekKeys, tz])

  const weekNotes = useMemo(
    () => data.notes.filter(n => onOneOfDays(n.at, tz, weekKeys)),
    [data.notes, weekKeys, tz])

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
  const network = selected?.platform ?? data.accounts[0]?.platform ?? 'instagram'
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
    return suggested.filter(s => {
      if (!weekKeys.has(s.dayKey)) return false
      const at = Date.parse(s.iso)
      return !taken.some(t => Math.abs(t - at) < 45 * 60_000)
    })
  }, [suggested, inWeek, weekKeys])

  /** where "now" sits on the grid, in the client's zone */
  const nowTop = useMemo(() => nowLineTop(grid, now), [grid, now])

  const step = (direction: 1 | -1) => {
    const from = anchor ?? todayKey ?? grid.days[0].iso
    setAnchor(monthView ? shiftMonths(from, direction) : shiftDays(grid.days[0].iso, direction * 7))
  }

  const rail = (
    <MediaRail
      media={data.media}
      waiting={data.waiting}
      loading={data.loading}
    />
  )

  if (noAccount) {
    return <p className="py-10 text-[15px] text-muted-foreground">{loadFailedMessage('the schedule')}</p>
  }

  return (
    // the shell's header, the page's top padding and its bottom padding come
    // to 9rem; taking them off the viewport is what makes the rail and the
    // grid reach the bottom of the window instead of stopping half way
    <div className="flex h-[calc(100vh-9rem)] min-h-[560px] flex-col">
      <PageTitle
        title="Schedule"
        summary="One client's week. Approved media on the left, what is going out on the right."
      />

      <div className="flex min-h-0 flex-1">
        {/* The rail is a full-height column beside the calendar on a desktop
            and a bottom sheet on a phone: at 390px a 236px column would leave
            no calendar at all. */}
        <aside className="hidden w-[236px] shrink-0 flex-col border-r border-border py-1 pr-3.5 lg:flex">
          {rail}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:pl-4">
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

          {/* date bar */}
          <div className="flex items-center gap-3 py-2">
            <button
              type="button"
              onClick={() => setAnchor(todayKey)}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
            >
              Today
            </button>
            <button
              type="button"
              aria-label={monthView ? 'Previous month' : 'Previous week'}
              onClick={() => step(-1)}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
            >
              <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={monthView ? 'Next month' : 'Next week'}
              onClick={() => step(1)}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
            >
              <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <span className="text-[16px] font-semibold">
              {monthView ? monthLabel(anchor ?? todayKey ?? '') : rangeLabel(grid.days)}
            </span>

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
            <Skeleton className="min-h-0 w-full flex-1 rounded-inner" />
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
              <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
                <ListView posts={inWeek} tz={tz} />
              </div>
            </>
          ) : view === 'Month' ? (
            <MonthGrid
              month={monthKey}
              posts={channelPosts}
              tz={tz}
              todayKey={todayKey}
            />
          ) : view === 'List' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ListView posts={inWeek} tz={tz} />
            </div>
          ) : view === 'Preview' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PreviewGrid posts={channelPosts} tz={tz} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StoriesView posts={stories} tz={tz} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
