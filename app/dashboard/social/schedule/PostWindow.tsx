'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Clock, Eye, Pencil, Plus, Trash2, Wand2, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClientContact, ContentItem, EncodeJob, FollowerSnapshot, PostComment, PostVersion, SocialAccount, SocialPost } from '@/lib/db-types'
import { useRow, useTable } from '@/lib/db-client'
import { accountSections, ownerLabel } from '../../../lib/account-owner-core'
import { copiesReadyAt, earliestSafeTime } from '@/app/lib/encode-eta-core'
import { TRIAL_CHOICES, TRIAL_SENTENCE, latestFollowerCount, postTrial, trialFollowersProblem } from '@/app/lib/trial-reel-core'
import { coverPatchFor, currentCover } from '@/app/lib/cover-core'
import CoverPicker from './CoverPicker'
import Tour, { useTourOnce } from './Tour'
import { POST_WINDOW_TOUR } from '@/app/lib/tour-core'
import {
  clockPillLabel, composerReducer, groupOptions, initialComposer, moreOptionsFor, optionsFromExtras,
  readLocations, durationWords,
  type ChannelExtras, type SavedLocation,
} from '@/app/lib/schedule-compose-core'
import {
  AGREED_VIA, APPROVAL_STEPS, APPROVAL_STEPS_LABEL, approvalStepsOf, compositionProblems, defaultApproveBy,
  hatsFor, isReminderSend, lostChannels, postActions, postVersionId, readPostState,
  type AccountRef, type OfferedAction, type PostAction, type PostActionList, type PostStage, type PostState,
} from '@/app/lib/post-stage-core'
import {
  AGREED_VIA_CHOICES, CLOSE_QUESTION, STAYS_OPEN, answerProblem, applyInstagramChoice, bodyEditable, closeChoices, hasUnsavedChanges,
  defaultPostTime, footerButtons, frozenCopyOf, instagramChoices, instagramCounter,
  noteVersionOf, nowChip, pressAction, questionFor, readPostNotes, timeHint, unsavedPost, windowHeader,
  withWorkingCopy, workingBody, workingCopyOf,
  type Answers, type InstagramChoiceKey, type NoteInput, type PostWindowApi, type Question, type WorkingCopy,
} from '@/app/lib/post-window-core'
import type { SuggestedTime } from '@/app/lib/social-schedule-core'
import { clientRecipients, defaultRecipients } from '@/app/lib/client-recipients-core'
import {
  autoKindFor, availableKinds, isPlatform, networkName,
  type MediaItem, type Platform, type PostKind,
} from '@/app/lib/publish-core'
import { quotaWords } from '@/app/lib/quota-core'
import { copiesToPrepare } from '@/app/lib/encode-ahead-core'
import { copyAheadWords } from '@/app/lib/shrink-core'
import { PLATFORM_MEDIA, type AssetProbe } from '@/app/lib/media-fit-core'
import { isMeasured, measureUrl } from '@/app/lib/measure-media-client'
import AssetCheck from '../AssetCheck'
import { usePlayable } from '../usePlayable'
import { buildPostPreview, POST_KIND_WORD, PREVIEW_INTRO } from '@/app/lib/post-preview-core'
import PostPreviewPane from '@/app/components/social/PostPreview'
import { instagramGrid } from '@/app/lib/portal-core'
import type { ChannelOptions } from '@/app/lib/publisher'
import { formatInZone, safeZone } from '@/app/lib/timezone-core'
import type { Slide } from '@/app/lib/version-files-core'
import Chip from '../../ui/Chip'
import PlatformIcon from '../PlatformIcon'
import { useRole } from '../../useRole'
import { useTeamMembers } from '../../production/workHooks'
import type { ImageEditorTarget } from './ImageEditor'
import MediaPicker from './MediaPicker'
import PostNotes from './PostNotes'
import AutomationSection from './AutomationSection'
import { Dropdown, ExtraRow, MenuItem } from './PostOptionRows'
import TimePicker from './TimePicker'
import { Thumb } from './tiles'
import { addPostNote, postWindowApi } from './post-window-api'

/**
 * THE POST WINDOW — one window for one post, the same wherever it opens
 * (the posting rebuild, 29 Sep 2026; SPEC §4.1 as the owner's decisions 2, 9,
 * 10 and 11 changed it). It replaces NewPostDialog.
 *
 *   TOP     the stage and what happens next — `windowHeader`, read from the
 *           post's own `stage`, never from the edit card (audit B5, W5).
 *   MIDDLE  the post: slides, caption, networks, time. Editable only while it
 *           is a draft; anywhere else it is the FROZEN version, read-only, and
 *           "Edit — makes version N" is a footer button (decision 8).
 *   BOTTOM  only the buttons `postActions` gives this person for this stage,
 *           rendered as they are. A question a button asks, and any refusal,
 *           sits right above the buttons, never below the fold (decision 2;
 *           audit W8). There is no "review only" mode and no second way to
 *           send to the client (audit W6, W10).
 *
 * After a press the window shows what the SERVER says happened, read from the
 * stage the post landed in — never "Booked in" for a booking that failed
 * (audit W4).
 */

/** What the page is told once a press has finished and the window closes. */
export type PostWindowOutcome = {
  postId: string | null
  itemId: string | null
  /** the server's own words: "Passed — now in Ready to post" */
  words: string
  stage: PostStage | 'deleted'
  /** the posting time, for "Show on calendar" */
  at: string | null
  channels: string[]
  /** a post the move made (Post the missing networks, Duplicate) — the page can open it */
  createdPostId?: string | null
  /** a client send by link: the client's page, for the person to paste */
  link?: string | null
}

/** A post that does not exist yet: the piece its files come from. */
export type PostWindowSeed = {
  itemId: string
  title: string
  /** the files it starts with */
  slides: Slide[]
  /** every file of the piece — the media picker's first tab */
  pieceFiles: Slide[]
  versionNumber: number | null
  coverUrl: string | null
  /** the time a click on the calendar meant */
  at: string | null
}

/** The client the post belongs to, as the page has already loaded it. */
export type PostWindowContext = {
  clientId: string
  tz: string
  client: {
    name?: string | null
    email?: string | null
    contact_name?: string | null
    client_approval_required?: boolean | null
    /** names the campaign on an automation's link (utm_campaign) */
    slug?: string | null
  } | null
  /** the channels that work — what a new post can be sent to */
  accounts: SocialAccount[]
  /** every channel, working or not — what the guards check a booking against */
  allAccounts?: SocialAccount[]
  contacts?: ClientContact[]
  locations?: SavedLocation[]
  suggested?: SuggestedTime[]
}

type Reply = { action: string; tone: 'ok' | 'error'; text: string; problems: string[] }

const EMPTY_LIST: PostActionList = { primary: null, secondary: [], danger: null }

export default function PostWindow({
  postId: openedId, seed = null, context, onClose, onOpenPost, onEditMedia, onDone, api = postWindowApi,
}: {
  /** the post to open, or null for a new one made from `seed` */
  postId: string | null
  seed?: PostWindowSeed | null
  context: PostWindowContext
  onClose: () => void
  /** a new post got its id — the page keeps it, so the live row follows */
  onOpenPost?: (postId: string) => void
  /** open the page's one image editor on a picture of this post */
  onEditMedia?: (target: ImageEditorTarget) => void
  /** a press finished and the window closes; the page says what happened */
  onDone?: (outcome: PostWindowOutcome) => void
  /** the server — the real routes unless a test hands in a fake */
  api?: PostWindowApi
}) {
  const { tz, accounts } = context
  const contacts = useMemo(() => context.contacts ?? [], [context.contacts])
  const locations = useMemo(() => context.locations ?? [], [context.locations])
  const suggested = context.suggested ?? []
  const { me } = useRole()
  const team = useTeamMembers(me?.role === 'account_manager' || me?.role === 'super_admin')

  /* ── the post, live ──────────────────────────────────────────────────── */

  const [id, setId] = useState<string | null>(openedId)
  const { row, loading: rowLoading } = useRow<SocialPost>('social_posts', id)
  const live = useMemo(() => readPostState(row as unknown as Record<string, unknown> | null), [row])
  /** the post as the server last answered a press — drawn at once, until the live row catches up */
  const [answered, setAnswered] = useState<PostState | null>(null)
  const saved: PostState | null = useMemo(() => {
    const a = answered && answered.id === id ? answered : null
    if (live && a) return a.rev > live.rev ? a : live
    return live ?? a
  }, [live, answered, id])
  const itemId = seed?.itemId ?? saved?.source_item_id ?? null
  const { row: itemRow } = useRow<ContentItem>('content_items', itemId)
  const title = seed?.title ?? (itemRow as { title?: string } | null)?.title ?? 'Post'

  /* ── the working copy ────────────────────────────────────────────────── */

  // opens on the post's own working copy when the row is already here, so
  // the first frame already judges what the post holds
  const [state, dispatch] = useReducer(composerReducer, null, () => (saved
    ? initialComposer({ itemId: itemId ?? '', postId: saved.id, ...composerFieldsOf(workingCopyOf(saved)) })
    : initialComposer({
      itemId: itemId ?? '',
      postId: openedId,
      slides: seed?.slides ?? [],
      scheduledFor: seed?.at ?? null,
      channels: seed ? (accounts[0] ? [accounts[0].id] : []) : [],
    })))
  const working: WorkingCopy = useMemo(() => ({
    slides: state.slides, caption: state.caption, channels: state.channels,
    perChannel: state.perChannel, scheduledFor: state.scheduledFor,
    ...(state.automation !== undefined ? { automation: state.automation } : {}),
  }), [state.slides, state.caption, state.channels, state.perChannel, state.scheduledFor, state.automation])

  /**
   * The row is live, and the window follows it WITHOUT taking what somebody
   * is typing: a new rev is loaded only while nothing is unsaved. A change
   * that lands under unsaved work is said, not applied.
   */
  const loadedKey = useRef<string | null>(saved ? `${saved.id}:${saved.rev}` : null)
  const [movedUnder, setMovedUnder] = useState(false)
  /** a press of ours is on its way to the server */
  const savingRef = useRef(false)
  useEffect(() => {
    if (!saved) return
    const key = `${saved.id}:${saved.rev}`
    if (loadedKey.current === key) return
    const samePost = loadedKey.current?.startsWith(`${saved.id}:`) ?? false
    // OUR OWN SAVE IS NOT SOMEONE ELSE (live test, 29 Sep 2026): the live row often lands before the Save's own
    // answer, so while a press is in flight a new rev is ours — wait for the answer instead of crying conflict
    if (samePost && state.dirty && savingRef.current) return
    if (samePost && state.dirty) { setMovedUnder(true); return }
    loadedKey.current = key
    setMovedUnder(false)
    dispatch({ type: 'loaded', state: { postId: saved.id, ...composerFieldsOf(workingCopyOf(saved)) } })
  }, [saved, state.dirty])

  /* WHOM THE POST IS FOR (15 Sep 2026): a piece made "for" one of the client's
   * people opens a NEW post on that person's channels, not the first account
   * on the list. And never the wrong account ("we might be editing for the
   * client but end up posting"): a person with no account connected starts
   * with NO channel picked, and the window says so. A saved post keeps its own. */
  const postForId = (itemRow as { for_contact_id?: string | null } | null)?.for_contact_id ?? null
  const postForPerson = postForId ? contacts.find(c => c.id === postForId) ?? null : null
  const personHasNoAccounts = !!postForId && !accounts.some(a => a.contact_id === postForId)
  const seededFor = useRef(false)
  useEffect(() => {
    if (seededFor.current || state.postId || !itemRow) return
    const who = postForId
    if (!who) { seededFor.current = true; return }
    const theirs = accounts.filter(a => a.contact_id === who).map(a => a.id)
    seededFor.current = true
    for (const a of accounts) {
      const on = theirs.includes(a.id)
      if (state.channels.includes(a.id) !== on) dispatch({ type: 'channel', id: a.id, on })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemRow, accounts])

  /* ── the clock: a missed time appears while the window is open (audit S12) ── */

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  /* ── who is looking, and what they may press ─────────────────────────── */

  const unsaved = !id
  const base: PostState | null = saved ?? (unsaved
    ? unsavedPost({ clientId: context.clientId, createdBy: me?.id ?? null, working, timezone: tz, sourceItemId: itemId })
    : null)
  const post = base ? withWorkingCopy(base, working) : null
  const editable = post ? bodyEditable(post) : false
  const hats = useMemo(() => (me && post ? hatsFor(me, post) : []), [me, post])
  const accountRefs: AccountRef[] = useMemo(
    () => (context.allAccounts ?? accounts).map(a => ({ id: a.id, platform: String(a.platform), live: a.active !== false, name: a.username ?? a.name })),
    [context.allAccounts, accounts])
  const recipients = useMemo(() => clientRecipients(context.client, contacts), [context.client, contacts])
  const list: PostActionList = useMemo(
    () => (post && hats.length > 0
      ? postActions(post, hats, nowMs, { accounts: accountRefs, client: context.client, clientHasContact: recipients.length > 0 })
      : EMPTY_LIST),
    [post, hats, nowMs, accountRefs, context.client, recipients.length])
  const buttons = footerButtons(list)
  const now = nowChip(list)

  const nameOf = useCallback((who: string | null | undefined) => {
    if (!who) return null
    if (me && who === me.id) return me.name
    return team.find(t => t.id === who)?.name ?? null
  }, [me, team])

  /* ── the frozen version: what the reviewer and the client were sent ──── */

  const versionId = saved && saved.stage !== 'draft' && saved.sent_version != null ? postVersionId(saved.id, saved.sent_version) : null
  const { row: versionRow } = useRow<PostVersion>('post_versions', versionId)
  const frozen = useMemo(() => frozenCopyOf(versionRow as unknown as Record<string, unknown> | null), [versionRow])
  /** what the middle draws: the working copy while it is a draft, the frozen version after */
  const shown: WorkingCopy = editable || !saved ? working : (frozen ?? workingCopyOf(saved))
  const header = post ? windowHeader(post, nowMs, { nameOf, tz, frozenAt: frozen?.frozenAt ?? null, unsaved }) : null

  /* ── what is on screen, read as the composer reads it ────────────────── */

  const chosen = useMemo(() => accountsFor(shown.channels, context.allAccounts ?? accounts), [shown.channels, context.allAccounts, accounts])
  const platforms = useMemo(() => [...new Set(chosen.map(a => String(a.platform)))], [chosen])
  const lost = useMemo(() => (post ? lostChannels({ channels: shown.channels }, accountRefs) : []), [post, shown.channels, accountRefs])
  const [picking, setPicking] = useState(false)
  const [pane, setPane] = useState<'write' | 'preview'>('write')
  const [chosenSlide, setChosenSlide] = useState(0)

  // measure a slide nobody measured, so the checks below can judge its shape
  useEffect(() => {
    if (!editable) return
    const todo = state.slides.filter(sl => !isMeasured(sl))
    if (todo.length === 0) return
    let cancelled = false
    void Promise.all(todo.map(async sl => [sl.url, await measureUrl(sl.url, sl.type)] as const)).then(found => {
      if (cancelled) return
      const by = new Map(found.filter(([, m]) => m.width && m.height))
      if (by.size === 0) return
      dispatch({ type: 'measured', slides: state.slides.map(sl => (by.has(sl.url) ? { ...sl, ...by.get(sl.url) } : sl)) })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, state.slides.map(sl => sl.url).join('|')])

  const playable = usePlayable()
  const probes = useMemo<AssetProbe[]>(() => shown.slides.map(sl => ({
    url: sl.url, type: sl.type,
    ...(sl.bytes ? { bytes: sl.bytes } : {}),
    ...(sl.width && sl.height ? { width: sl.width, height: sl.height } : {}),
    ...(sl.seconds ? { seconds: sl.seconds } : {}),
  })), [shown.slides])
  const checkPlatforms = useMemo(() => platforms.filter(isPlatform), [platforms])
  const checkKinds = useMemo(() => {
    const out: Partial<Record<Platform, PostKind>> = {}
    for (const a of chosen) {
      const p = String(a.platform)
      const k = shown.perChannel[a.id]?.kind
      if (isPlatform(p) && k) out[p] = k as PostKind
    }
    return out
  }, [chosen, shown.perChannel])

  /** the channels a clean copy of a big video is being made for */
  const copyAsks = useMemo(() => {
    const video = shown.slides.length === 1 && shown.slides[0].type === 'video' ? shown.slides[0] : null
    if (!video || typeof video.bytes !== 'number') return []
    const list: Platform[] = []
    const kindFor: Partial<Record<Platform, PostKind>> = {}
    const own: Partial<Record<Platform, MediaItem[]>> = {}
    for (const account of chosen) {
      const p = String(account.platform)
      if (!isPlatform(p)) continue
      list.push(p)
      const extras = shown.perChannel[account.id]
      if (extras?.kind) kindFor[p] = extras.kind as PostKind
      if (extras?.slides?.length) own[p] = extras.slides.map(sl => ({ url: sl.url, type: sl.type === 'video' ? 'video' as const : 'image' as const }))
    }
    return copiesToPrepare({ probes: [{ url: video.url, type: 'video', bytes: video.bytes }], platforms: list, kinds: kindFor, own })
  }, [shown.slides, shown.perChannel, chosen])
  const copyPlatforms = useMemo(() => copyAsks.map(a => a.platform), [copyAsks])
  const preparingCopy = copyAsks.length > 0 ? copyAheadWords(copyAsks.map(a => PLATFORM_MEDIA[a.platform]?.label ?? a.platform)) : null

  /* the earliest time the encoder's copies can make — a draft's default time moves to it; a chosen one is never moved */
  const encodeRows = useTable<EncodeJob>('encode_jobs')
  const videoUrl = shown.slides.length === 1 && shown.slides[0].type === 'video' ? shown.slides[0].url : null
  const copiesReady = useMemo(() => {
    if (!videoUrl) return null
    return copiesReadyAt((encodeRows.rows ?? []).filter(r => r.source_url === videoUrl), chosen.map(a => String(a.platform)), Date.now())
  }, [encodeRows.rows, videoUrl, chosen])
  const safeAt = useMemo(
    () => (copiesReady === null ? null : Math.ceil(earliestSafeTime(Date.now(), copiesReady) / 60_000) * 60_000),
    [copiesReady])
  const chosenMs = shown.scheduledFor ? new Date(shown.scheduledFor).getTime() : NaN
  const beforeCopies = safeAt !== null && Number.isFinite(chosenMs) && chosenMs < safeAt
  const pickedTime = useRef(false)
  useEffect(() => {
    if (!editable || !beforeCopies || safeAt === null || pickedTime.current) return
    dispatch({ type: 'time', iso: new Date(safeAt).toISOString(), quiet: true })
  }, [editable, beforeCopies, safeAt])
  const copyNames = [...new Set(chosen.map(a => networkName(String(a.platform))))].join(', ')
  const copiesLine = safeAt === null || copiesReady === null ? null
    : `Clean copies for ${copyNames} are still being made — ready by about ${formatInZone(new Date(copiesReady).toISOString(), tz, 'time')}. ${
      beforeCopies
        ? `The time on this post is before that — the earliest safe time is ${formatInZone(new Date(safeAt).toISOString(), tz, 'time')}.`
        : `The earliest safe time is ${formatInZone(new Date(safeAt).toISOString(), tz, 'time')}.`
    }`

  /* ── the post type, the trial reel, the options ───────────────────────── */

  const lead = platforms[0]
  const media = useMemo(() => shown.slides.map(s => ({ url: s.url, type: s.type })), [shown.slides])
  const kinds: PostKind[] = lead && isPlatform(lead) ? availableKinds(lead, media) : []
  const pickedKind = (shown.perChannel[chosen[0]?.id ?? '']?.kind ?? '') as PostKind | ''
  const autoKind = lead && isPlatform(lead) ? autoKindFor(lead, media) : null
  const effectiveKind = pickedKind || autoKind || undefined
  const allStory = chosen.length > 0 && chosen.every(a => {
    const p = String(a.platform)
    const k = shown.perChannel[a.id]?.kind ?? (isPlatform(p) ? autoKindFor(p, media) : null)
    return k === 'story'
  })
  const instagramChannels = chosen.filter(a => String(a.platform) === 'instagram')
  const trial = postTrial(shown.perChannel, instagramChannels)
  const trialPossible = editable && instagramChannels.length > 0
    && media.length === 1 && media[0].type === 'video' && availableKinds('instagram', media).includes('reel')
  const followerRows = useTable<FollowerSnapshot>('follower_snapshots')
  const trialBlocked = useMemo(() => {
    for (const a of instagramChannels) {
      const why = trialFollowersProblem(latestFollowerCount(followerRows.rows, a.id), a.username)
      if (why) return why
    }
    return null
  }, [followerRows.rows, instagramChannels])
  const setTrial = (strategy: 'MANUAL' | 'SS_PERFORMANCE' | '') => {
    for (const a of instagramChannels) dispatch({ type: 'extra', channel: a.id, patch: { kind: 'reel', trialGraduation: strategy || undefined } })
  }
  const mediaLead: 'video' | 'image' | null = shown.slides[0] ? (shown.slides[0].type === 'video' ? 'video' : 'image') : null
  const options = moreOptionsFor(platforms, effectiveKind, mediaLead)
  const groups = groupOptions(options)
  const picked = chosenSlide < shown.slides.length ? chosenSlide : 0
  const shownSlide = shown.slides[picked] ?? null

  /* the lists only the network knows — playlists, pages, privacy levels, today's cap. Drafts only. */
  const [lists, setLists] = useState<Record<string, ChannelOptions>>({})
  const asked = useRef<Set<string>>(new Set())
  const needsList = useMemo(() => new Set([...options.filter(o => o.source).flatMap(o => o.platforms), 'instagram', 'tiktok']), [options])
  const askedKind = mediaLead === 'image' ? 'photo' : 'video'
  useEffect(() => {
    if (!editable) return
    let on = true
    for (const account of chosen) {
      if (!needsList.has(String(account.platform))) continue
      const key = `${account.id}:${askedKind}`
      if (asked.current.has(key)) continue
      asked.current.add(key)
      fetch(`/api/social/schedule/options?accountId=${encodeURIComponent(account.id)}&mediaType=${askedKind}`)
        .then(r => (r.ok ? r.json() : null))
        .then(json => {
          if (!on || !json || json.error) return
          const listed = json as ChannelOptions
          setLists(prev => ({ ...prev, [account.id]: listed }))
          // what the ACCOUNT forbids becomes the post's answer — never turning on what nobody asked for
          const seedI = listed.interactions
          if (!seedI) return
          const patch: ChannelExtras = {}
          if (!seedI.allowComment) patch.allowComment = false
          if (!seedI.allowDuet) patch.allowDuet = false
          if (!seedI.allowStitch) patch.allowStitch = false
          if (Object.keys(patch).length > 0) dispatch({ type: 'extra', channel: account.id, patch })
        })
        .catch(() => { /* an unreadable list is a box to type in, not a failure */ })
    }
    return () => { on = false }
  }, [editable, chosen, needsList, askedKind])
  const caps = useMemo(() => {
    const lines: { id: string; line: string }[] = []
    const stops: string[] = []
    for (const account of chosen) {
      const listed = lists[account.id]
      if (!listed) continue
      const { line, problem } = quotaWords({ platform: String(account.platform), handle: account.username ?? account.name, quota: listed.quota, canPostMore: listed.canPostMore })
      if (line) lines.push({ id: account.id, line })
      if (problem) stops.push(problem)
    }
    const soon = !shown.scheduledFor || new Date(shown.scheduledFor).getTime() - Date.now() < 24 * 3600_000
    return { lines, stops: soon ? stops : [] }
  }, [chosen, lists, shown.scheduledFor])
  const tiktokLimit = useMemo(() => {
    const account = chosen.find(a => String(a.platform) === 'tiktok')
    const seconds = account ? lists[account.id]?.maxVideoDurationSec : null
    if (!seconds || mediaLead !== 'video') return null
    return `This TikTok account takes videos up to ${durationWords(seconds)} long.`
  }, [chosen, lists, mediaLead])

  const preview = useMemo(() => buildPostPreview({
    caption: shown.caption,
    media: shown.slides.map(sl => ({ url: sl.url, type: sl.type, name: sl.name })),
    channels: chosen.map(a => {
      const extras = shown.perChannel[a.id]
      const opts = optionsFromExtras(extras)
      const place = locations.find(l => l.pageId === String(opts.locationId ?? ''))
      return {
        id: a.id, platform: String(a.platform), handle: a.username ?? null, name: a.name ?? null, avatarUrl: a.avatar_url,
        options: opts,
        media: extras?.slides?.length ? extras.slides.map(sl => ({ url: sl.url, type: sl.type, name: sl.name })) : null,
        placeName: place?.name ?? null,
      }
    }),
  }), [shown.slides, shown.caption, shown.perChannel, chosen, locations])

  /** HOW IT SITS ON THE CLIENT'S INSTAGRAM (the owner's decision 16): the same
   *  grid the client's review page shows — this post first, then the newest
   *  posts already live there. Only when Instagram is one of its channels. */
  const clientPostsKey = useMemo(() => ({ client_id: context.clientId }), [context.clientId])
  const clientPosts = useTable<SocialPost>('social_posts', { by: clientPostsKey, enabled: pane === 'preview' })
  const grid = useMemo(() => {
    const all = context.allAccounts ?? accounts
    const platformOf = (acc: string) => all.find(a => a.id === acc)?.platform ?? null
    if (!shown.channels.some(acc => String(platformOf(acc) ?? '') === 'instagram')) return null
    const others = clientPosts.rows
      .filter(r => r.client_id === context.clientId)
      .map(r => readPostState(r as unknown as Record<string, unknown>))
      .filter((p): p is PostState => !!p)
    return instagramGrid(
      { id: id ?? '', channels: shown.channels, slides: shown.slides, per_channel: shown.perChannel },
      others, platformOf,
    )
  }, [context.allAccounts, context.clientId, accounts, shown.channels, shown.slides, shown.perChannel, clientPosts.rows, id])

  /* ── what is wrong with the draft on screen — the same rule the server runs ── */

  const composition = useMemo(
    () => (post && editable ? compositionProblems(post, accountRefs, nowMs) : []),
    [post, editable, accountRefs, nowMs])
  const igCounter = editable ? instagramCounter(working, accountRefs) : null
  const igChoices = editable ? instagramChoices(working, accountRefs) : null
  const draftTimeHint = editable ? timeHint(state.scheduledFor, nowMs, false) : null

  /* ── notes, per file ─────────────────────────────────────────────────── */

  const noteQuery = useMemo(() => ({ post_id: id ?? '' }), [id])
  const noteRows = useTable<PostComment>('post_comments', { by: noteQuery, enabled: !!id })
  const notes = useMemo(() => readPostNotes(noteRows.rows as unknown as Record<string, unknown>[]), [noteRows.rows])
  const addNote = useCallback((note: NoteInput) => (id ? addPostNote(id, note) : Promise.resolve({ ok: false as const, reason: 'Save the post first.' })), [id])

  /* ── pressing a button ───────────────────────────────────────────────── */

  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<{ q: Question; answers: Answers; problem: string | null } | null>(null)
  const [reply, setReply] = useState<Reply | null>(null)
  const [closing, setClosing] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reply || asking || closing) messagesRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [reply, asking, closing])

  const defaultsFor = (q: Question): Answers => ({
    note: '',
    agreed_via: null,
    assign_to: post?.created_by ?? null,
    scheduled_for: q.needs.includes('time')
      ? (post?.scheduled_for && new Date(post.scheduled_for).getTime() > nowMs ? post.scheduled_for : defaultPostTime(nowMs))
      : null,
    confirm: null,
    steps: post ? approvalStepsOf(post, context.client) : null,
    send_to: defaultRecipients(recipients),
    // a reminder is always an email (there is no link to copy for it)
    via: recipients.length > 0 || isReminderSend(q.action) ? 'email' : 'link',
    // decision 11: the client's answer-by, shown with its default so the person can move it. A resend
    // picks a new posting time, so its default comes from that time on the server; a reminder keeps
    // the answer-by the client already has, so it asks for none.
    approve_by: q.needs.includes('recipients') && q.action !== 'resend_new_time' && !isReminderSend(q.action) && post
      ? defaultApproveBy(post.scheduled_for, nowMs)
      : null,
  })

  const go = async (action: PostAction, answers: Answers): Promise<boolean> => {
    if (!post || busy) return false
    setBusy(true)
    setReply(null)
    savingRef.current = true
    const r = await pressAction(api, {
      post: saved, itemId, working, dirty: state.dirty || unsaved, timezone: tz, action, answers,
    }).finally(() => { savingRef.current = false })
    setBusy(false)
    if (r.postId && r.postId !== id) {
      setId(r.postId)
      onOpenPost?.(r.postId)
    }
    if (r.post) setAnswered(r.post)
    if (r.ok) {
      setAsking(null)
      if (r.post) {
        // a plain Save keeps what is on screen (someone may still be typing);
        // any move reloads the window from the post the server answered with
        loadedKey.current = action === 'save' && r.post.stage === 'draft' ? `${r.post.id}:${r.post.rev}` : null
        // the server took it against the rev we held, so nobody else moved it under us
        setMovedUnder(false)
        dispatch({ type: 'saved', postId: r.postId })
      }
      if (STAYS_OPEN.includes(action) && r.stage !== 'deleted') {
        setReply({ action, tone: 'ok', text: r.words, problems: [] })
        return true
      }
      const outcome: PostWindowOutcome = {
        postId: r.postId, itemId, words: r.words, stage: r.stage,
        at: r.post?.scheduled_for ?? state.scheduledFor, channels: [...(r.post?.channels ?? state.channels)],
        createdPostId: r.createdPostId ?? null, link: r.link ?? null,
      }
      if (onDone) onDone(outcome)
      else setReply({ action, tone: 'ok', text: r.link ? `${r.words}. The link: ${r.link}` : r.words, problems: [] })
      return true
    }
    if (asking && asking.q.action === action) setAsking({ ...asking, problem: r.reason })
    else setReply({ action, tone: 'error', text: r.reason, problems: r.problems.filter(p => p !== r.reason) })
    return false
  }

  const press = (offered: OfferedAction) => {
    setReply(null)
    setClosing(false)
    if (offered.blocked) { setReply({ action: offered.action, tone: 'error', text: offered.blocked, problems: [] }); return }
    const q = questionFor(offered)
    if (!q) { setAsking(null); void go(offered.action, {}); return }
    setAsking({ q, answers: defaultsFor(q), problem: null })
  }

  const answer = () => {
    if (!asking) return
    const problem = answerProblem(asking.q, asking.answers, nowMs, { postNowOffered: now.enabled })
    if (problem) { setAsking({ ...asking, problem }); return }
    void go(asking.q.action, asking.answers)
  }

  /** "Now" in a time question is Post now — its own button, with its own question */
  const pressNow = () => {
    const offered = [list.primary, ...list.secondary].find(a => a?.action === 'post_now')
    if (offered) press(offered)
  }

  /* ── Instagram's ten (decision 10) ───────────────────────────────────── */

  const chooseInstagram = async (key: InstagramChoiceKey) => {
    const res = applyInstagramChoice(working, key, accountRefs)
    if (key === 'split' && res.splitOff) {
      if (!itemId) { setReply({ action: 'instagram', tone: 'error', text: 'This post has no piece to split from.', problems: [] }); return }
      setBusy(true)
      const perChannel: Record<string, ChannelExtras> = {}
      for (const [k, v] of Object.entries(working.perChannel)) { const { slides: _own, ...rest } = v; void _own; perChannel[k] = rest }
      const made = await api.create({
        ...workingBody({ ...working, slides: res.splitOff, perChannel, scheduledFor: null }, tz), item_id: itemId,
      }).catch(() => ({ ok: false as const, reason: 'The second post was not made — nothing has changed. Try again.' }))
      setBusy(false)
      if (!made.ok) { setReply({ action: 'instagram', tone: 'error', text: made.reason, problems: [] }); return }
    }
    dispatch({ type: 'slides', slides: res.working.slides })
    for (const [channel, extras] of Object.entries(res.working.perChannel)) {
      if (extras !== working.perChannel[channel]) dispatch({ type: 'extra', channel, patch: { slides: extras.slides } })
    }
    setReply({ action: 'instagram', tone: 'ok', text: `${res.words} Save or send it when you are ready.`, problems: [] })
  }

  /* ── media ───────────────────────────────────────────────────────────── */

  const [mediaProblems, setMediaProblems] = useState<string[]>([])
  const openPicker = () => { setMediaProblems([]); setReply(null); setPicking(true) }
  const saveMedia = (next: Slide[]) => {
    // the files are this post's own: they go into the working copy, and a
    // Save or a send writes them. Nothing makes a version of the edit card,
    // and nothing goes to the client from here (audit V7, V13).
    dispatch({ type: 'slides', slides: next })
    setMediaProblems([])
    setPicking(false)
  }
  const editSlide = (index: number) => {
    if (!shown.slides[index] || !onEditMedia || !itemId) return
    onEditMedia({
      itemId, title, versionNumber: seed?.versionNumber ?? null, slides: shown.slides, index,
      postId: editable ? id : null, clientApproved: false,
    })
  }

  /* ── closing, and the keyboard ───────────────────────────────────────── */

  /* UNSAVED CHANGES ARE NEVER LOST SILENTLY (the owner's live test, 29 Sep 2026). "Unsaved" is the
   * one rule `hasUnsavedChanges`: touched AND different from what was last saved (a new post: what it
   * opened with). The X, Escape and a click outside ask "Save your changes?" beside the footer; a
   * reload or leaving the page gets the browser's own prompt. Nothing asks when nothing changed. */
  const openedWith = useRef<WorkingCopy>(working)
  const changed = editable && hasUnsavedChanges(saved ? workingCopyOf(saved) : openedWith.current, working, state.dirty)
  const changedRef = useRef(changed)
  changedRef.current = changed
  const requestClose = useCallback(() => {
    if (changedRef.current) { setClosing(true); setAsking(null); return }
    onClose()
  }, [onClose])
  useEffect(() => {
    if (!changed) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [changed])
  const closeWith = closeChoices(list)
  const saveAndClose = async () => {
    const ok = await go('save', {})
    if (ok) onClose()
    else setClosing(false)
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  const card = useRef<HTMLDivElement>(null)
  // Focus lands on the window ONCE, when it opens. It never moves after that:
  // the old window refocused itself when a first keystroke made it "unsaved",
  // and the caption lost the cursor after one letter (audit W1).
  useEffect(() => { card.current?.focus() }, [])
  // Escape closes, Tab stays inside. Depends on [picking] only — never on
  // `dirty`, never on the caption (audit W1, SPEC §8.3).
  useEffect(() => {
    const el = card.current
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (picking) return
        e.stopPropagation()
        requestCloseRef.current()
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
  }, [picking])

  const { open: tourOpen, close: closeTour } = useTourOnce('post-window', { userId: me?.id ?? null, role: me?.role ?? null, ready: !!me })

  /* ── drawing ─────────────────────────────────────────────────────────── */

  const gone = !!id && !rowLoading && !row && !answered
  const notMigrated = !!id && !!row && !live
  const whenWords = (iso: string | null) => (iso ? formatInZone(iso, tz, 'full') ?? clockPillLabel(iso, tz) : 'No time yet')
  const locked = !editable

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={header ? `Post — ${header.label}` : 'Post'}
      onMouseDown={e => { if (e.target === e.currentTarget) requestClose() }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
    >
      <div
        ref={card}
        tabIndex={-1}
        data-post-window
        data-window-scroll className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[760px] flex-col overflow-y-auto overscroll-contain rounded-card bg-popover text-popover-foreground shadow-xl outline-none sm:max-h-[calc(100dvh-3rem)]"
      >
        {/* ── TOP: the stage, and what happens next ── */}
        <div className="sticky top-0 z-20 flex flex-col gap-1.5 border-b border-border bg-popover p-3.5">
          <div className="flex items-center gap-2.5">
            {header && <Chip tone={header.tone} className="shrink-0 font-semibold" ><span data-stage-chip>{header.label}</span></Chip>}
            {header?.missed && <Chip tone="red" className="shrink-0 font-semibold">{header.missed}</Chip>}
            <span className="min-w-0 truncate text-[14px] font-semibold">{title}</span>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </button>
          </div>
          {header && (
            <div className="flex flex-col gap-0.5 text-[13px]">
              <p className="font-medium" data-waiting-line>{header.line}</p>
              {header.changeLine && (
                <p className="text-foreground"><span className="font-semibold">{header.changeLine}:</span> {header.changeNote ?? 'no note left'}</p>
              )}
              {header.problem && <p className="font-medium text-accent-red-deep">{header.problem}</p>}
              {header.approvalLine && <p className="text-muted-foreground">{header.approvalLine}</p>}
              {header.sendLine && <p className="text-muted-foreground">{header.sendLine}</p>}
              {header.answerByLine && <p className="font-medium" data-answer-by>{header.answerByLine}</p>}
              {header.versionLine && <p className="text-[12px] text-muted-foreground" data-version-line>{header.versionLine}{frozen?.fromMigration ? ' · frozen at migration, not at send' : ''}</p>}
            </div>
          )}
          {gone && <p role="alert" className="text-[13px] font-medium">This post no longer exists.</p>}
          {notMigrated && <p role="alert" className="text-[13px] font-medium">This post has not been moved onto the new stages yet. It opens here once that is done.</p>}
          {movedUnder && (
            <p role="alert" className="text-[12px] font-medium text-accent-red-deep">
              Someone else changed this post while you were editing. Your changes are still here, but saving them will be refused — close and open it again to see theirs.
            </p>
          )}
        </div>

        {/* ── MIDDLE: the post ── */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
          <div data-tour="post-channels">
            <Dropdown
              label={(
                <>
                  {chosen[0]
                    ? <PlatformIcon platform={String(chosen[0].platform)} size={26} className="rounded-full" />
                    : <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-foreground/10"><Plus className="h-3 w-3" aria-hidden /></span>}
                  <span className="flex flex-col items-start leading-[1.1]">
                    <span>{chosen[0] ? (chosen[0].username || chosen[0].name || 'Channel') : 'Choose a channel'}</span>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {chosen.length > 1 ? `and ${chosen.length - 1} more` : chosen[0]?.platform ?? 'none yet'}
                    </span>
                  </span>
                </>
              )}
              width={260}
              closeOnPick={false}
              disabled={locked}
            >
              {accounts.length === 0 && <p className="p-2 text-[13px] text-muted-foreground">This client has no channels connected yet.</p>}
              {accountSections(context.client?.name || 'The business', accounts, contacts).filter(s => s.accounts.length > 0).map(section => (
                <div key={section.key} className="flex flex-col" role="group" aria-label={section.title}>
                  <p className="px-2 pb-0.5 pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
                  {section.accounts.map(a => {
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
                        <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border text-[10px]', on ? 'border-foreground bg-foreground text-background' : 'border-border')}>
                          {on ? '✓' : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </Dropdown>
          </div>

          {kinds.length > 0 && (
            <div data-tour="post-kind">
              <Dropdown
                label={<><Zap className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />{trial ? 'Trial Reel' : pickedKind ? POST_KIND_WORD[pickedKind] : 'Auto publish'}</>}
                width={trialPossible ? 300 : 220}
                disabled={locked}
              >
                <MenuItem onClick={() => { for (const a of chosen) dispatch({ type: 'extra', channel: a.id, patch: { kind: undefined, trialGraduation: undefined } }) }}>
                  Auto publish{autoKind ? ` — ${POST_KIND_WORD[autoKind].toLowerCase()}` : ''}
                </MenuItem>
                {kinds.map(k => (
                  <MenuItem key={k} onClick={() => { for (const a of chosen) dispatch({ type: 'extra', channel: a.id, patch: { kind: k, trialGraduation: undefined } }) }}>
                    {POST_KIND_WORD[k]}
                  </MenuItem>
                ))}
                {trialPossible && trialBlocked && (
                  <p className="px-2 py-2 text-[12px] leading-snug text-muted-foreground"><span className="font-semibold text-foreground">Trial Reel</span> — {trialBlocked}</p>
                )}
                {trialPossible && !trialBlocked && TRIAL_CHOICES.filter(c => c.value !== '').map(c => (
                  <MenuItem key={c.value} onClick={() => setTrial(c.value)}>
                    <span className="flex flex-col items-start leading-tight">
                      <span>Trial Reel — {c.label.replace(/^Non-followers first — /, '')}</span>
                      <span className="text-[12px] font-normal text-muted-foreground">{c.help}</span>
                    </span>
                  </MenuItem>
                ))}
              </Dropdown>
            </div>
          )}

          <span data-tour="post-time" className="flex shrink-0 items-center gap-2">
            <span className="text-[13px] text-muted-foreground">on</span>
            {editable ? (
              <TimePicker
                value={state.scheduledFor}
                tz={tz}
                onChange={iso => { pickedTime.current = true; dispatch({ type: 'time', iso }) }}
                now={{ ...now, onNow: pressNow }}
              />
            ) : (
              <span className="flex min-h-11 items-center rounded-full border border-border bg-paper px-3 text-[13px] font-semibold">
                {whenWords(shown.scheduledFor)}
              </span>
            )}
          </span>
        </div>

        {editable && personHasNoAccounts && (
          <p role="alert" className="mx-3.5 mt-3 text-[12px] font-medium text-accent-red-deep">
            This post is for {postForPerson?.name ?? 'a person'}, who has no account connected yet — send them their connect link from Social channels. It will not go to the business’s accounts.
          </p>
        )}
        {lost.length > 0 && (
          <p role="alert" className="mx-3.5 mt-3 rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
            {lost.join(', ')} {lost.length === 1 ? 'is' : 'are'} not connected. Reconnect on Social channels before this can be booked.
          </p>
        )}
        {draftTimeHint && (
          <p className="mx-3.5 mt-3 text-[12px] font-medium text-muted-foreground" data-time-hint>{draftTimeHint}</p>
        )}

        {editable && suggested.length > 0 && (
          <div className="mx-3.5 mt-3 flex flex-wrap items-center gap-2.5 rounded-inner border border-border bg-paper px-3.5 py-2.5">
            <Clock className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            <span className="flex flex-col leading-[1.15]">
              <span className="text-[13px] font-semibold">Best times to post</span>
              <span className="text-[12px] text-muted-foreground">When more of this client&rsquo;s followers are online</span>
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              {suggested.slice(0, 3).map(s => (
                <button
                  key={s.iso}
                  type="button"
                  title={s.why}
                  onClick={() => { pickedTime.current = true; dispatch({ type: 'time', iso: s.iso }) }}
                  disabled={safeAt !== null && new Date(s.iso).getTime() < safeAt}
                  className={cn('min-h-11 rounded-full px-3 text-[12px] font-semibold',
                    state.scheduledFor === s.iso ? 'bg-foreground text-background' : 'border border-border bg-surface hover:bg-muted')}
                >
                  {whenWords(s.iso)}
                </button>
              ))}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-5 p-3.5 sm:flex-row">
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-[240px]">
            <div className="relative aspect-square w-full overflow-hidden rounded-inner border border-border bg-foreground/[0.06]">
              <Thumb slide={shownSlide} label={title} className="h-full w-full" />
              {shown.slides.length > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-ink/60 px-2 py-0.5 text-[11px] font-bold text-cream">{picked + 1}/{shown.slides.length}</span>
              )}
              {!editable && (
                <span className="absolute bottom-2 left-2 rounded-full bg-ink/60 px-2 py-0.5 text-[11px] font-bold text-cream">
                  {saved?.sent_version != null ? `Version ${saved.sent_version} · read only` : 'Read only'}
                </span>
              )}
            </div>

            {shown.slides.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {shown.slides.map((s, i) => (
                  <button
                    type="button"
                    key={`${s.url}-${i}`}
                    onClick={() => setChosenSlide(i)}
                    aria-label={`Show file ${i + 1}`}
                    aria-pressed={i === picked}
                    className={cn('h-[56px] w-[44px] shrink-0 overflow-hidden rounded-tile bg-foreground/[0.06]', i === picked && 'outline outline-2 outline-offset-2 outline-accent-blue')}
                  >
                    <Thumb slide={s} label={s.name} className="h-full w-full" />
                  </button>
                ))}
              </div>
            )}

            {igCounter && (
              <p data-instagram-counter className={cn('text-[12px] font-semibold', igCounter.over ? 'text-accent-red-deep' : 'text-muted-foreground')}>
                {igCounter.line}
              </p>
            )}
            {igChoices && (
              <div role="group" aria-label="Instagram takes ten" className="flex flex-col gap-1.5 rounded-inner border border-accent-amber/50 bg-tint-amber p-2.5">
                <p className="text-[12px] font-semibold">
                  Instagram takes {igChoices.max} files in one post. This one has {igChoices.count}. Choose one:
                </p>
                {igChoices.choices.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    disabled={busy}
                    onClick={() => void chooseInstagram(c.key)}
                    className="min-h-11 rounded-full border border-border bg-surface px-3 text-left text-[12px] font-semibold hover:bg-muted disabled:opacity-60"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {editable && (
              <button type="button" onClick={openPicker} className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border text-[13px] font-semibold hover:bg-muted">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                Change media
              </button>
            )}
            {editable && onEditMedia && (
              <button type="button" disabled={!shownSlide} onClick={() => editSlide(picked)} className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border text-[13px] font-semibold hover:bg-muted disabled:opacity-50">
                <Wand2 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                {shownSlide?.type === 'video' ? 'Edit video' : 'Edit image'}
              </button>
            )}

            {shown.slides.length === 1 && shown.slides[0].type === 'video' && chosen.length > 0 && (
              <div data-tour="post-cover">
                <CoverPicker
                  videoUrl={shown.slides[0].url}
                  playable={playable}
                  platforms={chosen.map(a => String(a.platform))}
                  current={currentCover(shown.perChannel, chosen.map(a => ({ id: a.id, platform: String(a.platform) })), seed?.coverUrl ?? null)}
                  locked={locked}
                  onPick={url => {
                    for (const a of chosen) {
                      const patch = coverPatchFor(String(a.platform), url)
                      if (Object.keys(patch).length) dispatch({ type: 'extra', channel: a.id, patch })
                    }
                  }}
                />
              </div>
            )}
            {editable && shown.slides.length > 1 && chosen.some(a => String(a.platform) === 'tiktok') && shownSlide && (
              <button
                type="button"
                onClick={() => { for (const a of chosen.filter(x => String(x.platform) === 'tiktok')) dispatch({ type: 'extra', channel: a.id, patch: { photoCoverIndex: picked } }) }}
                className="flex min-h-9 items-center justify-center rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted"
              >
                {(shown.perChannel[chosen.find(x => String(x.platform) === 'tiktok')?.id ?? '']?.photoCoverIndex ?? 0) === picked
                  ? `Picture ${picked + 1} is the TikTok cover`
                  : `Use picture ${picked + 1} as the TikTok cover`}
              </button>
            )}

            {trial && (
              <p className={cn('rounded-inner border px-3 py-2 text-[12px] leading-snug', trialBlocked ? 'border-accent-red/40 bg-accent-red/10' : 'border-accent-blue/40 bg-accent-blue/10')}>
                <strong>Trial Reel.</strong>{' '}
                {trialBlocked
                  ? `${trialBlocked} Pick Reel in the type menu.`
                  : `${TRIAL_SENTENCE} ${trial === 'MANUAL' ? 'Somebody graduates it by hand in the Instagram app.' : 'Instagram graduates it on its own if it performs well.'}`}
              </p>
            )}
            {editable && (copiesLine
              ? <p className={cn('text-[12px]', beforeCopies ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{copiesLine}</p>
              : preparingCopy && <p className="text-[12px] text-muted-foreground">{preparingCopy}</p>)}
            {caps.lines.length > 0 && (
              <div className="flex flex-col gap-0.5">{caps.lines.map(l => <p key={l.id} className="text-[12px] text-muted-foreground">{l.line}</p>)}</div>
            )}
            {shown.slides.length > 0 && checkPlatforms.length > 0 && (
              <div data-tour="post-check">
                <AssetCheck
                  probes={probes} platforms={checkPlatforms} kinds={checkKinds} copies={copyPlatforms} playable={playable} compact
                  linkedinPersonal={chosen.some(a => String(a.platform) === 'linkedin' && !shown.perChannel[a.id]?.organizationUrn)}
                />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <div className="flex gap-1.5 rounded-full border border-border p-1" role="tablist" aria-label="Write or preview">
              {([['write', editable ? 'Write it' : 'The post', Pencil], ['preview', 'Preview', Eye]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={pane === key}
                  onClick={() => setPane(key)}
                  className={cn('flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full text-[13px] font-semibold', pane === key ? 'bg-foreground text-background' : 'hover:bg-muted')}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            {pane === 'preview' && (
              <PostPreviewPane playable={playable} previews={preview.networks} intro={PREVIEW_INTRO}
                empty="Pick a channel and the post appears here as that network will show it." />
            )}
            {pane === 'preview' && grid && grid.length > 0 && (
              <div className="mt-3 flex flex-col gap-2" data-instagram-grid>
                <p className="text-[13px] font-semibold">How it sits on the client&rsquo;s Instagram</p>
                <ul className="grid max-w-[300px] grid-cols-3 gap-0.5">
                  {grid.slice(0, 9).map((g, i) => (
                    <li key={`${g.url}-${i}`} className={cn('relative aspect-[4/5] overflow-hidden bg-foreground/[0.06]', i === 0 && 'ring-2 ring-foreground ring-offset-1 ring-offset-background')}>
                      {g.type === 'video'
                        ? <video src={g.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={g.url} alt={i === 0 ? 'This post' : ''} loading="lazy" className="h-full w-full object-cover" />}
                    </li>
                  ))}
                </ul>
                <p className="text-[12px] text-muted-foreground">This post is outlined, before the newest posts already live.</p>
              </div>
            )}

            {pane === 'write' && (
              <>
                {allStory ? (
                  <p className="rounded-inner border border-border p-3 text-[13px] text-muted-foreground" data-story-no-caption>
                    A Story has no caption — put any words into the picture or video itself.
                  </p>
                ) : (
                  <label className="flex flex-col gap-1.5 rounded-inner border border-border p-3">
                    <span className="text-[12px] font-semibold text-muted-foreground">Caption</span>
                    <textarea
                      value={editable ? state.caption : shown.caption}
                      onChange={e => dispatch({ type: 'caption', caption: e.target.value })}
                      readOnly={!editable}
                      rows={5}
                      placeholder={editable ? 'What goes with the picture?' : ''}
                      data-caption
                      className="w-full resize-y bg-transparent text-[14px] leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  </label>
                )}

                {chosen.some(a => ['instagram', 'facebook'].includes(String(a.platform))) && (
                  <AutomationSection
                    automation={editable ? state.automation : shown.automation}
                    editable={editable}
                    onChange={next => dispatch({ type: 'automation', automation: next })}
                    clientSlug={context.client?.slug ?? null}
                    postId={saved?.id ?? null}
                    stage={saved?.stage ?? null}
                  />
                )}

                {editable && groups.length > 0 && (
                  <div data-tour="post-options" className="flex flex-col gap-2.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">More options</span>
                    {groups.map(group => (
                      <div key={group.platform ?? 'shared'} className="flex flex-col gap-2.5">
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                          {group.platform && <PlatformIcon platform={group.platform} size={14} className="rounded-full" />}
                          {group.label}
                        </span>
                        {group.platform === 'tiktok' && tiktokLimit && <p className="text-[12px] text-muted-foreground">{tiktokLimit}</p>}
                        {group.options.filter(o => o.key !== 'trialReel').map(o => (
                          <ExtraRow key={o.key} option={o} channels={chosen.filter(a => o.platforms.includes(String(a.platform)))}
                            state={state} dispatch={dispatch} locations={locations} lists={lists} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {editable && accounts.some(a => !state.channels.includes(a.id)) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-muted-foreground">Also post to</span>
                    {accounts.filter(a => !state.channels.includes(a.id)).map(a => (
                      <button key={a.id} type="button" onClick={() => dispatch({ type: 'channel', id: a.id, on: true })}
                        title={ownerLabel(a, context.client?.name || 'The business', contacts)}
                        className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted">
                        <PlatformIcon platform={String(a.platform)} size={16} className="rounded-full" />
                        {a.username || a.name}
                      </button>
                    ))}
                  </div>
                )}

                {saved && saved.stage === 'posted' && Object.keys(saved.outcomes).length > 0 && (
                  <ul className="flex flex-col gap-1 rounded-inner border border-border p-3 text-[13px]" aria-label="Where it went out">
                    {Object.entries(saved.outcomes).map(([platform, o]) => (
                      <li key={platform} className="flex items-center gap-2">
                        <PlatformIcon platform={platform} size={16} className="rounded-full" />
                        <span className="font-semibold">{networkName(platform)}</span>
                        <span className="text-muted-foreground">
                          {o.status === 'published' || o.status === 'duplicate' ? 'live' : o.status === 'failed' ? `did not go out${o.error ? ` — ${o.error}` : ''}` : 'waiting for the network'}
                        </span>
                        {o.url && <a href={o.url} target="_blank" rel="noreferrer" className="ml-auto underline">Open ↗</a>}
                      </li>
                    ))}
                  </ul>
                )}

                {id && post && (
                  <PostNotes slides={shown.slides} notes={notes} version={noteVersionOf(post)} onAdd={addNote} />
                )}
              </>
            )}
          </div>
        </div>

        {tourOpen && <Tour tour={POST_WINDOW_TOUR} onClose={closeTour} />}

        {/* ── BOTTOM: only the buttons this stage allows. The question a button
             asks and any refusal sit right here, above the buttons, in the
             sticky footer — never below the fold, never hidden by a question
             (decision 2; audit W8). ── */}
        <div className="sticky bottom-0 z-20 mt-auto flex flex-col gap-2 border-t border-border bg-popover p-3.5">
          <div ref={messagesRef} className="flex flex-col gap-2 scroll-mt-4">
            {editable && composition.length > 0 && (
              <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto" aria-label="What to fix before it can be sent" data-composition-problems>
                {composition.map(p => (
                  <li key={p} className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-1.5 text-[12px] font-medium">{p}</li>
                ))}
              </ul>
            )}
            {caps.stops.map(p => (
              <p key={p} className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-1.5 text-[12px] font-medium">{p}</p>
            ))}
            {reply && (
              <div role={reply.tone === 'error' ? 'alert' : 'status'} data-reply={reply.action}
                className={cn('rounded-inner border px-3 py-2 text-[13px] font-medium',
                  reply.tone === 'error' ? 'border-accent-red/40 bg-tint-red' : 'border-accent-green/40 bg-tint-green')}>
                {reply.text}
                {reply.problems.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-[12px]">{reply.problems.map(p => <li key={p}>{p}</li>)}</ul>
                )}
              </div>
            )}
            {closing && changed && (
              <div role="alertdialog" aria-label={CLOSE_QUESTION} data-close-question className="flex flex-wrap items-center gap-3 rounded-inner border border-accent-amber/50 bg-tint-amber px-3 py-2.5">
                <span className="text-[13px] font-semibold">{CLOSE_QUESTION}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {closeWith.map(c => (
                    <button key={c.key} type="button" data-close-choice={c.key} disabled={busy && c.key !== 'keep'}
                      onClick={() => (c.key === 'save' ? void saveAndClose() : c.key === 'discard' ? onClose() : setClosing(false))}
                      className={cn('min-h-11 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60',
                        c.key === 'save' ? 'bg-foreground text-background' : 'border border-border bg-surface')}>
                      {c.key === 'save' && busy ? 'Saving…' : c.label}
                    </button>
                  ))}
                </span>
              </div>
            )}
            {asking && (
              <QuestionPanel
                asking={asking}
                busy={busy}
                tz={tz}
                recipients={recipients}
                team={team}
                makerId={post?.created_by ?? null}
                now={now}
                onNow={pressNow}
                onChange={answers => setAsking({ ...asking, answers, problem: null })}
                onGo={answer}
                onStay={() => setAsking(null)}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2" data-footer-buttons>
            {changed && <span className="text-[12px] font-medium text-muted-foreground">Not saved yet</span>}
            {!me && <span className="text-[12px] text-muted-foreground">Checking who you are…</span>}
            {me && post && buttons.length === 0 && (
              <span className="text-[13px] text-muted-foreground">Nothing for you to do on this post right now.</span>
            )}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2" data-tour="post-submit">
              {buttons.map(({ offered, kind }) => (
                <span key={offered.action} className="flex flex-col items-end gap-0.5">
                  <button
                    type="button"
                    data-action={offered.action}
                    data-kind={kind}
                    disabled={busy || !!offered.blocked}
                    aria-describedby={offered.blocked ? `why-${offered.action}` : undefined}
                    onClick={() => press(offered)}
                    className={cn(
                      'flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50',
                      kind === 'primary' && 'bg-foreground text-background hover:bg-foreground/90',
                      kind === 'secondary' && 'border border-border bg-surface hover:bg-muted',
                      kind === 'danger' && 'border border-accent-red/50 bg-surface text-accent-red-deep hover:bg-tint-red',
                      asking?.q.action === offered.action && 'ring-2 ring-accent-blue ring-offset-2',
                    )}
                  >
                    {kind === 'danger' && <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
                    {busy && asking?.q.action === offered.action ? 'Working…' : offered.label}
                  </button>
                  {offered.blocked && (
                    <span id={`why-${offered.action}`} className="max-w-[260px] text-right text-[11px] leading-snug text-muted-foreground">{offered.blocked}</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {editable && (
        <MediaPicker
          open={picking}
          onClose={() => setPicking(false)}
          itemId={itemId ?? ''}
          approved={seed?.pieceFiles ?? []}
          versionLabel={title}
          slides={state.slides}
          platforms={platforms}
          onSave={saveMedia}
          onEditSlide={index => { setPicking(false); editSlide(index) }}
          saving={busy}
          saveProblems={mediaProblems}
          allowUploads
        />
      )}
    </div>
  )
}

/* ── the question a button asks, drawn right above the buttons ────────── */

function QuestionPanel({ asking, busy, tz, recipients, team, makerId, now, onNow, onChange, onGo, onStay }: {
  asking: { q: Question; answers: Answers; problem: string | null }
  busy: boolean
  tz: string
  recipients: { email: string; name: string }[]
  team: { id: string; name: string }[]
  makerId: string | null
  now: { enabled: boolean; reason: string | null }
  onNow: () => void
  onChange: (a: Answers) => void
  onGo: () => void
  onStay: () => void
}) {
  const { q, answers: a, problem } = asking
  const set = (patch: Partial<Answers>) => onChange({ ...a, ...patch })
  const field = 'min-h-11 rounded-full border border-border bg-surface px-3 text-[13px]'
  const people = [
    ...(makerId ? [{ id: makerId, name: team.find(t => t.id === makerId)?.name ?? 'The person who made it' }] : []),
    ...team.filter(t => t.id !== makerId),
  ]
  return (
    <div role="group" aria-label={q.label} data-question={q.action} className="flex flex-col gap-2 rounded-inner border border-accent-blue/50 bg-tint-blue/40 p-3">
      <p className="text-[13px] font-semibold">{q.prompt}</p>

      {q.needs.includes('time') && (
        <div className="flex flex-wrap items-center gap-2">
          <TimePicker value={a.scheduled_for ?? null} tz={tz} onChange={iso => set({ scheduled_for: iso })}
            now={q.action === 'change_time' ? { ...now, onNow } : null} />
          <span className="text-[12px] text-muted-foreground">{a.scheduled_for ? formatInZone(a.scheduled_for, tz, 'full') : ''}</span>
        </div>
      )}

      {q.needs.includes('agreed_via') && (
        <label className="flex flex-col gap-1 text-[12px] font-semibold">
          How the client agreed
          <select value={a.agreed_via ?? ''} onChange={e => set({ agreed_via: (e.target.value || null) as Answers['agreed_via'] })} className={field}>
            <option value="">Choose…</option>
            {AGREED_VIA_CHOICES.filter(c => (AGREED_VIA as readonly string[]).includes(c.value)).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      )}

      {q.needs.includes('assign_to') && (
        <label className="flex flex-col gap-1 text-[12px] font-semibold">
          Who makes the change
          <select value={a.assign_to ?? makerId ?? ''} onChange={e => set({ assign_to: e.target.value || null })} className={field}>
            {people.length === 0 && <option value="">The person who made it</option>}
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

      {q.needs.includes('note') && (
        <label className="flex flex-col gap-1 text-[12px] font-semibold">
          {q.action === 'approve_for_client' ? 'Anything to add (needed for "another way")'
            : q.action === 'team_decides' ? 'Why the team is deciding' : 'What needs changing'}
          <textarea value={a.note ?? ''} onChange={e => set({ note: e.target.value })} rows={2}
            className="w-full resize-y rounded-inner border border-border bg-surface p-2 text-[13px] font-normal outline-none" />
        </label>
      )}

      {q.needs.includes('recipients') && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[12px] font-semibold">Who gets it</legend>
          {recipients.length === 0 && <p className="text-[12px] text-muted-foreground">This client has no email address on file. Copy the link instead, or add a contact on the client&rsquo;s page.</p>}
          {recipients.map(r => (
            <label key={r.email} className="flex min-h-9 items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4" disabled={a.via === 'link'}
                checked={(a.send_to ?? []).includes(r.email)}
                onChange={e => set({ send_to: e.target.checked ? [...(a.send_to ?? []), r.email] : (a.send_to ?? []).filter(x => x !== r.email) })} />
              {r.name}{r.name !== r.email && <span className="text-muted-foreground"> · {r.email}</span>}
            </label>
          ))}
          {!isReminderSend(q.action) && (
            <label className="flex min-h-9 items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4" checked={a.via === 'link'} onChange={e => set({ via: e.target.checked ? 'link' : 'email' })} />
              Copy the link instead — I will send it myself
            </label>
          )}
        </fieldset>
      )}

      {q.needs.includes('recipients') && !isReminderSend(q.action) && (
        <div className="flex flex-col gap-1" data-answer-by-question>
          <p className="text-[12px] font-semibold">The client answers by</p>
          <div className="flex flex-wrap items-center gap-2">
            <TimePicker value={a.approve_by ?? null} tz={tz} onChange={iso => set({ approve_by: iso })} now={null} />
            <span className="text-[12px] text-muted-foreground">{a.approve_by ? formatInZone(a.approve_by, tz, 'full') : 'Two hours before the posting time'}</span>
          </div>
          <p className="text-[12px] text-muted-foreground">After this the client can no longer approve it, and the post shows it needs a new time. The account manager is reminded 24 hours and 1 hour before.</p>
        </div>
      )}

      {q.needs.includes('steps') && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[12px] font-semibold">Approval steps</legend>
          {APPROVAL_STEPS.map(s => (
            <label key={s} className="flex min-h-9 items-center gap-2 text-[13px]">
              <input type="radio" name="steps" className="h-4 w-4" checked={a.steps === s} onChange={() => set({ steps: s })} />
              {APPROVAL_STEPS_LABEL[s]}
            </label>
          ))}
        </fieldset>
      )}

      {problem && <p role="alert" className="text-[12px] font-semibold text-accent-red-deep">{problem}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onStay} className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold">{q.stay}</button>
        <button type="button" disabled={busy} onClick={onGo} data-go={q.action}
          className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60">
          {busy ? 'Working…' : q.go}
        </button>
      </div>
    </div>
  )
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function composerFieldsOf(w: WorkingCopy) {
  return {
    slides: w.slides, caption: w.caption, channels: w.channels, scheduledFor: w.scheduledFor, perChannel: w.perChannel,
    automation: w.automation ?? null,
  }
}

/** The accounts a post goes to, in the post's own order. */
function accountsFor(ids: readonly string[], accounts: readonly SocialAccount[]): SocialAccount[] {
  const byId = new Map(accounts.map(a => [a.id, a]))
  return ids.map(i => byId.get(i)).filter((a): a is SocialAccount => !!a)
}

/**
 * THE SAME WINDOW FROM ANYWHERE — given only a post's id. For the Post
 * approval board, a Waiting row, or any page that has not loaded the client:
 * it reads the post, its client, the client's channels and people itself, and
 * opens the one PostWindow on them (decision 2).
 */
export function OpenPostWindow({ postId, onClose, onDone, onEditMedia }: {
  postId: string
  onClose: () => void
  onDone?: (outcome: PostWindowOutcome) => void
  onEditMedia?: (target: ImageEditorTarget) => void
}) {
  const { row } = useRow<SocialPost>('social_posts', postId)
  const clientId = row?.client_id ?? null
  const { row: client } = useRow<Record<string, unknown> & { id: string }>('clients', clientId)
  const byClient = useMemo(() => ({ client_id: clientId ?? '' }), [clientId])
  const accounts = useTable<SocialAccount>('social_accounts', { by: byClient, enabled: !!clientId })
  const contacts = useTable<ClientContact>('client_contacts', { by: byClient, enabled: !!clientId })
  const all = useMemo(() => accounts.rows.filter(a => a.client_id === clientId), [accounts.rows, clientId])
  const context: PostWindowContext | null = useMemo(() => (clientId ? {
    clientId,
    tz: safeZone((client as { timezone?: string | null } | null)?.timezone ?? null),
    client: client as PostWindowContext['client'],
    accounts: all.filter(a => a.active),
    allAccounts: all,
    contacts: contacts.rows.filter(c => c.client_id === clientId),
    locations: readLocations((client as { instagram_locations?: unknown } | null)?.instagram_locations),
  } : null), [clientId, client, all, contacts.rows])
  if (!context) return null
  return <PostWindow postId={postId} context={context} onClose={onClose} onDone={onDone} onEditMedia={onEditMedia} />
}
