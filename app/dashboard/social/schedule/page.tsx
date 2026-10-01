'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { contactIdOf } from '../../../lib/account-owner-core'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Compass, Images, Moon, StickyNote, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  matchesChannel, mayEditNote, nowLineTop, onOneOfDays, scheduleWeekGrid,
} from '@/app/lib/social-schedule-core'
import {
  LIST_FILTER_LABEL, matchesListFilter, scheduleCounts, showsOnSchedule, type ListFilter,
} from '@/app/lib/schedule-stage-core'
import { MISSED_LABEL, STAGE_LABEL, STAGE_TONE, MISSED_TONE, type StageTone } from '@/app/lib/post-stage-core'
import { POST_APPROVAL_BOARD } from '@/app/lib/overview-links-core'
import { postAct, type PostActRequest, type PostActResponse } from '@/app/lib/post-act-contract'
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
import type { SchedulePostRow } from './useSchedulePosts'
import MediaRail from './MediaRail'
import NoteEditor from './NoteEditor'
import { useDragSchedule } from './useDragSchedule'
import EditMediaLauncher from './EditMediaLauncher'
import { CLIENT_KEY, useComposeFlow, useSuggestedTimes } from './useComposeFlow'
import ProfilesBar, { VIEWS, type ScheduleViewName } from './ProfilesBar'
import { brandFor } from '../PlatformIcon'
import WeekGrid, { StoriesStrip, WEEK_ROW_PX } from './WeekGrid'
import Tour, { useTourOnce } from './Tour'
import { SCHEDULE_TOUR } from '@/app/lib/tour-core'
import { ListView, MonthGrid, PreviewGrid, StoriesView, type BinHandler } from './views'
import { StageDot } from './tiles'
import { useSchedulePosts } from './useSchedulePosts'
import { monthLabel, rangeLabel, shiftDays, shiftMonths } from './week-nav'

/**
 * THE SCHEDULE: one client's week, media on the left, hours on the right.
 *
 * ITS ONE JOB IS GETTING APPROVED POSTS OUT (the owner's decision 1, 29 Sep
 * 2026). It draws Ready to post, Booked in and Posted, and marks a time that
 * was missed. It never approves anything: a post still being made or checked
 * lives on Post approval, and this page only counts it and links there.
 *
 * Four things it refuses to get wrong:
 *
 *  1. EVERY TIME IS THE CLIENT'S. The columns, the now-line and the labels are
 *     all in `clients.timezone` — a posting time is a fact about the audience,
 *     not about whoever is looking at the screen.
 *  2. A POST'S PLACE IS ITS STAGE. Every tile, row, count and word reads
 *     `social_posts.stage` through `post-stage-core`'s one list of words
 *     (`scheduleFacts`). Nothing is worked out from the edit card, the jobs or
 *     the old `status` column (audit S2, S5, S7).
 *  3. EVERY MOVE GOES THROUGH THE ONE ACT ROUTE. A drag is "Change time", the
 *     bin is "Delete draft" or "Cancel post" — exactly what `postActions` offers
 *     this person — and the page redraws from what the server answers.
 *  4. IT IS LIVE. Everything on it is a database listener, and a one-minute
 *     clock re-reads the words, so a time missed while the page is open says
 *     so (audit S12).
 *
 * The layout is the approved mockup's: the media rail is a full-height column
 * pinned to the left of the calendar, and the whole thing fills the window —
 * a calendar that stops half way down the screen looks broken.
 */

const VIEW_KEY = 'md-schedule-view'

/** The counts above the calendar: the schedule's three stages and the missed times, in the stage colours. */
const SUMMARY: { key: 'ready' | 'booked' | 'posted' | 'missed'; tone: StageTone }[] = [
  { key: 'ready', tone: STAGE_TONE.ready },
  { key: 'booked', tone: STAGE_TONE.booked },
  { key: 'posted', tone: STAGE_TONE.posted },
  { key: 'missed', tone: MISSED_TONE },
]

export default function SchedulePage() {
  const { me, noAccount } = useRole()
  const viewer: ScopeViewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer ?? false } : null), [me])

  /**
   * ARRIVING FROM A LINK — the bell, or an email.
   *
   * `?client=…&item=…` opens this page on that client with the post window
   * on that piece; `&post=…` opens that one post. Read ONCE, lazily, as the initial state rather than in an effect:
   * the "client you had last time" effect below would otherwise race it and
   * land the reviewer on somebody else's week.
   */
  const [clientId, setClientId] = useState<string | null>(
    () => (typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('client')) || null)
  const [channel, setChannel] = useState<string | null>(null)
  const [view, setView] = usePersistedChoice<ScheduleViewName>(VIEW_KEY, VIEWS, 'Week', 'view')
  /** the week opens at 6 am with no scroll; midnight to 5 am is one press
   *  away, and remembered (the owner, 10 Sep 2026) */
  const [night, setNight] = usePersistedChoice<'hide' | 'show'>('schedule.night', ['hide', 'show'], 'hide')
  const hours = useMemo(() => ({ fromHour: night === 'show' ? 0 : 6, toHour: 23 }), [night])
  /** any day in the week (or month) on screen, as a 'YYYY-MM-DD' key */
  const [anchor, setAnchor] = useState<string | null>(null)
  /** the clock, for the now-line AND the words — a minute is close enough to
   *  "now", and a post whose time passes while the page is open has to say it
   *  missed it (audit S12) */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const data = useSchedulePosts(viewer, clientId, now)
  /** the freshest rows, for a handler that runs after the render that drew them */
  const postsRef = useRef(data.posts)
  postsRef.current = data.posts
  /** WHOSE ACCOUNTS (15 Sep 2026): 'all', 'company', or a contact's id — the
   *  bar, the calendar, the rail and a new upload all follow it */
  const [owner, setOwner] = useState('all')
  useEffect(() => { setOwner('all') }, [clientId])
  const ownerContact = owner === 'all' ? null : contactIdOf(owner)
  const ownerAccountIds = useMemo(() => new Set(
    (owner === 'all' ? data.allAccounts : data.allAccounts.filter(a => (a.contact_id ?? null) === ownerContact)).map(a => a.id)),
    [owner, ownerContact, data.allAccounts])
  const ownerMedia = useMemo(
    () => owner === 'all' ? data.media : data.media.filter(m => (m.forContactId ?? null) === ownerContact),
    [owner, ownerContact, data.media])

  /** the channel the profiles bar is filtering to, as the core reads it */
  const selected = useMemo(
    () => data.accounts.find(a => a.id === channel) ?? null, [data.accounts, channel])
  /** the Instagram accounts the feed preview is of — the one picked, or all of the client's */
  const instagramIds = useMemo(() => new Set(
    (selected ? [selected] : data.allAccounts).filter(a => a.platform === 'instagram').map(a => a.id)),
  [selected, data.allAccounts])

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
    clientId, data, role: me?.role ?? null, userId: me?.id ?? null, suggested,
    // whom a new upload is for — the page's own dropdown (15 Sep 2026)
    forContact: ownerContact,
    // "Show on calendar" from the window that follows a press
    onShowDay: key => setAnchor(key),
    // …and after a cancel, the list of cancelled posts it went to (1 Oct 2026)
    onShowCancelled: () => showList('cancelled'),
  })

  /** …and the piece that link named, opened once the page knows about it */
  const arrivedOn = useRef<string | null>(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('item'))
  /** …or the one POST a link named (`?post=`), opened in the post window once it is here */
  const arrivedPost = useRef<string | null>(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('post'))
  /**
   * THE WINDOW OPENS WHERE YOU ARE (the owner, 29 Sep 2026: "why did it bring me to the Post approval page …
   * BUT I AM SUPER ADMIN"). A post opened on this page opens here, whatever its stage — the window's buttons
   * are the post's own rules for this person either way, so nothing is approved that the rules would not
   * allow. It used to send a draft, a quality-check or a with-client post off to Post approval mid-task.
   */
  const openPost = useCallback((row: SchedulePostRow) => { flow.openPost(row) }, [flow.openPost])
  useEffect(() => {
    const postId = arrivedPost.current
    if (!postId) return
    const row = data.posts.find(p => p.id === postId)
    if (!row) return
    arrivedPost.current = null
    openPost(row)
  }, [data.posts, openPost])
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

  /**
   * THE WALKTHROUGH, the first time somebody who posts opens this page.
   *
   * It waits for the week to have finished loading: a spotlight cut around a
   * skeleton points at nothing. Skip, Escape and Done all end it, and it is
   * remembered per person — "Show me the tour" on the toolbar brings it back.
   */
  const tour = useTourOnce('schedule', {
    userId: me?.id ?? null,
    role: me?.role ?? null,
    ready: !data.loading && !data.error,
  })

  /** what is happening to a file dropped straight onto the calendar */
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  /**
   * ONE WAY TO MOVE A POST: the act route (`POST /api/posts/<id>/act`). It
   * carries the `rev` this page drew, so a post somebody else changed a moment
   * ago is refused rather than overwritten, and the answer is the post as the
   * server now holds it (audit W4: never draw what we assumed happened).
   */
  const act = useCallback((
    post: SchedulePostRow,
    body: Omit<PostActRequest, 'expect_rev'>,
  ): Promise<PostActResponse> => postAct(post.id, { ...body, expect_rev: post.state.rev }), [])

  /**
   * MOVING A POST BY HAND is "Change time" (T13 on Ready to post, T15 on
   * Booked in) and nothing else. The hook does the mouse, the finger and the
   * arrow keys; a tile lifts only when `postActions` offers this person
   * Change time (`move_block`). A refusal is the SERVER's own sentence.
   */
  const drag = useDragSchedule({
    tz: data.tz,
    hours,
    onMove: async (postId, at) => {
      const post = postsRef.current.find(p => p.id === postId)
      if (!post) return { ok: false, error: 'That post is not on this page any more — reload and try again.' }
      const r = await act(post, { action: 'change_time', scheduled_for: at })
      return r.ok ? { ok: true } : { ok: false, error: r.reason }
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
        body: JSON.stringify({ client_id: clientId, files: slides, scheduled_for: at, for_contact_id: ownerContact }),
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
    () => scheduleWeekGrid({ start: anchor ?? todayKey ?? '', tz, rowPx: WEEK_ROW_PX, fromHour: hours.fromHour, toHour: hours.toHour }),
    [anchor, todayKey, tz, hours])
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
    () => livePosts.filter(p => matchesChannel(p.channels, selected) && (owner === 'all' || p.channels.some(id => ownerAccountIds.has(id)))),
    // `owner` and its accounts are read, so they are listened to: picking a
    // person used to leave the calendar on the last one's posts (audit S4)
    [livePosts, selected, owner, ownerAccountIds])

  const weekKeys = useMemo(() => new Set(grid.days.map(d => d.iso)), [grid.days])

  /** what the grids draw: Ready to post, Booked in, Posted — off the stage (`showsOnSchedule`) */
  const planned = useMemo(() => channelPosts.filter(p => showsOnSchedule(p.stage)), [channelPosts])
  const inWeek = useMemo(
    () => planned.filter(p => onOneOfDays(p.scheduled_for, tz, weekKeys)),
    [planned, weekKeys, tz])

  /** the numbers above the calendar, each counted off the stage (audit B12) */
  const counts = useMemo(() => scheduleCounts(channelPosts), [channelPosts])

  /**
   * THE BIN, from a List row: whatever `postActions` put there. "Delete draft"
   * really deletes a draft that was never sent (T23); anywhere else it is
   * "Cancel post" (T20), and the post goes to the Cancelled list with a way
   * back (Re-book). The answer, or the refusal, is the server's.
   */
  const binPost: BinHandler = useCallback(async (post) => {
    if (!post.bin) return 'There is nothing to remove here.'
    const r = await act(post, { action: post.bin.action, confirm: true })
    if (!r.ok) return r.reason
    toast.success(r.words)
    return null
  }, [act])

  /** THE LIST'S FILTER — one of the counts above, pressed */
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  useEffect(() => { setListFilter('all') }, [clientId])
  const showList = (f: ListFilter) => { setListFilter(f); setView('List') }

  /** the missed times, whatever week they are in: the first thing the List shows */
  const missed = useMemo(
    () => channelPosts.filter(p => matchesListFilter(p, 'missed')), [channelPosts])
  const listPosts = useMemo(() => {
    if (listFilter !== 'all') return channelPosts.filter(p => matchesListFilter(p, listFilter))
    // the week's posts on the schedule, and any with no time yet; the missed
    // ones lead the list on their own, so they are not listed twice
    return planned.filter(p => !p.facts.missed && (!p.scheduled_for || onOneOfDays(p.scheduled_for, tz, weekKeys)))
  }, [listFilter, channelPosts, planned, tz, weekKeys])
  const listPinned = listFilter === 'all' ? { label: MISSED_LABEL, posts: missed } : null
  const listEmpty = listFilter === 'all'
    ? 'Nothing on the schedule this week.'
    : listFilter === 'drafts'
      ? 'No drafts. A new post starts as a draft, then goes to quality check.'
      : `Nothing in ${LIST_FILTER_LABEL[listFilter]}.`
  const listNote = listFilter !== 'all' ? (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2 text-[13px] text-muted-foreground">
      Showing {LIST_FILTER_LABEL[listFilter]} · {listPosts.length}.
      {listFilter === 'drafts' && (
        <Link href={POST_APPROVAL_BOARD} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
          Drafts are sent for quality check on Post approval
        </Link>
      )}
      <button type="button" onClick={() => setListFilter('all')} className="min-h-11 font-semibold underline underline-offset-4">Show the schedule</button>
    </p>
  ) : null

  const weekNotes = useMemo(
    () => data.notes.filter(n => onOneOfDays(n.at, tz, weekKeys)),
    [data.notes, weekKeys, tz])

  /** a story is set per NETWORK on the post (`per_channel[…].kind`), not on the
   *  edit card — the old filter read the card and found none (audit S3) */
  const stories = useMemo(() => inWeek.filter(p => p.facts.story), [inWeek])

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
      media={ownerMedia}
      // POSTS STILL BEING APPROVED are counted here and live on Post approval
      waiting={counts.beingApproved}
      drafts={counts.drafts}
      onDrafts={() => showList('drafts')}
      loading={data.loading}
      role={me?.role ?? null}
      postWithoutApproval={data.postWithoutApproval}
      onNew={() => flow.openAt(weekSlots[0]?.iso ?? null)}
      onPick={(m, slides) => flow.openNew(m, null, slides ?? null)}
      onRemove={async m => {
        const res = await fetch(`/api/production/items/${m.itemId}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(String(json?.error ?? 'Could not remove that piece')); return }
        toast.success(`Removed ${m.title}`)
      }}
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
            owner={owner}
            onOwner={setOwner}
            contacts={data.contacts}
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
              <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={monthView ? 'Next month' : 'Next week'}
              onClick={() => step(1)}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
            >
              <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </button>
            <span className="text-[16px] font-semibold">
              {monthView ? monthLabel(anchor ?? todayKey ?? '') : rangeLabel(grid.days)}
            </span>

            <div className="ml-auto flex items-center gap-2">
              {view === 'Week' && (
                <button
                  type="button"
                  aria-pressed={night === 'show'}
                  onClick={() => setNight(night === 'show' ? 'hide' : 'show')}
                  title={night === 'show' ? 'Hide midnight to 5 am' : 'Show midnight to 5 am'}
                  className={cn(
                    'hidden min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold md:flex',
                    night === 'show' ? 'bg-foreground text-background' : 'bg-surface hover:bg-muted',
                  )}
                >
                  <Moon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                  Night hours
                </button>
              )}
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
              {/* the walkthrough runs itself once; after that it lives here,
                  where somebody who wants it back can find it */}
              <button
                type="button"
                onClick={tour.start}
                title="Walk me through this page"
                className="hidden min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted md:flex"
              >
                <Compass className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                Show me the tour
              </button>
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

          {/* WHERE THINGS STAND, counted off the stage. Each count opens the
              List on just those posts. Nothing here approves anything. */}
          {!data.loading && !data.error && (
            <div role="group" aria-label="Where the posts stand" className="flex flex-wrap items-center gap-1.5 pb-2">
              {SUMMARY.map(({ key, tone }) => {
                const n = counts[key]
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === 'List' && listFilter === key}
                    onClick={() => showList(key)}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-full border border-border px-3.5 text-[13px] font-semibold hover:bg-muted',
                      view === 'List' && listFilter === key ? 'bg-foreground text-background hover:bg-foreground' : 'bg-surface',
                      key === 'missed' && n === 0 && 'text-muted-foreground',
                    )}
                  >
                    <StageDot tone={tone} className="border-0" />
                    {LIST_FILTER_LABEL[key]}
                    <span className="tabular-nums">{n}</span>
                  </button>
                )
              })}
              {counts.cancelled > 0 && (
                <button
                  type="button"
                  aria-pressed={view === 'List' && listFilter === 'cancelled'}
                  onClick={() => showList('cancelled')}
                  className="min-h-11 px-2 text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:underline"
                >
                  {STAGE_LABEL.cancelled} · {counts.cancelled}
                </button>
              )}
            </div>
          )}

          {data.error ? (
            <p className="rounded-inner border border-border bg-surface p-6 text-[15px] text-muted-foreground">
              {loadFailedMessage('the schedule')}
            </p>
          ) : data.loading ? (
            <div role="status" aria-label="Loading the week" aria-busy="true" className="flex min-h-0 flex-1 flex-col">
              <Skeleton className="min-h-0 w-full flex-1 rounded-inner" />
            </div>
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
                  onOpen={openPost}
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
                {listNote}
                <ListView posts={listPosts} tz={tz} todayKey={todayKey} onOpen={openPost} onBin={binPost} pinned={listPinned} empty={listEmpty} />
              </div>
            </>
          ) : view === 'Month' ? (
            <MonthGrid
              month={monthKey}
              posts={planned}
              tz={tz}
              todayKey={todayKey}
              onOpen={openPost}
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
              {listNote}
              <ListView posts={listPosts} tz={tz} todayKey={todayKey} onOpen={openPost} onBin={binPost} pinned={listPinned} empty={listEmpty} />
            </div>
          ) : view === 'Preview' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* THE FEED AS IT WILL LOOK: `PreviewGrid` keeps only Instagram posts that are going out — Ready
                  to post and Booked in — and draws what already went out once, from the feed (audit S8) */}
              <PreviewGrid posts={channelPosts} tz={tz} onOpen={openPost}
                instagramIds={instagramIds}
                accountId={(selected?.platform === 'instagram' ? selected.id : data.accounts.find(a => a.platform === 'instagram')?.id) ?? null}
                handle={(selected?.platform === 'instagram' ? selected.username : data.accounts.find(a => a.platform === 'instagram')?.username) ?? null} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StoriesView posts={stories} tz={tz} onOpen={openPost} onBin={binPost} />
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

      {tour.open && <Tour tour={SCHEDULE_TOUR} onClose={tour.close} />}

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
