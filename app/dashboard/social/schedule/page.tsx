'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Images, StickyNote, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  approveWithoutClientQuestion, matchesChannel, mayEditNote, nowLineTop,
  onOneOfDays, scheduleWeekGrid, type SuggestedTime,
} from '@/app/lib/social-schedule-core'
import { dayKeyInZone, toZonedInput, zoneLabel } from '@/app/lib/timezone-core'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import { readLocations } from '@/app/lib/schedule-compose-core'
import { useRole } from '../../useRole'
import { usePersistedChoice } from '../../production/workHooks'
import PageTitle from '../../ui/PageTitle'
import type { ScopeViewer } from '@/app/lib/scope-client'
import type { ScheduleNote } from '@/lib/db-types'
import type { RailMedia, SchedulePostRow } from './useSchedulePosts'
import MediaRail from './MediaRail'
import NoteEditor from './NoteEditor'
import { useDragSchedule } from './useDragSchedule'
import EditMediaLauncher from './EditMediaLauncher'
import ImageEditor, { type ImageEditorTarget } from './ImageEditor'
import NewPostDialog, { type ComposerTarget } from './NewPostDialog'
import PiecePicker from './PiecePicker'
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

  /**
   * The composer.
   *
   * Held as "which piece, and which post" rather than as a copy of the post:
   * the row itself is looked up in the LIVE list every render, so an approval
   * landing in another tab changes the window's pill and its button without
   * anything here refetching.
   */
  const [composing, setComposing] = useState<
    { itemId: string; postId: string | null; at: string | null } | null>(null)
  /**
   * "New post" with nothing chosen yet.
   *
   * NOTHING IS PICKED FOR ANYBODY. This used to load whichever approved piece
   * sorted first, media and all, so a click on Thursday 10am meaning "put
   * something here" opened a finished-looking composition nobody had chosen —
   * one reflex press away from queueing the wrong piece. The time the click
   * meant is carried into the chooser and on into the composer.
   */
  const [choosing, setChoosing] = useState<{ at: string | null } | null>(null)

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

  const openNew = (media: RailMedia, at: string | null) => {
    if (!media.ok) return
    setChoosing(null)
    // one post per piece: a second "new post" on a piece that has one opens
    // the one that exists, which is what the server would insist on anyway
    const existing = data.posts.find(p => p.item_id === media.itemId) ?? null
    setComposing({ itemId: media.itemId, postId: existing?.id ?? null, at })
  }

  /** open an existing post in the composer */
  const openPost = (post: SchedulePostRow) =>
    setComposing({ itemId: post.item_id, postId: post.id, at: null })

  /** an empty slot, a suggested slot, or the rail's button: ask what goes in
   *  it, holding on to the time that was clicked */
  const openAt = (at: string | null) => setChoosing({ at })

  /**
   * "Approve without client" — the manager's own sign-off, from here.
   *
   * One question first, because it skips the client. The move itself is the
   * EXISTING transition to `approved_for_scheduling`: the same edge, the same
   * refusals and the same activity trail as the item page, so nobody gains a
   * right by being on this screen. The rail updates itself — the item is
   * live — so nothing here refetches.
   */
  const [approving, setApproving] = useState<RailMedia | null>(null)
  const [approveNote, setApproveNote] = useState<string | null>(null)
  const [approveBusy, setApproveBusy] = useState(false)

  const approveWithoutClient = async (m: RailMedia) => {
    setApproveBusy(true)
    setApproveNote(null)
    try {
      const res = await fetch(`/api/production/items/${m.itemId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'approved_for_scheduling' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setApproveNote(friendlyError(String(json?.error ?? ''), 'Schedule'))
        return
      }
      setApproving(null)
    } catch {
      setApproveNote(loadFailedMessage('that approval'))
    } finally {
      setApproveBusy(false)
    }
  }

  // Escape closes the question, like every other window on this page. A
  // dialog that only the mouse can dismiss is one somebody gets stuck in.
  useEffect(() => {
    if (!approving) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setApproving(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [approving])

  /**
   * ONE IMAGE EDITOR, TWO WAYS IN.
   *
   * The week's "Edit media" chooser and the composer's own "Edit image" button
   * both hand a picture to this, rather than each keeping an editor of its
   * own: two copies would drift, and one opened over the other is a window
   * nobody can get out of.
   */
  const [editing, setEditing] = useState<ImageEditorTarget | null>(null)
  const [editSaved, setEditSaved] = useState<string | null>(null)

  // a note about a save clears itself: it is a receipt, not a state
  useEffect(() => {
    if (!editSaved) return
    const id = window.setTimeout(() => setEditSaved(null), 8000)
    return () => window.clearTimeout(id)
  }, [editSaved])

  const target: ComposerTarget | null = useMemo(() => {
    if (!composing) return null
    const media = data.media.find(m => m.itemId === composing.itemId)
    const post = composing.postId
      ? data.posts.find(p => p.id === composing.postId) ?? null
      : data.posts.find(p => p.item_id === composing.itemId) ?? null
    if (!media && !post) return null
    return {
      itemId: composing.itemId,
      title: media?.title ?? post?.item_title ?? 'Post',
      contentType: media?.contentType ?? String(post?.item_type ?? ''),
      approved: media?.slides ?? [],
      knownUrls: media?.knownUrls ?? [],
      coverUrl: media?.coverUrl ?? null,
      versionNumber: post?.version_number ?? null,
      post,
      at: composing.at,
    }
  }, [composing, data.media, data.posts])

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
  /** the places this client tags Instagram posts at — saved on their Social
   *  page, because Instagram wants a Facebook Page id and has no search */
  const locations = useMemo(
    () => readLocations((data.client as { instagram_locations?: unknown } | null)?.instagram_locations),
    [data.client])
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

  const rail = (
    <MediaRail
      media={data.media}
      waiting={data.waiting}
      loading={data.loading}
      role={me?.role ?? null}
      onNew={() => openAt(weekSlots[0]?.iso ?? null)}
      onPick={m => openNew(m, null)}
      onApprove={m => { setApproveNote(null); setApproving(m) }}
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
                onEdit={setEditing}
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
                    <EditMediaLauncher media={data.media} posts={data.posts} onEdit={setEditing} />
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
                  onSlot={openAt}
                  onOpen={openPost}
                  onDropItem={(itemId, iso) => {
                    const media = data.media.find(m => m.itemId === itemId)
                    if (media) openNew(media, iso)
                  }}
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
                <ListView posts={inWeek} tz={tz} todayKey={todayKey} onOpen={openPost} />
              </div>
            </>
          ) : view === 'Month' ? (
            <MonthGrid
              month={monthKey}
              posts={channelPosts}
              tz={tz}
              todayKey={todayKey}
              onOpen={openPost}
              drag={drag}
              defaultTime={defaultPostTime}
              onDropItem={(itemId, iso) => {
                const media = data.media.find(m => m.itemId === itemId)
                if (media) openNew(media, iso)
              }}
            />
          ) : view === 'List' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ListView posts={inWeek} tz={tz} todayKey={todayKey} onOpen={openPost} />
            </div>
          ) : view === 'Preview' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PreviewGrid posts={channelPosts} tz={tz} onOpen={openPost} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StoriesView posts={stories} tz={tz} onOpen={openPost} />
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

      {approving && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Approve without the client"
          onMouseDown={e => { if (e.target === e.currentTarget) setApproving(null) }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
        >
          <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-card bg-surface p-4 shadow-xl">
            <h2 className="text-section-title">
              {approveWithoutClientQuestion(approving.versionNumber)}
            </h2>
            <p className="text-[13px] text-muted-foreground">
              {`“${approving.title}” is signed off in your name and can be posted. `}
              The client is not asked.
            </p>
            {approveNote && (
              <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
                {approveNote}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApproving(null)}
                className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold"
              >
                Not yet
              </button>
              <button
                type="button"
                disabled={approveBusy}
                onClick={() => void approveWithoutClient(approving)}
                className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60"
              >
                {approveBusy ? 'Approving…' : 'Approve without client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {choosing && (
        <PiecePicker
          media={data.media}
          at={choosing.at}
          tz={tz}
          role={me?.role ?? null}
          onPick={m => openNew(m, choosing.at)}
          onApprove={m => { setApproveNote(null); setApproving(m) }}
          onClose={() => setChoosing(null)}
        />
      )}

      {target && (
        <NewPostDialog
          target={target}
          tz={tz}
          accounts={data.accounts}
          suggested={suggested.slice(0, 3)}
          role={me?.role ?? null}
          locations={locations}
          onClose={() => setComposing(null)}
          onOpenPost={id => setComposing(c => (c ? { ...c, postId: id } : c))}
          onEditMedia={setEditing}
        />
      )}

      {editSaved && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 max-w-[440px] -translate-x-1/2 rounded-card border border-border bg-popover px-4 py-3 text-[13px] font-medium shadow-xl"
        >
          {editSaved}
        </div>
      )}

      {editing && (
        <ImageEditor
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={message => {
            setEditSaved(message)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
