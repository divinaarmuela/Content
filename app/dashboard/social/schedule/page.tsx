'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Images, StickyNote, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  matchesChannel, mayEditNote, nowLineTop, onOneOfDays, scheduleWeekGrid,
} from '@/app/lib/social-schedule-core'
import { dayKeyInZone, toZonedInput, zoneLabel } from '@/app/lib/timezone-core'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import { refusedFilesLine, usableUploadFiles } from '@/app/lib/schedule-upload-core'
import type { Slide } from '@/app/lib/version-files-core'
import { uploadFiles } from '../../uploadQueue'
import { useRole } from '../../useRole'
import { usePersistedChoice } from '../../production/workHooks'
import PageTitle from '../../ui/PageTitle'
import type { ScopeViewer } from '@/app/lib/scope-client'
import type { ScheduleNote, SocialAccount } from '@/lib/db-types'
import { toast } from 'sonner'
import MediaRail from './MediaRail'
import NoteEditor from './NoteEditor'
import { useDragSchedule } from './useDragSchedule'
import EditMediaLauncher from './EditMediaLauncher'
import { CLIENT_KEY, useComposeFlow, useSuggestedTimes } from './useComposeFlow'
import ProfilesBar, { VIEWS, type ScheduleViewName } from './ProfilesBar'
import { brandFor } from '../PlatformIcon'
import WeekGrid, { StoriesStrip, WEEK_ROW_PX } from './WeekGrid'
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

const VIEW_KEY = 'md-schedule-view'

export default function SchedulePage() {
  const { me, noAccount } = useRole()
  const viewer: ScopeViewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])

  /**
   * ARRIVING FROM A LINK — the bell, or the "approve this post" email.
   *
   * `?client=…&item=…` opens this page on that client with the composer
   * already on that piece, which is where the preview and the two answers
   * are. Read ONCE, lazily, as the initial state rather than in an effect:
   * the "client you had last time" effect below would otherwise race it and
   * land the reviewer on somebody else's week.
   */
  const [clientId, setClientId] = useState<string | null>(
    () => (typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('client')) || null)
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

  /** the channel the profiles bar is filtering to, as the core reads it */
  const selected = useMemo(
    () => data.accounts.find(a => a.id === channel) ?? null, [data.accounts, channel])

  const suggested = useSuggestedTimes(
    clientId, selected?.platform ?? data.accounts[0]?.platform ?? 'instagram', data.tz)

  /**
   * THE COMPOSER, THE MEDIA CHOOSER AND THE IMAGE EDITOR — the shared flow.
   *
   * `useComposeFlow` owns all three windows and the state behind them, so the
   * Scheduler page's one button runs THIS flow rather than a second copy of
   * it. Everything below is an opener: the rail, an empty slot, a suggested
   * time, a tile, a piece dragged onto a day, a file dropped on one.
   */
  const flow = useComposeFlow({
    clientId, data, role: me?.role ?? null, suggested,
    // "Show on calendar" from the window that follows a press
    onShowDay: key => setAnchor(key),
  })

  /** …and the piece that link named, opened once the page knows about it */
  const arrivedOn = useRef<string | null>(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('item'))
  useEffect(() => {
    const itemId = arrivedOn.current
    if (!itemId) return
    // wait until the client's own pieces are here — opening on a piece the
    // page has not loaded yet is a window with nothing in it
    if (!data.posts.some(p => p.item_id === itemId)
      && !data.media.some(m => m.itemId === itemId)) return
    arrivedOn.current = null
    flow.openItem(itemId)
  }, [data.posts, data.media, flow.openItem])

  /** what is happening to a file dropped straight onto the calendar */
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  /**
   * MOVING A POST BY HAND.
   *
   * The hook does the mouse, the finger and the arrow keys; the only thing
   * the page owns is the save. The message on a refusal is the SERVER's own
   * sentence — it is the one that knows a scheduled post could not be pulled
   * back off the provider, and rewriting it here would only make the screen
   * and the API disagree about why.
   */
  const drag = useDragSchedule({
    tz: data.tz,
    onMove: async (postId, at) => {
      const res = await fetch(`/api/social/schedule/${postId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, error: friendlyError(String(json?.error ?? ''), 'Schedule') }
      }
      return { ok: true }
    },
  })

  /**
   * A note being written, and whether the next click on the week makes one.
   *
   * Two ways in, because neither on its own covers everybody: the visible
   * "Add note" button (armed, then click the time), and a right-click or a
   * long press straight onto the slot.
   */
  const [noteDraft, setNoteDraft] = useState<{ at: string; note: ScheduleNote | null } | null>(null)
  const [noteMode, setNoteMode] = useState(false)
  const [noteBusy, setNoteBusy] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const openNoteAt = (at: string) => {
    setNoteError(null)
    setNoteMode(false)
    setNoteDraft({ at, note: null })
  }
  const openNote = (note: ScheduleNote) => {
    setNoteError(null)
    setNoteMode(false)
    setNoteDraft({ at: note.at, note })
  }

  const saveNote = async (text: string) => {
    if (!noteDraft || !clientId) return
    setNoteBusy(true)
    setNoteError(null)
    try {
      const res = noteDraft.note
        ? await fetch('/api/social/schedule/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: noteDraft.note.id, text }),
        })
        : await fetch('/api/social/schedule/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, at: noteDraft.at, text }),
        })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNoteError(friendlyError(String(json?.error ?? ''), 'Schedule'))
        return
      }
      // the note itself arrives on the listener — nothing here refetches
      setNoteDraft(null)
    } catch {
      setNoteError(loadFailedMessage('that note'))
    } finally {
      setNoteBusy(false)
    }
  }

  const deleteNote = async () => {
    const note = noteDraft?.note
    if (!note) return
    setNoteBusy(true)
    setNoteError(null)
    try {
      const res = await fetch(`/api/social/schedule/notes?id=${encodeURIComponent(note.id)}`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNoteError(friendlyError(String(json?.error ?? ''), 'Schedule'))
        return
      }
      setNoteDraft(null)
    } catch {
      setNoteError(loadFailedMessage('that note'))
    } finally {
      setNoteBusy(false)
    }
  }

  /**
   * Who may change or remove a note: `mayEditNote`, which is the SAME function
   * the server enforces in `editNote`/`removeNote` — not a copy of its rule.
   * A copy is how a Delete button that answers 403 gets drawn.
   *
   * A NEW note is always the writer's own, so it is always editable; there is
   * no row to ask about yet.
   */
  const mayChangeNote = (note: ScheduleNote | null): boolean =>
    (note ? mayEditNote(me, note) : true)
  const mayRemoveNote = (note: ScheduleNote | null): boolean =>
    Boolean(note) && mayChangeNote(note)

  /**
   * A FILE DRAGGED OFF THE DESKTOP ONTO A DAY OR A TIME.
   *
   * The same two steps the New post window takes, with no window in between:
   * the bytes go to storage, the server makes the piece and the post, and the
   * composer opens at the time the file was dropped on. Anything that refuses
   * says so where the eye already is.
   */
  const createFromFiles = async (files: File[], at: string | null) => {
    if (!clientId) return
    const { keep, refused } = usableUploadFiles(files)
    const refusal = refusedFilesLine(refused)
    if (keep.length === 0) { setUploadNote(refusal ?? 'Drop a photo or a video.'); return }
    setUploadNote(refusal ?? 'Uploading…')
    try {
      const { done } = uploadFiles(keep as unknown as File[], {
        group: `calendar-drop:${clientId}`, purpose: 'social',
      })
      const landed = await done
      const slides: Slide[] = landed.map(({ file, url }) => ({
        url,
        name: file.name,
        type: file.type.startsWith('video/') ? 'video' : 'image',
        bytes: file.size,
        source: 'upload',
      }))
      const res = await fetch('/api/social/schedule/from-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, files: slides, scheduled_for: at }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploadNote(friendlyError(String(json?.error ?? ''), 'Schedule'))
        return
      }
      setUploadNote(null)
      flow.openMade({
        itemId: String(json.item_id),
        postId: String(json.post?.id ?? ''),
        title: String(json.item_title ?? 'Post'),
        contentType: String(json.content_type ?? ''),
        slides: (json.post?.slides ?? slides) as Slide[],
        needsApproval: Boolean(json.needs_approval),
      }, at)
    } catch (e) {
      setUploadNote(friendlyError(e instanceof Error ? e.message : '', 'the upload'))
    }
  }

  // The Scheduler page opens the SAME flow in place now — it no longer sends
  // anybody here to write a post. The listener stays for any older link or
  // tab still asking this page to open its composer.
  useEffect(() => {
    const open = () => flow.openAt(null)
    window.addEventListener('mdm:new-post', open)
    return () => window.removeEventListener('mdm:new-post', open)
  }, [flow.openAt])

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
    // 72px an hour: a 64px tile sits INSIDE its hour band. At the core's
    // 44px default an 80px tile straddled two hour lines and the week read
    // as a pile (the owner, 9 Sep 2026: "the lines get cramped")
    // the whole day: a midnight post was off the grid and could not be
    // dragged or dropped (the owner, 9 Sep 2026: "want to schedule it at
    // 12 am but no way"); the grid opens scrolled to 6 am
    () => scheduleWeekGrid({ start: anchor ?? todayKey ?? '', tz, rowPx: WEEK_ROW_PX, fromHour: 0, toHour: 23 }),
    [anchor, todayKey, tz])
  const monthView = view === 'Month'
  const monthKey = (anchor ?? todayKey ?? '').slice(0, 7)

  /**
   * The posts, with a move that has just been made shown where it was
   * dropped.
   *
   * A tile that hangs where it was until the database answers reads as "that
   * did not work" and gets dragged again. The drawn time is dropped the moment
   * the SERVER answers — the listener is authoritative from that instant —
   * and `settle` clears anything left over once the live row agrees or the
   * post leaves the page, so this browser's memory of what it did can never
   * outlive it and paint over somebody else's move.
   */
  const livePosts = useMemo(() => data.posts.map(p => {
    const at = drag.optimistic[p.id]
    return at && at !== p.scheduled_for ? { ...p, scheduled_for: at } : p
  }), [data.posts, drag.optimistic])

  useEffect(() => {
    drag.settle(data.posts)
  }, [data.posts, drag.settle])

  /** every post for this client on the selected channel */
  const channelPosts = useMemo(
    () => livePosts.filter(p => matchesChannel(p.channels, selected)),
    [livePosts, selected])

  const weekKeys = useMemo(() => new Set(grid.days.map(d => d.iso)), [grid.days])

  const inWeek = useMemo(
    () => channelPosts.filter(p => onOneOfDays(p.scheduled_for, tz, weekKeys)),
    [channelPosts, weekKeys, tz])
  /** the week's posts AND the ones with no time yet: the List has a "No time
   *  yet" group for exactly those, and the week filter used to keep every
   *  one of them out of it — "a draft nobody can find is a draft nobody
   *  finishes" (the owner, 9 Sep 2026: "saving as draft doesn't tell the
   *  user"). Only the List draws them; a grid has no cell for no-time. */
  const inWeekOrUntimed = useMemo(
    () => channelPosts.filter(p => !p.scheduled_for || onOneOfDays(p.scheduled_for, tz, weekKeys)),
    [channelPosts, weekKeys, tz])

  const weekNotes = useMemo(
    () => data.notes.filter(n => onOneOfDays(n.at, tz, weekKeys)),
    [data.notes, weekKeys, tz])

  const stories = useMemo(
    () => inWeek.filter(p => String(p.item_type ?? '').toLowerCase() === 'story'), [inWeek])

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

  /**
   * The time a drop on a DAY means.
   *
   * A month cell has no hour in it, so a piece dropped there has to start
   * somewhere: this client's own best time where their numbers give one, and
   * the network's sensible default before that — the same list the week grid
   * draws its faint slots from, rather than a second opinion invented here.
   */
  const defaultPostTime = useMemo(() => {
    const first = suggested[0]?.iso
    const hhmm = first ? toZonedInput(first, tz).slice(11, 16) : ''
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : '11:00'
  }, [suggested, tz])

  /** where "now" sits on the grid, in the client's zone */
  const nowTop = useMemo(() => nowLineTop(grid, now), [grid, now])

  const step = (direction: 1 | -1) => {
    const from = anchor ?? todayKey ?? grid.days[0].iso
    setAnchor(monthView ? shiftMonths(from, direction) : shiftDays(grid.days[0].iso, direction * 7))
  }

  /** THE SAME CONNECT FLOW THE SOCIAL CHANNELS PAGE RUNS — a full navigation
   *  to the network's sign-in, because the consent screens refuse to be
   *  framed and popups get blocked. From the icon, for a scheduler too. */
  const connect = async (platform: string) => {
    if (!clientId) return
    try {
      const res = await fetch('/api/social/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // …and come back HERE, not to the Social channels page (the owner,
        // 9 Sep 2026: "I clicked the Facebook icon on Schedule and it
        // brought me to the Social page instead of connecting it here")
        body: JSON.stringify({ clientId, platform, returnTo: 'schedule' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? ''))
      window.location.href = String(json.authUrl)
    } catch (e) {
      toast.error(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
    }
  }
  const reconnect = (account: SocialAccount) => connect(String(account.platform))

  /** no login for it here: email the client their own connect link, with
   *  Reconnect waiting on that network. Kept, not wired: the owner does not
   *  want clients sent that link from the Schedule page (9 Sep 2026). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _askClient = async (account: SocialAccount) => {
    if (!clientId) return
    try {
      const res = await fetch('/api/social/connect/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, platform: String(account.platform), reason: 'reconnect' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? ''))
      const who = (json.recipients as { email: string }[] | undefined)?.map(r => r.email).join(', ')
      toast.success(json.sent > 0 ? `Asked ${who} to reconnect ${brandFor(String(account.platform)).label}.` : 'Nothing was sent — check the client’s email settings')
    } catch (e) {
      toast.error(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
    }
  }

  /**
   * BACK FROM THE NETWORK. The provider attaches the account a moment after
   * it sends the person back, so the first re-read can honestly come back
   * empty — the same short retry the Social channels page runs, so the new
   * channel simply appears in the bar rather than after a refresh.
   */
  useEffect(() => {
    if (!clientId) return
    const params = new URLSearchParams(window.location.search)
    const platform = params.get('connected')
    if (!platform || params.get('clientId') !== clientId) return
    let cancelled = false
    const clearQuery = () => {
      params.delete('connected'); params.delete('clientId')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
    ;(async () => {
      let found = 0
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          const res = await fetch('/api/social/connect', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId }),
          })
          const json = await res.json().catch(() => ({}))
          found = Number(json?.synced ?? 0)
          if (found > 0) break
        } catch { /* try again */ }
        await new Promise(r => setTimeout(r, 1500))
      }
      if (cancelled) return
      clearQuery()
      toast[found > 0 ? 'success' : 'message'](found > 0
        ? `${brandFor(platform).label} connected — it is on the bar now.`
        : `${brandFor(platform).label} is not showing yet — give it a moment, then reload.`)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const rail = (
    <MediaRail
      media={data.media}
      waiting={data.waiting}
      loading={data.loading}
      role={me?.role ?? null}
      postWithoutApproval={data.postWithoutApproval}
      onNew={() => flow.openAt(weekSlots[0]?.iso ?? null)}
      onPick={(m, slides) => flow.openNew(m, null, slides ?? null)}
      onApprove={flow.approve}
    />
  )

  if (noAccount) {
    return <p className="py-10 text-[15px] text-muted-foreground">{loadFailedMessage('the schedule')}</p>
  }

  return (
    // the shell publishes what its chrome costs as `--dbx-chrome`; taking that
    // off the viewport is what makes the rail and the grid reach the bottom of
    // the window instead of stopping half way. The 9rem fallback is only for a
    // render outside the shell (a test, a storybook), never the source of truth.
    <div className="flex h-[calc(100vh-var(--dbx-chrome,9rem))] min-h-[560px] flex-col">
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
            accounts={data.allAccounts}
            channel={channel}
            onChannel={setChannel}
            view={view}
            onView={setView}
            onReconnect={reconnect}
            onConnect={connect}
            // NOT the client's job (the owner, 9 Sep 2026: "client might
            // login from the public url but we prefer not to send them
            // that"). The invite route stays for the Social channels page;
            // the Schedule popover offers Reconnect and Check again only.
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
              {view === 'Week' && (
                <button
                  type="button"
                  aria-pressed={noteMode}
                  onClick={() => { setNoteDraft(null); setNoteMode(v => !v) }}
                  className={cn(
                    'hidden min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold md:flex',
                    noteMode ? 'bg-foreground text-background' : 'bg-surface hover:bg-muted',
                  )}
                >
                  <StickyNote className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                  {noteMode ? 'Click the time for your note' : 'Add note'}
                </button>
              )}
              {/* Fixing a picture and seeing who is on this client are both
                  things somebody does FROM the week, so both live on the week's
                  own toolbar rather than in a settings page nobody finds. */}
              <EditMediaLauncher
                media={data.media}
                posts={data.posts}
                mayApprove={data.postWithoutApproval}
                onEdit={flow.edit}
                className="hidden md:flex"
              />
              <Link
                href="/dashboard/social/schedule/access"
                className="hidden min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted md:flex"
              >
                <Users className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                Accounts and access
              </Link>
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
                  {/* The phone's way in to both. On a 390px toolbar there is
                      room for the date, the arrows and one button, so the two
                      that do not belong on the calendar itself live in the
                      sheet that is already open in a thumb's reach — rather
                      than not existing on a phone at all, which is where they
                      were. */}
                  <div className="flex flex-wrap gap-1.5 pb-3">
                    <EditMediaLauncher
                      media={data.media}
                      posts={data.posts}
                      mayApprove={data.postWithoutApproval}
                      onEdit={flow.edit}
                    />
                    <Link
                      href="/dashboard/social/schedule/access"
                      className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
                    >
                      <Users className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                      Accounts and access
                    </Link>
                  </div>
                  <div className="h-[58vh]">{rail}</div>
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
                  onSlot={flow.openAt}
                  onOpen={flow.openPost}
                  onDropItem={(itemId, iso) => {
                    const media = data.media.find(m => m.itemId === itemId)
                    if (media) flow.openNew(media, iso)
                  }}
                  onDropFiles={(files, iso) => void createFromFiles(files, iso)}
                  drag={drag}
                  noteMode={noteMode}
                  noteDraft={noteDraft}
                  onNoteAt={openNoteAt}
                  onNoteOpen={openNote}
                  noteEditor={noteDraft && (
                    <NoteEditor
                      // keyed on the note: opening a second note in the same
                      // column must not keep the first one's words
                      key={noteDraft.note?.id ?? noteDraft.at}
                      at={noteDraft.at}
                      tz={tz}
                      text={noteDraft.note?.text ?? ''}
                      canEdit={mayChangeNote(noteDraft.note)}
                      canDelete={mayRemoveNote(noteDraft.note)}
                      busy={noteBusy}
                      error={noteError}
                      onSave={text => void saveNote(text)}
                      onDelete={noteDraft.note ? () => void deleteNote() : undefined}
                      onClose={() => { setNoteDraft(null); setNoteError(null) }}
                    />
                  )}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
                <ListView posts={inWeekOrUntimed} tz={tz} todayKey={todayKey} onOpen={flow.openPost} />
              </div>
            </>
          ) : view === 'Month' ? (
            <MonthGrid
              month={monthKey}
              posts={channelPosts}
              tz={tz}
              todayKey={todayKey}
              onOpen={flow.openPost}
              drag={drag}
              defaultTime={defaultPostTime}
              onDropItem={(itemId, iso) => {
                const media = data.media.find(m => m.itemId === itemId)
                if (media) flow.openNew(media, iso)
              }}
              onDropFiles={(files, iso) => void createFromFiles(files, iso)}
            />
          ) : view === 'List' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ListView posts={inWeekOrUntimed} tz={tz} todayKey={todayKey} onOpen={flow.openPost} />
            </div>
          ) : view === 'Preview' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PreviewGrid posts={channelPosts} tz={tz} onOpen={flow.openPost} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StoriesView posts={stories} tz={tz} onOpen={flow.openPost} />
            </div>
          )}
        </main>
      </div>

      {/* Every move says itself out loud: somebody moving a tile with the
          arrow keys cannot see which column it flew to. */}
      <p aria-live="polite" className="sr-only">{drag.announcement}</p>

      {/* A refusal is the server's own sentence, where the eye already is */}
      {drag.message && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex max-w-[440px] -translate-x-1/2 items-start gap-3 rounded-card border border-accent-red/40 bg-popover px-4 py-3 shadow-xl"
        >
          <span className="text-[13px] font-medium">{drag.message}</span>
          <button
            type="button"
            onClick={drag.dismiss}
            aria-label="Close"
            className="-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

      {/* The media chooser, the composer with its per-network preview, the
          manager's own sign-off and the image editor: the SHARED flow, the
          same one the Scheduler page's single button opens in place. */}
      {flow.windows}

      {/* a file dropped straight onto the calendar says where it got to */}
      {uploadNote && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex max-w-[440px] -translate-x-1/2 items-start gap-3 rounded-card border border-border bg-popover px-4 py-3 shadow-xl"
        >
          <span className="text-[13px] font-medium">{uploadNote}</span>
          <button
            type="button"
            onClick={() => setUploadNote(null)}
            aria-label="Close"
            className="-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

    </div>
  )
}
