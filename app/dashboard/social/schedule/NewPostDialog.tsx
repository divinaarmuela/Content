'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  ChevronDown, Clock, MapPin, Plus, Trash2, Wand2, X, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SocialAccount } from '@/lib/db-types'
import {
  APPROVAL_LINE, clockPillLabel, composerReducer, footerActions, groupOptions, isPostingNow,
  initialComposer, moreOptionsFor, optionsFromExtras, readPerChannel, PAGE_ID_HELP,
  type ChannelExtras, type ComposerState, type FooterActionKey, type MoreOption,
  type OptionChoice, type SavedLocation, durationWords } from '@/app/lib/schedule-compose-core'
import {
  CLIENT_SIGNS_OFF_NOTE, NOT_CLIENT_APPROVED, tileTone, validateComposition,
  type SocialPostStatus, type SuggestedTime,
} from '@/app/lib/social-schedule-core'
import {
  autoKindFor, availableKinds, isOrganizationUrn, isPageId, isPlatform, networkName,
  TIKTOK_CONSENT_LINE, type PostKind,
} from '@/app/lib/publish-core'
import type { ChannelOptions } from '@/app/lib/publisher'
import { mayPublish as roleMayPublish, type Role } from '@/app/lib/identity-core'
import { friendlyError } from '@/app/lib/support-core'
import { formatInZone } from '@/app/lib/timezone-core'
import type { Slide } from '@/app/lib/version-files-core'
import PlatformIcon from '../PlatformIcon'
import type { ImageEditorTarget } from './ImageEditor'
import MediaPicker from './MediaPicker'
import TimePicker from './TimePicker'
import { DOT_CLASS, STATUS_WORDS, Thumb } from './tiles'
import type { SchedulePostRow } from './useSchedulePosts'

/**
 * NEW POST — the one window where a plan becomes something a client's
 * followers will see.
 *
 * Five things it will not do:
 *
 *  1. IT NEVER PRETENDS TO POST. The footer says exactly where the post
 *     stands (that pill is the ITEM's approval, live), and the button offers
 *     only what this person may actually do — `footerActions`, which is where
 *     "Schedule without approval" is withheld from anyone who could not have
 *     approved it. The server refuses too; this only stops the button lying.
 *  2. IT NEVER OFFERS A SETTING THE PROVIDER DOES NOT HAVE. "More options" is
 *     `moreOptionsFor`, read off what `publish-core` actually sends — which is
 *     also why "Add location" disappears the moment the post type is Story:
 *     Instagram refuses a Story carrying a location rather than ignoring it.
 *  3. IT NEVER SHOWS MEDIA THE CLIENT HAS NOT SEEN AS APPROVED. The badge is
 *     drawn from the approved version's own files, and anything else routes
 *     through the picker's new-version path.
 *  4. EVERY TIME IN IT IS THE CLIENT'S. The pill, the chips and the "goes out
 *     at" line all run through the client's zone.
 *  5. IT NEVER SAVES A FIELD NOBODY TOUCHED. The window opens with everything
 *     the post already holds — caption and per-channel extras included — so a
 *     press of Schedule cannot PATCH an empty caption over somebody's words
 *     and take the client's approval down with it.
 *
 * It is live: the post row it is given comes from the page's listeners, so an
 * approval landing on the item page in another tab changes the pill and the
 * button here without a refresh.
 */

export type ComposerTarget = {
  itemId: string
  title: string
  contentType: string
  /** the approved version's files — the default media and the only media that
   *  needs no fresh approval */
  approved: Slide[]
  /** every file this piece has ever held — what tells a NEW file from a
   *  reorder, and so whether saving media makes a version */
  knownUrls: string[]
  versionNumber: number | null
  /** the cover picture already chosen in the editor for this piece's media */
  coverUrl: string | null
  /**
   * The client has not signed this media off — the rail's quiet marker, said
   * again HERE.
   *
   * The window is where the irreversible press happens, and it used to be the
   * one screen with no marker on it at all: a card dragged straight from the
   * rail onto a time showed the words for the half second it was under the
   * cursor and never again. Somebody deserves to see what they are posting at
   * the moment they post it.
   */
  needsClientApproval: boolean
  /** the client said yes to this media (see `RailMedia.clientApproved`) —
   *  what the image editor's footer is written from */
  clientApproved: boolean
  /** where the piece actually is in the funnel — what the window's own
   *  composition check judges, instead of assuming it is approved */
  itemStatus: string
  /** an existing post to edit, or null for a new one */
  post: SchedulePostRow | null
  /** the time a click on the calendar meant, for a new post */
  at: string | null
}

/** Everything the window opens holding — the post's own values when there is
 *  a post, the click's values when there is not. */
function seedOf(target: ComposerTarget, accounts: SocialAccount[]) {
  const post = target.post
  return {
    itemId: target.itemId,
    postId: post?.id ?? null,
    slides: post?.slides ?? target.approved,
    caption: post ? String(post.caption ?? '') : '',
    scheduledFor: post?.scheduled_for ?? target.at,
    channels: post?.channels?.length ? post.channels : (accounts[0] ? [accounts[0].id] : []),
    perChannel: post ? readPerChannel(post.per_channel) : {},
  }
}

export default function NewPostDialog({
  target, tz, accounts, suggested, role, clientSignsOff, locations,
  onClose, onOpenPost, onEditMedia,
}: {
  target: ComposerTarget
  tz: string
  accounts: SocialAccount[]
  suggested: SuggestedTime[]
  role: Role | null
  /** this client signs every post off themselves — the one client where an
   *  account manager still sends a post for approval like everybody else */
  clientSignsOff: boolean
  /** the places this client tags posts at, saved on the client's Social page */
  locations: SavedLocation[]
  onClose: () => void
  /** the draft became real — the page keeps its id so the live row can be
   *  handed back in */
  onOpenPost: (postId: string) => void
  /** open the page's one image editor on a picture of this post */
  onEditMedia: (target: ImageEditorTarget) => void
}) {
  const post = target.post
  const [state, dispatch] = useReducer(
    composerReducer, seedOf(target, accounts), initialComposer)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  /**
   * WHICH PICTURE THE BUTTONS ARE ABOUT.
   *
   * The window shows the first slide big and the rest as a strip. "Edit image"
   * has to mean one of them, and a button that always meant the first one
   * would be useless on a carousel — so the strip is clickable and this is
   * what it clicks. Clamped on read rather than reset on change: the slides
   * can shrink under it when somebody removes one in the picker.
   */
  const [chosenSlide, setChosenSlide] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  /** a question that has to be answered before something is thrown away */
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null)
  const card = useRef<HTMLDivElement>(null)
  /** which post the window has taken its values from, so a listener firing
   *  does not retype somebody's caption under their cursor */
  const loadedId = useRef<string | null>(post?.id ?? null)

  /**
   * The post row is LIVE, and the window has to follow it WITHOUT stealing
   * what somebody is in the middle of typing.
   *
   * So: a `loaded` action, once, when the window starts looking at a
   * different post — including the moment a draft this window created gets
   * its id. Everything after that is the person's, until they save.
   */
  useEffect(() => {
    if (!post?.id || post.id === loadedId.current) return
    loadedId.current = post.id
    dispatch({
      type: 'loaded',
      state: {
        postId: post.id,
        slides: post.slides ?? [],
        caption: String(post.caption ?? ''),
        channels: post.channels ?? [],
        scheduledFor: post.scheduled_for ?? null,
        perChannel: readPerChannel(post.per_channel),
      },
    })
  }, [post?.id, post])

  /* ── closing, and not losing anything on the way ─────────────────────── */

  const requestClose = () => {
    if (state.dirty) { setConfirm('close'); return }
    onClose()
  }

  // Escape closes the window (M6), and the focus stays inside it while it is
  // open — a dialog you can Tab out of is a dialog a screen reader walks
  // straight past.
  useEffect(() => {
    const el = card.current
    el?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // the picker and the dropdowns handle their own Escape first
        if (picking) return
        e.stopPropagation()
        requestClose()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const focusable = [...el.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      )].filter(n => n.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, state.dirty])

  const chosen = useMemo(
    () => accounts.filter(a => state.channels.includes(a.id)), [accounts, state.channels])
  const platforms = useMemo(
    () => [...new Set(chosen.map(a => String(a.platform)))], [chosen])

  const status: SocialPostStatus = post?.live_status ?? 'draft'
  const mayApprove = role === 'account_manager' || role === 'super_admin'
  const canPublish = role ? roleMayPublish(role) : false
  /**
   * "Schedule" or "Post now" — the words have to match what pressing it does.
   *
   * Read at render, like the composition check two lines down: a time already
   * GONE is not "now" (the check states that plainly and the button stays
   * disabled behind it), so the worst a stale render can say is "Schedule"
   * over a minute that has just arrived.
   */
  const postingNow = isPostingNow(state.scheduledFor, Date.now())
  const { primary, menu: menuItems } = footerActions({
    status, mayApprove, mayPublish: canPublish, clientSignsOff, postingNow,
  })

  const check = useMemo(() => validateComposition({
    // the piece as it ACTUALLY is, judged with this person's own rights: a
    // hardcoded `approved_for_scheduling` was how the window came to know
    // nothing about a piece the client had not seen
    item: { status: target.itemStatus, content_type: target.contentType },
    withoutApproval: mayApprove && !clientSignsOff,
    version: null,
    slides: state.slides,
    caption: state.caption,
    // the per-network options travel with the channel, so the window refuses
    // exactly what the publisher would refuse — the missing TikTok tick, a
    // paid partnership nobody can see, a YouTube title too long for YouTube
    channels: chosen.map(a => ({
      id: a.id,
      platform: String(a.platform),
      options: optionsFromExtras(state.perChannel[a.id]),
    })),
    scheduledFor: state.scheduledFor,
    now: Date.now(),
  }), [
    state.slides, state.caption, state.scheduledFor, state.perChannel,
    chosen, target.contentType,
  ])

  const approvedUrls = useMemo(
    () => new Set(target.approved.map(s => s.url)), [target.approved])
  const allApproved = state.slides.length > 0 && state.slides.every(s => approvedUrls.has(s.url))

  /* ── the header's post type ───────────────────────────────────────────── */

  const lead = platforms[0]
  const media = useMemo(
    () => state.slides.map(s => ({ url: s.url, type: s.type })), [state.slides])
  const kinds: PostKind[] = lead && isPlatform(lead) ? availableKinds(lead, media) : []
  const pickedKind = (state.perChannel[chosen[0]?.id ?? '']?.kind ?? '') as PostKind | ''
  const autoKind = lead && isPlatform(lead) ? autoKindFor(lead, media) : null
  /** what this post WILL be, chosen or worked out — the thing a location has
   *  to be checked against */
  const effectiveKind = pickedKind || autoKind || undefined

  /** video or pictures — a stitch setting on a set of photos is a control
   *  for something nobody can do */
  const mediaLead: 'video' | 'image' | null = state.slides[0]
    ? (state.slides[0].type === 'video' ? 'video' : 'image')
    : null
  const options = moreOptionsFor(platforms, effectiveKind, mediaLead)
  const groups = groupOptions(options)
  const strip = state.slides.slice(0, 3)
  const extra = Math.max(0, state.slides.length - strip.length)
  /** the strip only shows three, so the big preview follows a pick within it
   *  and falls back to the first whenever the set changed under it */
  const picked = chosenSlide < state.slides.length ? chosenSlide : 0
  const shownSlide = state.slides[picked] ?? null

  /** hand one of this post's pictures to the page's editor */
  const editSlide = (index: number) => {
    if (!state.slides[index]) return
    onEditMedia({
      itemId: target.itemId,
      title: target.title,
      versionNumber: target.versionNumber,
      slides: state.slides,
      index,
      postId: state.postId,
      clientApproved: target.clientApproved,
    })
  }

  /**
   * The lists only the network knows: YouTube playlists, LinkedIn company
   * pages, Facebook Pages, the privacy levels TikTok allows this creator.
   *
   * One request per channel, once per channel, and a failure is an empty list
   * — the row then offers a box to type in rather than a menu with nothing in
   * it. Nothing here can block the window from opening.
   */
  const [lists, setLists] = useState<Record<string, ChannelOptions>>({})
  const asked = useRef<Set<string>>(new Set())
  const needsList = useMemo(
    () => new Set(options.filter(o => o.source).flatMap(o => o.platforms)), [options])
  const askedKind = mediaLead === 'image' ? 'photo' : 'video'
  useEffect(() => {
    let live = true
    for (const account of chosen) {
      if (!needsList.has(String(account.platform))) continue
      // TikTok answers differently for a video and for a set of pictures, so
      // the answer is remembered per channel AND per kind of post
      const key = `${account.id}:${askedKind}`
      if (asked.current.has(key)) continue
      asked.current.add(key)
      fetch(`/api/social/schedule/options?accountId=${encodeURIComponent(account.id)}`
        + `&mediaType=${askedKind}`)
        .then(r => (r.ok ? r.json() : null))
        .then(json => {
          if (!live || !json || json.error) return
          const listed = json as ChannelOptions
          setLists(prev => ({ ...prev, [account.id]: listed }))
          /**
           * WHAT THE ACCOUNT ITSELF FORBIDS BECOMES THE POST'S ANSWER.
           *
           * A creator with duets turned off is not a post that asks for
           * duets — TikTok refuses the whole thing. Seeding only the
           * restrictions (never turning something ON that nobody asked for)
           * keeps an untouched post postable, and the window says "Not saved
           * yet" because that is now true.
           */
          const seed = listed.interactions
          if (!seed) return
          const patch: ChannelExtras = {}
          if (!seed.allowComment) patch.allowComment = false
          if (!seed.allowDuet) patch.allowDuet = false
          if (!seed.allowStitch) patch.allowStitch = false
          if (Object.keys(patch).length > 0) {
            dispatch({ type: 'extra', channel: account.id, patch })
          }
        })
        .catch(() => { /* an unreadable list is a box to type in, not a failure */ })
    }
    return () => { live = false }
  }, [chosen, needsList, askedKind])

  /**
   * The longest video THIS TikTok account may post.
   *
   * We cannot measure the file from here — the window holds names and URLs,
   * not durations — so this is said rather than checked: a number a person
   * can hold a two-hour cut up against, before the platform refuses it
   * silently hours later.
   */
  const tiktokLimit = useMemo(() => {
    const account = chosen.find(a => String(a.platform) === 'tiktok')
    const seconds = account ? lists[account.id]?.maxVideoDurationSec : null
    if (!seconds || mediaLead !== 'video') return null
    return `This TikTok account takes videos up to ${durationWords(seconds)} long.`
  }, [chosen, lists, mediaLead])

  /* ── talking to the server ────────────────────────────────────────────── */

  const body = (s: ComposerState) => ({
    item_id: target.itemId,
    slides: s.slides,
    caption: s.caption,
    channels: s.channels,
    per_channel: s.perChannel,
    scheduled_for: s.scheduledFor,
    timezone: tz,
  })

  /** Write the draft if it does not exist yet, and hand back its id. */
  const ensurePost = async (s: ComposerState): Promise<string> => {
    if (s.postId) {
      const res = await fetch(`/api/social/schedule/${s.postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(s)),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new ComposeProblem(json)
      dispatch({ type: 'saved' })
      return s.postId
    }
    const res = await fetch('/api/social/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(s)),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new ComposeProblem(json)
    const id = String(json?.post?.id ?? '')
    loadedId.current = id
    dispatch({ type: 'saved', postId: id })
    onOpenPost(id)
    return id
  }

  const run = async (what: FooterActionKey) => {
    if (what === 'none') return
    setBusy(true); setProblems([]); setNote(null); setConfirm(null)
    try {
      const id = await ensurePost(state)
      if (what === 'draft') { setNote('Saved as a draft.'); return }
      if (what === 'send' || what === 'direct') {
        const res = await fetch(`/api/social/schedule/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: what === 'direct' ? 'direct' : 'approval' }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new ComposeProblem(json)
        setNote(what === 'direct'
          ? 'Approved by you and booked in with the channel.'
          : 'Sent. The people who approve posts have been told.')
        return
      }
      if (what === 'now') {
        const res = await fetch(`/api/social/schedule/${id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ at: new Date(Date.now() + 60_000).toISOString() }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new ComposeProblem(json)
      }
      const res = await fetch(`/api/social/schedule/${id}/schedule`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new ComposeProblem(json)
      setNote('Booked in with the channel.')
    } catch (e) {
      setProblems(problemsOf(e))
    } finally {
      setBusy(false)
    }
  }

  const saveMedia = async (next: Slide[]) => {
    setBusy(true); setProblems([]); setNote(null)
    try {
      // A file this PIECE has never held is the only thing that makes a
      // version. Judged against every version, not against the approved one:
      // once the piece is back with the client the approved set is empty, and
      // "everything looks new" is how a reorder used to mint v5, then v6.
      const known = new Set(target.knownUrls)
      const fresh = next.filter(s => !known.has(s.url))
      if (fresh.length === 0 && !state.postId) {
        dispatch({ type: 'slides', slides: next })
        setPicking(false)
        return
      }
      const id = await ensurePost({ ...state, slides: fresh.length === 0 ? next : state.slides })
      if (fresh.length === 0) {
        dispatch({ type: 'slides', slides: next })
        dispatch({ type: 'saved' })
        setPicking(false)
        return
      }
      // media the client has not seen: the whole arrangement becomes a new
      // version and the piece goes back to them. The server checks this again
      // — it is the one that decides.
      const res = await fetch('/api/social/schedule/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: target.itemId, post_id: id, files: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new ComposeProblem(json)
      dispatch({ type: 'slides', slides: next })
      dispatch({ type: 'saved' })
      setNote(String(json?.message ?? 'Saved.'))
      setPicking(false)
    } catch (e) {
      setProblems(problemsOf(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setConfirm(null)
    if (!state.postId) { onClose(); return }
    setBusy(true)
    try {
      await fetch(`/api/social/schedule/${state.postId}`, { method: 'DELETE' })
      onClose()
    } catch {
      setProblems(['Could not take that post off the calendar. Try again in a moment.'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      // clicking the dark area behind the window closes it — but never
      // silently over unsaved work
      onMouseDown={e => { if (e.target === e.currentTarget) requestClose() }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
    >
      <div
        ref={card}
        tabIndex={-1}
        // never taller than the screen: the channel options can make it so,
        // and a centred panel taller than the viewport has a top nobody can
        // scroll to — so the panel scrolls inside itself instead
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[720px] flex-col overflow-y-auto overscroll-contain rounded-card bg-surface shadow-xl outline-none sm:max-h-[calc(100dvh-3rem)]"
      >
        {/* ── header ── */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border p-3.5">
          <Dropdown
            label={(
              <>
                {chosen[0]
                  ? <PlatformIcon platform={String(chosen[0].platform)} size={26} className="rounded-full" />
                  : <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-foreground/10"><Plus className="h-3 w-3" aria-hidden /></span>}
                <span className="flex flex-col items-start leading-[1.1]">
                  <span>{chosen[0] ? (chosen[0].username || chosen[0].name || 'Channel') : 'Choose a channel'}</span>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {chosen.length > 1 ? `and ${chosen.length - 1} more` : (chosen[0]?.platform ?? 'none yet')}
                  </span>
                </span>
              </>
            )}
            width={260}
            closeOnPick={false}
          >
            {accounts.length === 0 && (
              <p className="p-2 text-[13px] text-muted-foreground">
                This client has no channels connected yet.
              </p>
            )}
            {accounts.map(a => {
              const on = state.channels.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => dispatch({ type: 'channel', id: a.id, on: !on })}
                  className="flex min-h-11 w-full items-center gap-2 rounded-tile px-2 text-left text-[13px] hover:bg-muted"
                >
                  <PlatformIcon platform={String(a.platform)} size={22} className="rounded-full" />
                  <span className="min-w-0 flex-1 truncate">{a.username || a.name}</span>
                  <span className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border text-[10px]',
                    on ? 'border-foreground bg-foreground text-background' : 'border-border',
                  )}
                  >
                    {on ? '✓' : ''}
                  </span>
                </button>
              )
            })}
          </Dropdown>

          {kinds.length > 0 && (
            <Dropdown
              label={(
                <>
                  <Zap className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                  {pickedKind ? KIND_WORD[pickedKind] : 'Auto publish'}
                </>
              )}
              width={220}
            >
              <MenuItem
                onClick={() => {
                  for (const a of chosen) dispatch({ type: 'extra', channel: a.id, patch: { kind: undefined } })
                }}
              >
                Auto publish{autoKind ? ` — ${KIND_WORD[autoKind].toLowerCase()}` : ''}
              </MenuItem>
              {kinds.map(k => (
                <MenuItem
                  key={k}
                  onClick={() => {
                    for (const a of chosen) dispatch({ type: 'extra', channel: a.id, patch: { kind: k } })
                  }}
                >
                  {KIND_WORD[k]}
                </MenuItem>
              ))}
            </Dropdown>
          )}

          <span className="text-[13px] text-muted-foreground">on</span>
          <TimePicker
            value={state.scheduledFor}
            tz={tz}
            onChange={iso => dispatch({ type: 'time', iso })}
          />

          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* ── best times ── */}
        {suggested.length > 0 && (
          <div className="mx-3.5 mt-3.5 flex flex-wrap items-center gap-2.5 rounded-inner border border-border bg-paper px-3.5 py-2.5">
            <Clock className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            <span className="flex flex-col leading-[1.15]">
              <span className="text-[13px] font-semibold">Best times to post</span>
              <span className="text-[11px] text-muted-foreground">
                When more of this client&rsquo;s followers are online
              </span>
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              {suggested.slice(0, 3).map(s => {
                const on = state.scheduledFor === s.iso
                return (
                  <button
                    key={s.iso}
                    type="button"
                    title={s.why}
                    onClick={() => dispatch({ type: 'time', iso: s.iso })}
                    className={cn(
                      'min-h-11 rounded-full px-3 text-[12px] font-semibold',
                      on
                        ? 'bg-foreground text-background'
                        : 'border border-border bg-surface hover:bg-muted',
                    )}
                  >
                    {formatInZone(s.iso, tz, 'full') ?? clockPillLabel(s.iso, tz)}
                  </button>
                )
              })}
            </span>
          </div>
        )}

        {/* ── body ── */}
        <div className="flex flex-col gap-5 p-3.5 sm:flex-row sm:gap-5">
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-[240px]">
            <div className="relative aspect-square w-full overflow-hidden rounded-inner border border-border bg-foreground/[0.06]">
              <Thumb slide={shownSlide} label={target.title} className="h-full w-full" />
              {state.slides.length > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-ink/60 px-2 py-0.5 text-[11px] font-bold text-cream">
                  {picked + 1}/{state.slides.length}
                </span>
              )}
              <span className={cn(
                'absolute bottom-2 left-2 rounded-full px-2 py-1 text-[11px] font-bold',
                allApproved ? 'bg-tint-green' : 'bg-tint-amber',
              )}
              >
                {allApproved ? 'Client approved' : 'Waiting for approval'}
              </span>
            </div>

            {state.slides.length > 1 && (
              <div className="flex gap-1.5">
                {strip.map((s, i) => (
                  <button
                    type="button"
                    key={`${s.url}-${i}`}
                    onClick={() => setChosenSlide(i)}
                    aria-label={`Show ${s.name}`}
                    aria-pressed={i === picked}
                    className={cn(
                      'h-[70px] w-[56px] shrink-0 overflow-hidden rounded-tile bg-foreground/[0.06]',
                      i === picked && 'outline outline-2 outline-offset-2 outline-accent-blue',
                    )}
                  >
                    <Thumb slide={s} label={s.name} className="h-full w-full" />
                  </button>
                ))}
                {extra > 0 && (
                  <div className="flex h-[70px] w-[56px] shrink-0 items-center justify-center rounded-tile bg-foreground/[0.06] text-[12px] font-bold text-muted-foreground">
                    +{extra}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border text-[13px] font-semibold hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              Change media
            </button>

            {/* The editor, from where the picture is. Somebody fixing a crop
                mid-caption should not have to close the post, find the week's
                toolbar and search a grid for the picture that is already in
                front of them. */}
            <button
              type="button"
              disabled={!shownSlide}
              onClick={() => editSlide(picked)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              {shownSlide?.type === 'video' ? 'Edit video' : 'Edit image'}
            </button>

            {/* The cover is a decision somebody already made in the editor;
                saying so beats an empty box next to it. */}
            {target.coverUrl && (
              <p className="text-[12px] text-muted-foreground">
                Cover: from the editor. That is the picture people see before
                they press play.
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 rounded-inner border border-border p-3">
              <span className="text-[12px] font-semibold text-muted-foreground">Caption</span>
              <textarea
                value={state.caption}
                onChange={e => dispatch({ type: 'caption', caption: e.target.value })}
                rows={4}
                placeholder="What goes with the picture?"
                className="w-full resize-y bg-transparent text-[14px] leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            {groups.length > 0 && (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  More options
                </span>
                {groups.map(group => (
                  <div key={group.platform ?? 'shared'} className="flex flex-col gap-2.5">
                    {/* one heading per network, so nobody has to work out
                        which "Who can see it" belongs to which channel */}
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                      {group.platform && (
                        <PlatformIcon platform={group.platform} size={14} className="rounded-full" />
                      )}
                      {group.label}
                    </span>
                    {/* the account's OWN ceiling, said before a long video is
                        sent to be refused by it */}
                    {group.platform === 'tiktok' && tiktokLimit && (
                      <p className="text-[11px] text-muted-foreground">{tiktokLimit}</p>
                    )}
                    {group.options.map(o => (
                      <ExtraRow
                        key={o.key}
                        option={o}
                        channels={chosen.filter(a => o.platforms.includes(String(a.platform)))}
                        state={state}
                        dispatch={dispatch}
                        locations={locations}
                        lists={lists}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}

            {/* the other channels this client has — Later's "Also post to" */}
            {accounts.some(a => !state.channels.includes(a.id)) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-muted-foreground">Also post to</span>
                {accounts.filter(a => !state.channels.includes(a.id)).map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => dispatch({ type: 'channel', id: a.id, on: true })}
                    className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted"
                  >
                    <PlatformIcon platform={String(a.platform)} size={16} className="rounded-full" />
                    {a.username || a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── what is wrong, and what just happened ── */}
        {(problems.length > 0 || check.problems.length > 0 || note) && (
          <div className="flex flex-col gap-1.5 px-3.5">
            {[...problems, ...(problems.length === 0 ? check.problems : [])].map(p => (
              <p key={p} className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
                {p}
              </p>
            ))}
            {note && (
              <p className="rounded-inner border border-accent-green/40 bg-tint-green px-3 py-2 text-[12px] font-medium">
                {note}
              </p>
            )}
          </div>
        )}

        {/* ── a question, when something is about to be thrown away ── */}
        {confirm && (
          <div className="mx-3.5 mt-3.5 flex flex-wrap items-center gap-3 rounded-inner border border-accent-amber/50 bg-tint-amber px-3 py-2.5">
            <span className="text-[13px] font-medium">
              {confirm === 'close'
                ? 'You have changes that have not been saved. Close anyway?'
                : 'Take this post off the calendar? The piece itself is not deleted.'}
            </span>
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => (confirm === 'close' ? onClose() : void remove())}
                className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background"
              >
                {confirm === 'close' ? 'Close and lose them' : 'Take it off'}
              </button>
            </span>
          </div>
        )}

        {/* ── footer ── */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border p-3.5">
          <button
            type="button"
            onClick={() => (state.postId ? setConfirm('delete') : requestClose())}
            disabled={busy}
            aria-label={state.postId ? 'Take this post off the calendar' : 'Close without saving'}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </button>

          <span
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full px-3 text-[13px] font-semibold',
              status === 'approved' ? 'bg-tint-green'
                : status === 'changes' || status === 'failed' ? 'bg-tint-red'
                  : status === 'scheduled' || status === 'published' ? 'bg-tint-blue'
                    : 'bg-tint-amber',
            )}
            title={STATUS_WORDS[status]}
          >
            <span className={cn('inline-block h-2 w-2 rounded-full', DOT_CLASS[tileTone(status)])} />
            {APPROVAL_LINE[status]}
          </span>

          {state.dirty && (
            <span className="text-[12px] font-medium text-muted-foreground">Not saved yet</span>
          )}

          <div className="ml-auto flex items-center">
            {primary.key === 'none' ? (
              <span className="text-[13px] font-semibold text-muted-foreground">{primary.label}</span>
            ) : (
              <SplitButton
                label={busy ? 'Working…' : primary.label}
                disabled={busy || !check.ok}
                onPrimary={() => void run(primary.key)}
                items={menuItems.map(m => ({ key: m.key, label: m.label }))}
                onPick={k => void run(k as FooterActionKey)}
              />
            )}
          </div>

          {/* the one client where a manager still asks — said once, plainly,
              under the button that would otherwise have posted */}
          {clientSignsOff && mayApprove && primary.key === 'send' && (
            <p className="w-full text-[12px] text-muted-foreground">{CLIENT_SIGNS_OFF_NOTE}</p>
          )}

          {/* …and the marker the rail card wore, said again where the press
              actually happens */}
          {target.needsClientApproval && primary.key === 'direct' && (
            <p className="w-full text-[12px] text-muted-foreground">
              {NOT_CLIENT_APPROVED}. Posting this signs it off in your name.
            </p>
          )}

          {state.scheduledFor && status === 'approved' && (
            <p className="w-full text-[12px] text-muted-foreground">
              Once it is booked in, this post goes out on its own at{' '}
              {formatInZone(state.scheduledFor, tz, 'full') ?? clockPillLabel(state.scheduledFor, tz)}.
            </p>
          )}
        </div>
      </div>

      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        itemId={target.itemId}
        approved={target.approved}
        versionLabel={`${target.title} · version ${target.versionNumber ?? 1}`}
        slides={state.slides}
        platforms={platforms}
        onSave={saveMedia}
        onEditSlide={index => { setPicking(false); editSlide(index) }}
        saving={busy}
      />
    </div>
  )
}

const KIND_WORD: Record<PostKind, string> = {
  feed: 'Feed post', reel: 'Reel', story: 'Story', carousel: 'Carousel',
}

/** A server refusal that carried a whole list of things to fix. */
class ComposeProblem extends Error {
  problems: string[]
  constructor(json: unknown) {
    const j = (json ?? {}) as { error?: string; problems?: string[] }
    super(j.error ?? 'That did not work')
    this.problems = Array.isArray(j.problems) && j.problems.length > 0
      ? j.problems
      : [friendlyError(j.error ?? '', 'this post')]
  }
}

function problemsOf(e: unknown): string[] {
  if (e instanceof ComposeProblem) return e.problems
  return [friendlyError(e instanceof Error ? e.message : '', 'this post')]
}

/**
 * A pill that opens a small panel under it.
 *
 * Its own container, its own outside-click: the whole set used to share one
 * ref pointing at the dialog card, so clicking the caption box left the
 * channel list hanging open over the words being typed.
 */
function Dropdown({ label, width, closeOnPick = true, children }: {
  label: React.ReactNode
  width: number
  /**
   * Does clicking inside the panel finish the job?
   *
   * True for the post-type menu — one choice and you are done. FALSE for the
   * channels list, which is a MULTI-SELECT with tick marks: closing it on the
   * first tick means reopening the pill for every extra account, which is
   * what happened when all the panels were given one shared close.
   */
  closeOnPick?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-paper px-3 text-[13px] font-semibold hover:bg-muted"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div
          style={{ width }}
          onClick={closeOnPick ? () => setOpen(false) : undefined}
          className="absolute left-0 top-[calc(100%+6px)] z-50 rounded-inner border border-border bg-popover p-1.5 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center rounded-tile px-2 text-left text-[13px] hover:bg-muted"
    >
      {children}
    </button>
  )
}

/** The footer's one button, with the ways to save it that are not the
 *  obvious one tucked behind the chevron. */
function SplitButton({ label, disabled, onPrimary, items, onPick }: {
  label: string
  disabled: boolean
  onPrimary: () => void
  items: { key: string; label: string }[]
  onPick: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  return (
    <div ref={box} className="relative flex">
      <button
        type="button"
        disabled={disabled}
        onClick={onPrimary}
        className="flex min-h-11 items-center rounded-l-full bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-60"
      >
        {label}
      </button>
      <button
        type="button"
        aria-label="More ways to save this post"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-11 w-10 items-center justify-center rounded-r-full border-l border-background/20 bg-foreground text-background"
      >
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%+6px)] right-0 z-50 w-[260px] rounded-inner border border-border bg-popover p-1.5 shadow-lg">
          {items.map(m => (
            <MenuItem key={m.key} onClick={() => { setOpen(false); onPick(m.key) }}>
              {m.label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One row of "More options", for the channels it actually applies to.
 *
 * ONE renderer for every setting, driven by the table in
 * `schedule-compose-core`: a row is a control kind, a label and the one field
 * it writes. Adding a posting option is a line in that table, not another
 * branch here — which is what keeps the window and the provider in step.
 *
 * Two rows are their own shape. LOCATION, because Instagram takes a numeric
 * Facebook Page id and there is no place search anywhere in the chain, so the
 * row offers the client's saved places first and a box for the number second.
 * And CONSENT, because it is not a setting with a default — it is a statement
 * somebody makes, once per post, and TikTok will not take the post without it.
 */
function ExtraRow({ option, channels, state, dispatch, locations, lists }: {
  option: MoreOption
  channels: SocialAccount[]
  state: ComposerState
  dispatch: (a: { type: 'extra'; channel: string; patch: ChannelExtras }) => void
  locations: SavedLocation[]
  /** the per-account lists fetched from the network, by account id */
  lists: Record<string, ChannelOptions>
}) {
  const first = channels[0]
  const value = first ? state.perChannel[first.id] ?? {} : {}
  const held = (value as Record<string, unknown>)[option.field]
  const [open, setOpen] = useState(held !== undefined && held !== '')
  if (!first) return null

  /** every channel this row covers gets the same answer: one Instagram
   *  account per client is the case that exists, and two would want two rows
   *  — the same per-channel question the one-caption-for-all decision parked */
  const applyAll = (patch: ChannelExtras) => {
    for (const c of channels) dispatch({ type: 'extra', channel: c.id, patch })
  }
  const set = (v: unknown) => applyAll({ [option.field]: v } as ChannelExtras)

  const help = option.help
    ? <p className="text-[11px] text-muted-foreground">{option.help}</p>
    : null
  const field = 'min-h-11 w-full rounded-full border border-border bg-surface px-3 text-[13px]'

  /* ── a tick box: on, off, and what the ACCOUNT does untouched ── */
  if (option.control === 'toggle') {
    // what the ACCOUNT does untouched beats what the network does untouched:
    // a TikTok creator whose own answer to "allow duets" is no must not see a
    // ticked box, and one whose account will not let it be changed at all
    // must not be able to change it here either
    const account = lists[first.id]?.interactions as Record<string, boolean> | null | undefined
    const rules = lists[first.id]?.interactionRules as
      Record<string, { enabled: boolean; required: boolean; label: string }> | null | undefined
    const seeded = account?.[option.field as string]
    const rule = rules?.[option.field as string]
    const locked = rule ? rule.enabled === false : false
    const value = locked
      ? (seeded ?? false)
      : held === undefined ? (seeded ?? Boolean(option.defaultOn)) : Boolean(held)
    return (
      <div className="flex flex-col gap-1">
        <label className={cn(
          'flex min-h-11 items-center gap-2.5 text-[14px] font-medium',
          locked && 'text-muted-foreground',
        )}>
          <input
            type="checkbox"
            checked={value}
            disabled={locked}
            onChange={e => set(e.target.checked)}
            className="h-4 w-4"
          />
          {option.label}
        </label>
        {locked && (
          <p className="text-[11px] text-muted-foreground">
            {`This account does not let “${rule?.label ?? option.label}” be changed.`}
          </p>
        )}
        {help}
      </div>
    )
  }

  /* ── TikTok's one tick, which a post cannot go out without ── */
  if (option.control === 'consent') {
    const given = Boolean(held)
    return (
      <div className={cn(
        'flex flex-col gap-1.5 rounded-inner border p-3',
        given ? 'border-border' : 'border-accent-amber/50 bg-tint-amber',
      )}>
        <p className="text-[12px] leading-[1.45]">{TIKTOK_CONSENT_LINE}</p>
        <label className="flex min-h-11 items-center gap-2.5 text-[14px] font-medium">
          <input
            type="checkbox"
            checked={given}
            onChange={e => set(e.target.checked || undefined)}
            className="h-4 w-4"
          />
          {option.label}
        </label>
      </div>
    )
  }

  /* ── a menu: the network's own list where there is one ── */
  if (option.control === 'select') {
    const fetched: OptionChoice[] = option.source
      ? (lists[first.id]?.[option.source] ?? [])
      : []
    const choices = fetched.length > 0 ? fetched : option.choices ?? []
    const current = held === undefined ? '' : String(held)
    // a list we could not read is a box to type in, not a menu with nothing
    // in it: a LinkedIn company page nobody can pick is a post that cannot go
    // out as the company
    if (choices.length === 0) {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-muted-foreground">{option.label}</span>
          <input
            value={current}
            onChange={e => set(e.target.value.trim() || undefined)}
            placeholder={option.placeholder ?? 'Paste the id'}
            className={field}
          />
          <p className="text-[11px] text-muted-foreground">
            {`We could not read this list from ${networkName(String(first.platform))} just now. `}
            Leave it empty and the network decides.
          </p>
        </div>
      )
    }
    const hasBlank = choices.some(c => c.value === '')
    return (
      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-muted-foreground">{option.label}</span>
          <select
            value={choices.some(c => c.value === current) ? current : ''}
            onChange={e => set(e.target.value || undefined)}
            className={field}
          >
            {!hasBlank && <option value="">Leave it to the network</option>}
            {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {help}
      </div>
    )
  }

  /* ── the place a post is tagged to ── */
  if (option.control === 'location') {
    const id = String(value.locationId ?? '')
    const bad = id !== '' && !isPageId(id)
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
        >
          <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
          {option.label}
          {id && !bad && (
            <span className="text-[12px] font-normal text-muted-foreground">
              — {locations.find(l => l.pageId === id)?.name ?? id}
            </span>
          )}
        </button>
        {open && (
          <div className="flex flex-col gap-1.5">
            {locations.length > 0 && (
              <select
                value={locations.some(l => l.pageId === id) ? id : ''}
                onChange={e => set(e.target.value || undefined)}
                className={field}
              >
                <option value="">No place</option>
                {locations.map(l => (
                  <option key={l.pageId} value={l.pageId}>{l.name}</option>
                ))}
              </select>
            )}
            <input
              value={id}
              inputMode="numeric"
              onChange={e => set(e.target.value.trim() || undefined)}
              placeholder="…or paste a Facebook Page ID"
              className={field}
            />
            <p className={cn('text-[11px]', bad ? 'font-medium text-accent-red' : 'text-muted-foreground')}>
              {bad
                ? 'That does not look like a Page ID — it is a long number, not the @name.'
                : locations.length > 0
                  ? `Saved places come from this client's Social page. ${PAGE_ID_HELP}`
                  : `No places saved for this client yet. ${PAGE_ID_HELP}`}
            </p>
          </div>
        )}
      </div>
    )
  }

  /* ── a list of words: tags, collaborators ── */
  if (option.control === 'tags' || option.control === 'collaborators') {
    return (
      <ListRow
        option={option}
        value={Array.isArray(held) ? held as string[] : []}
        open={open}
        onToggle={() => setOpen(o => !o)}
        onChange={list => set(list.length > 0 ? list : undefined)}
      />
    )
  }

  /* ── everything else typed: one line, several lines, or a moment ── */
  const shown = option.control === 'seconds'
    ? (typeof held === 'number' ? String(Math.round(held / 100) / 10) : '')
    : String(held ?? '')

  const badUrn = option.field === 'organizationUrn' && shown !== '' && !isOrganizationUrn(shown)

  const write = (raw: string) => {
    if (option.control === 'seconds') {
      const seconds = Number(raw)
      set(raw.trim() && Number.isFinite(seconds) && seconds >= 0
        ? Math.round(seconds * 1000) : undefined)
      return
    }
    set(raw || undefined)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
        {option.label}
        {!open && shown && (
          <span className="truncate text-[12px] font-normal text-muted-foreground">— {shown}</span>
        )}
      </button>
      {open && (
        <>
          {option.control === 'longText' ? (
            <textarea
              value={shown}
              rows={3}
              onChange={e => write(e.target.value)}
              placeholder={option.placeholder}
              className="w-full resize-y rounded-inner border border-border bg-surface px-3 py-2 text-[13px]"
            />
          ) : (
            <input
              value={shown}
              inputMode={option.control === 'seconds' ? 'decimal' : undefined}
              onChange={e => write(e.target.value)}
              placeholder={option.control === 'seconds' ? 'Seconds in — for example 2.5' : option.placeholder}
              className={field}
            />
          )}
          {badUrn && (
            <p className="text-[11px] font-medium text-accent-red">
              That does not look like a company page — pick one from the list, or paste
              its id, a plain number.
            </p>
          )}
          {help}
        </>
      )}
    </div>
  )
}

/**
 * A list of short words — YouTube's tags, Instagram's collaborators.
 *
 * IT HOLDS WHAT WAS TYPED, not what has been parsed. The first version
 * rendered the parsed array joined with commas on every keystroke, so typing
 * a comma produced a list of one, which rendered back without the comma — the
 * separator was erased by the keystroke that typed it, and a second tag could
 * never be started. The raw string lives here; a comma, Enter or leaving the
 * box is what commits it.
 */
function ListRow({ option, value, open, onToggle, onChange }: {
  option: MoreOption
  value: string[]
  open: boolean
  onToggle: () => void
  onChange: (list: string[]) => void
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const shown = raw ?? value.join(', ')
  const max = option.control === 'collaborators' ? 3 : 50

  const commit = (text: string) => {
    const list: string[] = []
    for (const part of text.split(',')) {
      const word = part.trim().replace(/^@/, '')
      if (word && !list.includes(word)) list.push(word)
    }
    const capped = list.slice(0, max)
    setRaw(null)
    onChange(capped)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
        {option.label}
        {!open && value.length > 0 && (
          <span className="truncate text-[12px] font-normal text-muted-foreground">
            — {value.join(', ')}
          </span>
        )}
      </button>
      {open && (
        <>
          {value.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {value.map(word => (
                <span
                  key={word}
                  className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] font-medium"
                >
                  {word}
                  <button
                    type="button"
                    aria-label={`Take ${word} off`}
                    onClick={() => onChange(value.filter(w => w !== word))}
                    className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted"
                  >
                    <X className="h-3 w-3" strokeWidth={2.2} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            value={shown}
            onChange={e => {
              // a comma is what finishes a word, so it commits rather than
              // waiting for the box to be left
              if (e.target.value.endsWith(',')) { commit(e.target.value); return }
              setRaw(e.target.value)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              commit(shown)
            }}
            onBlur={() => commit(shown)}
            placeholder={option.placeholder}
            className="min-h-11 w-full rounded-full border border-border bg-surface px-3 text-[13px]"
          />
          {option.help && <p className="text-[11px] text-muted-foreground">{option.help}</p>}
        </>
      )}
    </div>
  )
}
