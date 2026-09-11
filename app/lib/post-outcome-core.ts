/**
 * WHAT WENT OUT, PER CHANNEL — the pure half.
 *
 * A job goes to several channels at once, and they do not all agree: the
 * 15:45 post on 8 Sep 2026 went out on Instagram and was refused by TikTok
 * (the master was 1.48 GB, the relay ceiling 350 MB). The job row said
 * `failed` with the reasons run together in one `error` sentence, and every
 * screen — the Posts page, the Schedule list, the card — read the one word.
 * The owner: "if one platform deployed and tiktok didn't make sure it's
 * properly logged".
 *
 * So each channel gets its own record on the job (`publish_jobs.
 * platform_results`, written by `publish.ts` at every settle) — the network,
 * what KIND of post it was (feed post, reel, story, carousel, video), what
 * happened, when, why not, and the live link. This file is the reading and
 * writing of that record, the tabs the Posts page sorts jobs into, the
 * by-hand rows from the cards, and the per-client numbers. No I/O.
 */

import { networkName, platformErrorWords, type MediaItem } from './publish-core'
import { isTrialTarget } from './trial-reel-core'
import { readPostedSlides } from './posted-slides-core'

export type OutcomeStatus = 'queued' | 'scheduled' | 'published' | 'failed' | 'pending' | 'cancelled'

export type PlatformOutcome = {
  platform: string
  /** what happened on THIS channel */
  status: OutcomeStatus
  /** "Reel", "Feed post", "Video"… — what kind of post it was */
  kind: string
  /** why it did not go out, in the provider's words; null otherwise */
  reason: string | null
  /** the live link on this channel, once the platform gives one */
  url: string | null
  /** when: the publish time, the booked time, or the moment of the failure */
  at: string | null
}

/** the slice of a `publish_jobs` row this file reads */
export type OutcomeJob = {
  id?: string
  status?: string | null
  targets?: { platform: string; options?: { kind?: string; media?: MediaItem[] | null; trialGraduation?: string | null; tiktokDraft?: boolean | null; facebookDraft?: boolean | null } | null }[] | null
  media?: MediaItem[] | null
  scheduled_for?: string | null
  published_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  error?: string | null
  permalink?: string | null
  platform_results?: unknown
}

/* ── what kind of post ──────────────────────────────────────────────────── */

const KIND_WORDS: Record<string, string> = {
  feed: 'Feed post', reel: 'Reel', story: 'Story', carousel: 'Carousel', video: 'Video',
}

/**
 * The words for what was posted on a channel: the chosen kind when the
 * composer set one, otherwise read off the media — one video is a Reel on
 * Instagram and Facebook (the only way a single video publishes there) and a
 * Video everywhere else, several files are a Carousel, one image is a Feed
 * post, no media is a Text post.
 */
export function kindWords(
  platform: string,
  kind: string | null | undefined,
  media: readonly Pick<MediaItem, 'type'>[] | null | undefined,
): string {
  const chosen = String(kind ?? '').toLowerCase()
  if (chosen && KIND_WORDS[chosen]) return KIND_WORDS[chosen]
  const list = Array.isArray(media) ? media : []
  if (list.length === 0) return 'Text post'
  if (list.length > 1) return 'Carousel'
  if (list[0]?.type === 'video') {
    return ['instagram', 'facebook'].includes(String(platform).toLowerCase()) ? 'Reel' : 'Video'
  }
  return 'Feed post'
}

/* ── writing the record ─────────────────────────────────────────────────── */

const STATUSES: OutcomeStatus[] = ['queued', 'scheduled', 'published', 'failed', 'pending', 'cancelled']

function targetsOf(job: OutcomeJob): { platform: string; kind: string }[] {
  return (Array.isArray(job.targets) ? job.targets : [])
    .filter(t => t && typeof t.platform === 'string')
    .map(t => {
      const kind = kindWords(t.platform, t.options?.kind, t.options?.media?.length ? t.options.media : job.media)
      // a Reel going to non-followers first is a Trial Reel everywhere it is
      // named — the Posts page, the calendar's list, the card (10 Sep 2026)
      const trial = kind === 'Reel' && isTrialTarget(t.platform, { kind: 'reel', trialGraduation: t.options?.trialGraduation })
      // a draft handed to the creator is not a post that went out: TikTok's
      // inbox and Facebook's Publishing Tools both come back "published"
      // with isDraft (the docs audit of 10 Sep 2026)
      const p = t.platform.toLowerCase()
      const draft = (p === 'tiktok' && t.options?.tiktokDraft === true) || (p === 'facebook' && t.options?.facebookDraft === true)
      return { platform: p, kind: draft ? DRAFT_KIND : trial ? 'Trial Reel' : kind }
    })
}

/** The kind word for a post handed over as a draft, not published. */
export const DRAFT_KIND = 'Draft, handed to the creator'

/** Is any channel of this job a Trial Reel? */
export function jobIsTrial(job: OutcomeJob): boolean {
  return targetsOf(job).some(t => t.kind === 'Trial Reel')
}

/** Every channel of the job given ONE outcome — the settle that had no
 *  per-channel word from the provider (queued, booked, failed before sending). */
export function resultsForAll(
  job: OutcomeJob,
  status: OutcomeStatus,
  detail: { reason?: string | null; at?: string | null; url?: string | null } = {},
): PlatformOutcome[] {
  return targetsOf(job).map(t => ({
    platform: t.platform, status, kind: t.kind,
    reason: detail.reason ?? null, url: detail.url ?? null, at: detail.at ?? null,
  }))
}

/** what the provider says about one channel — its `platforms[]` row */
export type RemoteRow = {
  platform?: string; name?: string; status?: string
  errorMessage?: string | null; error?: string | null
  platformPostUrl?: string | null
  publishedAt?: string | null
  platformSpecificData?: { isDraft?: boolean } | null
}

const LIVE = ['published', 'posted', 'success']
const WAITING = ['pending', 'processing', 'publishing', 'scheduled']

/**
 * The record from the provider's per-channel rows, joined onto the job's
 * targets so a channel the provider did not mention keeps the job's own word
 * (`fallback`). A TikTok "failed — still processing" is a wait, not a
 * failure — the 3:26 pm master went live 63 minutes later.
 */
export function resultsFromRemote(
  job: OutcomeJob,
  rows: readonly RemoteRow[] | null | undefined,
  fallback: OutcomeStatus,
  at: string,
): PlatformOutcome[] {
  const byPlatform = new Map<string, RemoteRow>()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = String(r.platform ?? r.name ?? '').toLowerCase()
    if (key) byPlatform.set(key, r)
  }
  const out: PlatformOutcome[] = []
  const seen = new Set<string>()
  for (const t of targetsOf(job)) {
    seen.add(t.platform)
    const r = byPlatform.get(t.platform)
    // a channel the provider has not reported on is NOT published: Zernio's
    // analytics endpoint lists only the channels that are live, so the 1:15
    // am post of 10 Sep 2026 read "published" on TikTok while TikTok was
    // still processing the video — and the team was emailed "now Posted"
    const missing: OutcomeStatus = fallback === 'published' ? 'pending' : fallback
    out.push(r ? fromRow(t.platform, t.kind, r, at, fallback) : {
      platform: t.platform, status: missing, kind: t.kind, reason: null, url: null,
      at: missing === 'scheduled' ? job.scheduled_for ?? at : at,
    })
  }
  // a channel the provider names that the job did not — kept, so nothing the
  // provider says is lost
  for (const [key, r] of byPlatform) {
    if (!seen.has(key)) out.push(fromRow(key, kindWords(key, null, job.media), r, at, fallback))
  }
  return out
}

function fromRow(platform: string, kindIn: string, r: RemoteRow, at: string, fallback: OutcomeStatus): PlatformOutcome {
  let kind = kindIn
  const status = String(r.status ?? '').toLowerCase()
  const why = String(r.errorMessage ?? r.error ?? '').trim()
  const stillProcessing = /still processing/i.test(why)
  if (r.platformSpecificData?.isDraft === true) kind = DRAFT_KIND
  let verdict: OutcomeStatus
  if (LIVE.includes(status)) verdict = 'published'
  else if (status === 'failed' && !stillProcessing) verdict = 'failed'
  else if (status === 'failed' || WAITING.includes(status)) verdict = 'pending'
  else verdict = fallback
  return {
    platform, kind, status: verdict,
    reason: verdict === 'failed' ? (platformErrorWords(why) || 'no reason given') : null,
    url: r.platformPostUrl ?? null,
    at: verdict === 'published' ? (r.publishedAt ?? at) : at,
  }
}

/* ── reading it back ────────────────────────────────────────────────────── */

export function readPlatformResults(raw: unknown): PlatformOutcome[] | null {
  if (!Array.isArray(raw)) return null
  const out: PlatformOutcome[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    if (typeof o.platform !== 'string' || !STATUSES.includes(o.status as OutcomeStatus)) continue
    out.push({
      platform: o.platform.toLowerCase(),
      status: o.status as OutcomeStatus,
      kind: typeof o.kind === 'string' && o.kind ? o.kind : 'Post',
      reason: typeof o.reason === 'string' ? o.reason : null,
      url: typeof o.url === 'string' ? o.url : null,
      at: typeof o.at === 'string' ? o.at : null,
    })
  }
  return out.length > 0 ? out : null
}

function statusOfJob(status: string | null | undefined): OutcomeStatus {
  switch (String(status ?? '')) {
    case 'published': case 'duplicate': return 'published'
    case 'scheduled': return 'scheduled'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'publishing': return 'pending'
    default: return 'queued'
  }
}

/**
 * The per-channel outcomes of a job: the stored record when there is one,
 * otherwise every channel wearing the job's own status — a job written
 * before this record existed still reads properly.
 */
export function outcomesForJob(job: OutcomeJob): PlatformOutcome[] {
  const stored = readPlatformResults(job.platform_results)
  const status = statusOfJob(job.status)
  if (stored) {
    // a job cancelled after its record was written: the record says booked,
    // the job says gone
    return status === 'cancelled' ? stored.map(o => ({ ...o, status: 'cancelled', at: job.updated_at ?? o.at })) : stored
  }
  // a job still in OUR queue is booked for its time too: the client's line
  // read "going out Fri 11 Sept, 5:00 pm" — the minute it was queued — for
  // a post booked for the Sunday (the live role-play of 11 Sep 2026)
  const at = status === 'published' ? job.published_at ?? job.updated_at ?? null
    : status === 'scheduled' || status === 'queued' ? job.scheduled_for ?? job.updated_at ?? null
    : job.updated_at ?? job.created_at ?? null
  const all = resultsForAll(job, status, {
    at,
    reason: status === 'failed' ? job.error ?? null : null,
    url: status === 'published' ? job.permalink ?? null : null,
  })
  // a job failed BEFORE the record existed still carries the reconcile's
  // sentence — "Went out on instagram. Did not go out on tiktok: too big."
  // (publish-core.describeRemoteOutcome) — and that sentence is read back
  // so the 8 Sep post shows Instagram out and TikTok refused, not two crosses
  const parsed = status === 'failed' ? parseOutcomeSentence(job.error) : null
  if (!parsed) return all
  return all.map(o => {
    if (parsed.live.includes(o.platform)) return { ...o, status: 'published', reason: null, url: job.permalink ?? null }
    const why = parsed.failed.get(o.platform)
    return why !== undefined ? { ...o, reason: why } : o
  })
}

/** the reconcile's own sentence, read back per channel; null if it is not one */
export function parseOutcomeSentence(error: string | null | undefined): { live: string[]; failed: Map<string, string> } | null {
  const text = String(error ?? '')
  const live = /Went out on ([^.]+)\./.exec(text)
  // the reasons run to the end of the sentence (or to the "Still going out"
  // tail) — a reason can hold full stops of its own, so the first one is
  // not the end: "Make sure it's publicly accessible (…) and try again.;
  // linkedin: …" is two channels, not one and a half
  const notOut = /Did not go out (?:on |— )([^]*?)(?:\s+Still going out[^]*)?$/.exec(text)
  if (!live && !notOut) return null
  const failed = new Map<string, string>()
  for (const part of (notOut?.[1] ?? '').split(/;\s*(?=[a-z]+:\s)/i)) {
    const m = /^\s*([a-z]+):\s*([^]*?)\.?\s*$/i.exec(part)
    if (m) failed.set(m[1].toLowerCase(), m[2].trim())
  }
  return {
    live: (live?.[1] ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
    failed,
  }
}

/** the one word a mark on screen needs */
export function outcomeWords(o: PlatformOutcome): { label: string; tone: 'done' | 'waiting' | 'trouble' | 'moving' | 'quiet' } {
  switch (o.status) {
    case 'published': return o.kind === DRAFT_KIND
      ? { label: 'Handed over as a draft — not live until they post it', tone: 'waiting' }
      : { label: 'Went out', tone: 'done' }
    case 'scheduled': return { label: 'Scheduled', tone: 'waiting' }
    case 'failed': return { label: 'Did not go out', tone: 'trouble' }
    case 'pending': return { label: 'Still going out', tone: 'moving' }
    case 'cancelled': return { label: 'Cancelled', tone: 'quiet' }
    default: return { label: 'Waiting to send', tone: 'waiting' }
  }
}

/** "Instagram · Reel" */
export function outcomeTitle(o: PlatformOutcome): string {
  return `${networkName(o.platform)} · ${o.kind}`
}

/* ── the Posts page's tabs ──────────────────────────────────────────────── */

export type PostsTab = 'scheduled' | 'did_not_post' | 'posted'

/**
 * Which tabs a job belongs on. A partial — live on Instagram, refused by
 * TikTok — is on BOTH Posted and Did not post, because it is both, and a
 * person looking for either must find it.
 */
export function postsTabs(job: OutcomeJob): Set<PostsTab> {
  const out = new Set<PostsTab>()
  const outcomes = outcomesForJob(job)
  const status = statusOfJob(job.status)
  if (['queued', 'scheduled', 'pending'].includes(status)) out.add('scheduled')
  if (outcomes.some(o => o.status === 'published') || status === 'published') out.add('posted')
  if (outcomes.some(o => o.status === 'failed') || status === 'failed' || status === 'cancelled') out.add('did_not_post')
  if (outcomes.some(o => o.status === 'pending') && status !== 'scheduled') out.add('scheduled')
  return out
}

/** when to sort a job by, on each tab */
export function tabTime(job: OutcomeJob, tab: PostsTab): number {
  const t = (s: string | null | undefined) => (s ? Date.parse(s) : NaN)
  if (tab === 'scheduled') return t(job.scheduled_for) || t(job.created_at) || 0
  if (tab === 'posted') return t(job.published_at) || t(job.updated_at) || t(job.created_at) || 0
  return t(job.updated_at) || t(job.created_at) || 0
}

/** Scheduled soonest first; the other two newest first. */
export function sortForTab<T extends OutcomeJob>(jobs: readonly T[], tab: PostsTab): T[] {
  const list = jobs.filter(j => postsTabs(j).has(tab))
  return list.sort((a, b) => tab === 'scheduled'
    ? tabTime(a, tab) - tabTime(b, tab)
    : tabTime(b, tab) - tabTime(a, tab))
}

/* ── posted by hand, from the cards ─────────────────────────────────────── */

export type ByHandRow = {
  item_id: string
  title: string
  client_id: string | null
  url: string
  at: string
  link: string | null
  /** "photo 2 of 5" — which file of the card */
  index: number
  total: number
}

/**
 * The files marked "Posted by hand" on a card, one row each — the answer to
 * "5 ready in one card, one posted by hand: how is that logged?" It is logged
 * on the card (`posted_slides.hand`, with the time and the link), and the
 * Posts page lists those rows next to the jobs.
 */
export function byHandRows(
  items: readonly { id: string; title?: string | null; client_id?: string | null; posted_slides?: unknown }[],
  slidesOf: (item: { id: string }) => readonly { url: string }[] = () => [],
): ByHandRow[] {
  const out: ByHandRow[] = []
  for (const item of items) {
    const p = readPostedSlides(item.posted_slides)
    if (!p?.hand?.length) continue
    const slides = slidesOf(item)
    for (const h of p.hand) {
      const i = slides.findIndex(s => s.url === h.url)
      out.push({
        item_id: item.id, title: item.title ?? 'Post', client_id: item.client_id ?? null,
        url: h.url, at: h.at, link: h.link,
        index: i >= 0 ? i + 1 : 0, total: p.total,
      })
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/* ── the numbers per client ─────────────────────────────────────────────── */

export type ClientStats = {
  client_id: string | null
  /** POSTS that went out (a post live on any channel counts once) */
  went_out: number
  /** posts scheduled and not yet out */
  booked: number
  /** posts that did not go out on at least one channel, or were cancelled */
  did_not: number
  /** files marked posted by hand */
  by_hand: number
  /** "Reel" → 4, "Feed post" → 2 — what went out, per CHANNEL (one post to
   *  Instagram and TikTok is a reel and a video) */
  kinds: Record<string, number>
}

/**
 * The numbers per client, in POSTS — the same unit as the tabs, so the card
 * and the tabs never disagree (9 Sep 2026: the card said "13 did not" in
 * channels while the tab said 9 in posts, and the headline said 5 in
 * failed jobs — three answers to one question).
 */
export function clientStats(
  jobs: readonly (OutcomeJob & { client_id?: string | null })[],
  byHand: readonly ByHandRow[],
  opts: { sinceMs?: number } = {},
): ClientStats[] {
  const since = opts.sinceMs ?? 0
  const map = new Map<string | null, ClientStats>()
  const get = (id: string | null) => {
    let s = map.get(id)
    if (!s) { s = { client_id: id, went_out: 0, booked: 0, did_not: 0, by_hand: 0, kinds: {} }; map.set(id, s) }
    return s
  }
  const recent = (iso: string | null | undefined) => !since || !iso || Date.parse(iso) >= since
  for (const job of jobs) {
    const tabs = postsTabs(job)
    const scheduled = tabs.has('scheduled')
    const posted = tabs.has('posted') && recent(job.published_at ?? job.updated_at)
    const didNot = tabs.has('did_not_post') && recent(job.updated_at ?? job.created_at)
    if (!scheduled && !posted && !didNot) continue
    const s = get(job.client_id ?? null)
    if (scheduled) s.booked++
    if (posted) {
      s.went_out++
      for (const o of outcomesForJob(job)) {
        if (o.status === 'published') s.kinds[o.kind] = (s.kinds[o.kind] ?? 0) + 1
      }
    }
    if (didNot) s.did_not++
  }
  for (const h of byHand) {
    if (!recent(h.at)) continue
    get(h.client_id).by_hand++
  }
  return [...map.values()].sort((a, b) => (b.went_out + b.booked + b.did_not + b.by_hand) - (a.went_out + a.booked + a.did_not + a.by_hand))
}

/** "4 reels, 2 feed posts" */
export function kindsLine(kinds: Record<string, number>): string | null {
  const parts = Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${plural(k, n)}`)
  return parts.length ? parts.join(', ') : null
}

function plural(kind: string, n: number): string {
  const w = kind.toLowerCase()
  if (n === 1) return w
  if (w === 'story') return 'stories'
  return `${w}s`
}

/* ── the one line a board card says about its booking ───────────────────── */

/**
 * "Booked on TikTok, Instagram · Thu 10 Sep, 12:00 pm", "Posted on Instagram
 * · Wed 9 Sep, 11:46 pm", "2 of 5 posted · 3 booked on TikTok · Fri 9:00 am".
 * What the card in Ready to post / Posted says under its title, from the
 * posts that carry its files (the owner, 9 Sep 2026: "make it easy to
 * understand the cards… if it's scheduled then say what platform(s)").
 */
export function cardBookingLine(
  posts: readonly { status?: string | null; slides?: unknown; publish_job_ids?: unknown; scheduled_for?: string | null }[],
  jobsById: ReadonlyMap<string, OutcomeJob>,
  progress: { posted: number; total: number } | null,
  fmt: (iso: string) => string,
): string | null {
  const live = posts.filter(p => ['scheduled', 'published'].includes(String(p.status ?? '')))
  if (live.length === 0) return null
  const outcomes = live.flatMap(p => (Array.isArray(p.publish_job_ids) ? p.publish_job_ids : [])
    .map(id => jobsById.get(String(id))).filter((j): j is OutcomeJob => !!j).flatMap(outcomesForJob))
  const names = (list: PlatformOutcome[]) => [...new Set(list.map(o => networkName(o.platform)))].join(', ')
  const out = outcomes.filter(o => o.status === 'published')
  const booked = outcomes.filter(o => o.status === 'scheduled' || o.status === 'queued' || o.status === 'pending')
  const failed = outcomes.filter(o => o.status === 'failed')
  const soonest = booked.map(o => o.at).filter((a): a is string => !!a).sort()[0]
    ?? live.filter(p => p.status === 'scheduled').map(p => p.scheduled_for).filter((a): a is string => !!a).sort()[0]
  const latest = out.map(o => o.at).filter((a): a is string => !!a).sort().slice(-1)[0]
  const parts: string[] = []
  if (progress && progress.posted > 0 && progress.posted < progress.total) parts.push(`${progress.posted} of ${progress.total} posted`)
  if (booked.length) parts.push(`Booked on ${names(booked)}${soonest ? ` · ${fmt(soonest)}` : ''}`)
  else if (out.length && !(progress && progress.posted > 0 && progress.posted < progress.total)) parts.push(`Posted on ${names(out)}${latest ? ` · ${fmt(latest)}` : ''}`)
  if (failed.length) parts.push(`Did not post on ${names(failed)}`)
  if (parts.length && live.some(p => (Array.isArray(p.publish_job_ids) ? p.publish_job_ids : [])
    .some(id => { const j = jobsById.get(String(id)); return j ? jobIsTrial(j) : false }))) {
    parts.push('Trial Reel')
  }
  return parts.length ? parts.join(' · ') : null
}

/* ── one file on a card: booked or out? ─────────────────────────────────── */

export type FileBooking = {
  status: 'scheduled' | 'published'
  at: string | null
  outcomes: PlatformOutcome[]
}

/**
 * For one file of a card: the post that carries it, if that post is booked
 * or has gone out — so the card can say "Scheduled · Fri 9:00" or "Went out on
 * Instagram" under the file, next to "Posted by hand" on the ones done by hand.
 */
export function fileBooking(
  url: string,
  posts: readonly { status?: string | null; slides?: unknown; publish_job_ids?: unknown; scheduled_for?: string | null }[],
  jobsById: ReadonlyMap<string, OutcomeJob>,
): FileBooking | null {
  for (const p of posts) {
    const status = String(p.status ?? '')
    if (status !== 'scheduled' && status !== 'published') continue
    const slides = Array.isArray(p.slides) ? p.slides as { url?: unknown }[] : []
    if (!slides.some(s => s?.url === url)) continue
    const jobs = (Array.isArray(p.publish_job_ids) ? p.publish_job_ids : [])
      .map(id => jobsById.get(String(id))).filter((j): j is OutcomeJob => !!j)
    const outcomes = jobs.flatMap(outcomesForJob)
    const live = outcomes.filter(o => o.status === 'published')
    if (status === 'published' || live.length > 0) {
      return { status: 'published', at: live[0]?.at ?? jobs[0]?.published_at ?? null, outcomes }
    }
    return { status: 'scheduled', at: p.scheduled_for ?? jobs[0]?.scheduled_for ?? null, outcomes }
  }
  return null
}
