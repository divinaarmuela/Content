import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, PostVersion, SocialAccount, SocialPost } from '@/lib/db-types'
import { getPublisher } from './publisher'
import { liveTiles, type LiveTile } from './feed-preview-core'
import { clientPostNotes, readFrozenPost, reviewFiles, type FrozenPost, type PortalPostNote } from './portal-core'
import { optionsFromExtras, readPerChannel } from './schedule-compose-core'
import { buildPostPreview, clientPreviews, type ClientPreview } from './post-preview-core'
import { postVersionId, readPostState, type PostState } from './post-stage-core'
import { scheduledWhen } from './portal-words'
import { ifNoAnswerOf, insideLastSlot, postOnPortal, reviewState, type ReviewState } from './one-portal-core'
import type { PortalScope } from './portal-owner-core'

/**
 * THE SCHEDULING TAB (docs/ONE_PORTAL_SPEC.md R10, R11): per connected network, the client's profile — their
 * booked posts (as each network will show them, the frozen version they answer) above what is already posted
 * (Zernio's 25 newest per account, including posts made outside the app). Server only; the page hands the client
 * only what it draws.
 */

/** the networks the tab draws, in its order */
export const SCHEDULING_NETWORKS = ['instagram', 'linkedin', 'tiktok'] as const
export type SchedulingNetwork = (typeof SCHEDULING_NETWORKS)[number]

export type ScheduledTile = {
  kind: 'booked'
  post_id: string
  /** the piece of work it came from (its card) — the Scheduling tab's mini pages; 'other' when there is none */
  work_id: string
  work_title: string
  /** the version the client answers — the act route refuses any other */
  version: number
  title: string
  when: string | null
  scheduled_for: string | null
  cover: { url: string; type: 'image' | 'video' } | null
  files: number
  caption: string
  state: ReviewState
  /** the client may answer now (booked, or a "wait" post that came off unanswered) */
  answerable: boolean
  /** inside the last 15 minutes: an answer moves it to the next free slot first (R8) */
  last_slot: boolean
  waiting_for_them: boolean
  note: string | null
  preview: ClientPreview[]
  /** the post's client thread — the client's comments and the team's replies there, every version */
  notes: (PortalPostNote & { version: number | null })[]
  /** the client may add a comment now (anything still to go out) */
  may_comment: boolean
}

export type PostedTile = LiveTile & {
  /** the numbers we keep for posts that went out through us (post_analytics), when there are some */
  stats: { views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null } | null
}

export type NetworkProfile = {
  network: SchedulingNetwork
  account_id: string
  handle: string | null
  name: string | null
  avatar_url: string | null
  booked: ScheduledTile[]
  /** taken off: Not approved, or a "wait" post that came off unanswered */
  off: ScheduledTile[]
  posted: PostedTile[]
  /** the feed could not be read this time — the page says so instead of drawing an empty profile */
  feed_problem: string | null
}

const FEED_FRESH_MS = 15 * 60 * 1000

type FeedRow = { id: string; client_id: string; platform: string; tiles: LiveTile[]; fetched_at: string; error: string | null }

/** One account's posted feed: the stored copy, refreshed from Zernio when older than 15 minutes. */
async function feedFor(account: SocialAccount, now: Date): Promise<{ tiles: LiveTile[]; problem: string | null }> {
  const feeds = table<FeedRow>('portal_feeds')
  const stored = await feeds.get(account.id).catch(() => null)
  const fresh = stored && now.getTime() - Date.parse(stored.fetched_at) < FEED_FRESH_MS
  if (fresh) return { tiles: Array.isArray(stored.tiles) ? stored.tiles : [], problem: stored.error }
  try {
    const raw = account.provider_account_id ? await getPublisher().accountPosts(account.provider_account_id) : null
    if (!raw) throw new Error('Zernio did not answer')
    const tiles = liveTiles(raw, 25)
    const row: FeedRow = { id: account.id, client_id: String(account.client_id), platform: String(account.platform), tiles, fetched_at: now.toISOString(), error: null }
    // one writer: only replace a copy that is still the stale one we read
    await feeds.claim(account.id, cur => (!cur || cur.fetched_at === stored?.fetched_at ? row : null)).catch(() => undefined)
    return { tiles, problem: null }
  } catch (e) {
    const problem = 'Your posted posts could not be loaded just now — they will show again shortly.'
    console.error('[one portal] feed', account.id, e instanceof Error ? e.message : e)
    // keep the last good copy if there is one, and say why it is old
    return { tiles: stored && Array.isArray(stored.tiles) ? stored.tiles : [], problem: stored?.tiles?.length ? null : problem }
  }
}

const sameUrl = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()

export async function loadScheduling(
  clientId: string, scope: PortalScope, tz: string, now = new Date(),
  /** false: the booked posts only (the tab's badge on another tab) — no feed is read, Zernio is not called */
  withFeeds = true,
): Promise<NetworkProfile[]> {
  const [accounts, rows, items] = await Promise.all([
    table<SocialAccount>('social_accounts').list({ where: a => a.client_id === clientId && a.active !== false }),
    table<SocialPost>('social_posts').list({ where: r => r.client_id === clientId && (r.stage === 'booked' || r.stage === 'ready' || r.stage === 'draft') }),
    table<ContentItem>('content_items').list({ where: r => r.client_id === clientId }),
  ])
  const itemById = new Map(items.map(i => [i.id, i]))
  const contactOf = (p: PostState) => {
    const it = p.source_item_id ? itemById.get(p.source_item_id) : null
    return it ? ((it as { for_contact_id?: string | null }).for_contact_id ?? null) : null
  }
  // the posts this tab draws: booked; a "wait" post that came off unanswered; one the client said no to
  const posts = rows
    .map(r => readPostState(r as unknown as Record<string, unknown>))
    .filter((p): p is PostState => !!p && postOnPortal(contactOf(p), scope))
    .filter(p => p.stage === 'booked'
      || (p.stage === 'ready' && ifNoAnswerOf(p) === 'wait' && !p.client_review && p.sent_version != null)
      || (p.stage === 'draft' && p.client_review?.verdict === 'not_approved'))
  const versionIds = posts.flatMap(p => (p.stage === 'draft' && p.client_review?.verdict === 'not_approved' ? [p.client_review.version] : p.sent_version != null ? [p.sent_version] : [])
    .map(n => postVersionId(p.id, n)))
  const versions = versionIds.length
    ? await table<PostVersion>('post_versions').list({ where: v => versionIds.includes(v.id) })
    : []
  const versionById = new Map(versions.map(v => [v.id, v]))
  const accountById = new Map(accounts.map(a => [a.id, a]))
  const postIds = new Set(posts.map(p => p.id))
  const noteRows = postIds.size
    ? await table<{ id: string; post_id: string; version?: number | null; visibility?: string | null; author_role?: string | null; author_name?: string | null; body?: string | null; created_at?: string | null; file_url?: string | null }>('post_comments')
      .list({ where: r => postIds.has(String(r.post_id)) }).catch(() => [])
    : []
  const versionOfNote = new Map(noteRows.map(r => [r.id, typeof r.version === 'number' ? r.version : null]))

  const tileOf = (p: PostState): ScheduledTile | null => {
    // the version the client sees: the one they said no to while it is off (Draft); otherwise the one booked
    const n = p.stage === 'draft' && p.client_review?.verdict === 'not_approved' ? p.client_review.version : p.sent_version
    const raw = n != null ? versionById.get(postVersionId(p.id, n)) : null
    const v: FrozenPost | null = raw ? readFrozenPost(raw as unknown as Record<string, unknown>) : null
    if (!v || n == null) return null
    const files = reviewFiles(v)
    const perChannel = readPerChannel((raw as unknown as Record<string, unknown>)?.per_channel)
    let preview: ClientPreview[] = []
    try {
      const built = buildPostPreview({
        caption: v.caption,
        media: v.slides.map(sl => ({ url: sl.url, type: sl.type, name: sl.name })),
        channels: v.channels.flatMap(id => {
          const a = accountById.get(id)
          if (!a) return []
          const own = v.per_channel[id]?.slides ?? []
          return [{
            id: a.id, platform: String(a.platform), handle: a.username, name: a.name, avatarUrl: a.avatar_url,
            options: optionsFromExtras(perChannel[id]),
            media: own.length ? own.map(sl => ({ url: sl.url, type: sl.type, name: sl.name })) : null,
            placeName: null,
          }]
        }),
      })
      preview = clientPreviews(built)
    } catch { preview = [] }
    const item = p.source_item_id ? itemById.get(p.source_item_id) : null
    const state = reviewState(p as never)
    const answerable = p.stage === 'booked' || (p.stage === 'ready' && ifNoAnswerOf(p) === 'wait' && !p.client_review)
    return {
      kind: 'booked',
      post_id: p.id,
      work_id: item ? item.id : 'other',
      work_title: item ? (String(item.title ?? '').trim() || 'Untitled work') : 'Other posts',
      version: n,
      title: String(item?.title ?? '').trim() || 'Your post',
      when: scheduledWhen(p.scheduled_for, tz),
      scheduled_for: p.scheduled_for,
      cover: files[0] ? { url: files[0].url, type: files[0].type === 'video' ? 'video' : 'image' } : null,
      files: files.length,
      caption: v.caption,
      state,
      answerable,
      last_slot: p.stage === 'booked' && insideLastSlot(p.scheduled_for, now.getTime()),
      waiting_for_them: ifNoAnswerOf(p) === 'wait',
      note: state === 'not_approved' ? p.client_review?.note ?? null : null,
      preview,
      notes: clientPostNotes(noteRows as never, p.id, null, 'You').map(n => ({ ...n, version: versionOfNote.get(n.id) ?? null })),
      may_comment: p.stage === 'booked' || p.stage === 'ready' || p.stage === 'draft',
    }
  }

  // the numbers we keep for posts that went out through us, matched to a feed tile by its link
  const analytics = !withFeeds ? [] : await table<{ id: string; platform_post_url?: string | null; views?: number | null; reach?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null }>('post_analytics')
    .list({ where: r => !!r.platform_post_url }).catch(() => [])

  const out: NetworkProfile[] = []
  for (const network of SCHEDULING_NETWORKS) {
    const account = accounts.find(a => String(a.platform) === network)
    if (!account) continue
    const mine = posts.filter(p => p.channels.includes(account.id))
    const tiles = mine.map(p => ({ p, t: tileOf(p) })).filter((x): x is { p: PostState; t: ScheduledTile } => !!x.t)
    const byTime = (a: { p: PostState }, b: { p: PostState }) => String(b.p.scheduled_for ?? '').localeCompare(String(a.p.scheduled_for ?? ''))
    const { tiles: live, problem } = withFeeds ? await feedFor(account, now) : { tiles: [] as LiveTile[], problem: null }
    out.push({
      network,
      account_id: account.id,
      handle: account.username ?? null,
      name: account.name ?? null,
      avatar_url: account.avatar_url ?? null,
      booked: tiles.filter(x => x.p.stage === 'booked').sort(byTime).map(x => x.t),
      off: tiles.filter(x => x.p.stage !== 'booked').sort(byTime).map(x => x.t),
      posted: live.map(t => {
        const s = analytics.find(r => sameUrl(r.platform_post_url, t.permalink))
        return {
          ...t,
          stats: s ? { views: s.views ?? null, reach: s.reach ?? null, likes: s.likes ?? t.likes, comments: s.comments ?? t.comments, shares: s.shares ?? null, saves: s.saves ?? null } : null,
        }
      }),
      feed_problem: problem,
    })
  }
  return out
}

/** THE WORKS (the owner, 2 Oct 2026: "each tab has mini pages… by the work"): one entry per piece the booked
 *  posts came from, with how many are booked, wait on the client, and came off; "Other posts" last. */
export type SchedulingWork = { id: string; title: string; booked: number; waiting: number; off: number; next: string | null }
export function schedulingWorks(profiles: readonly NetworkProfile[]): SchedulingWork[] {
  const seen = new Map<string, { t: ScheduledTile; off: boolean }>()
  for (const p of profiles) {
    for (const t of p.booked) if (!seen.has(t.post_id)) seen.set(t.post_id, { t, off: false })
    for (const t of p.off) if (!seen.has(t.post_id)) seen.set(t.post_id, { t, off: true })
  }
  const works = new Map<string, SchedulingWork>()
  for (const { t, off } of seen.values()) {
    const w = works.get(t.work_id) ?? { id: t.work_id, title: t.work_title, booked: 0, waiting: 0, off: 0, next: null }
    if (off) w.off += 1
    else {
      w.booked += 1
      if (!w.next || String(t.scheduled_for ?? '') < String(w.next)) w.next = t.scheduled_for
    }
    if (t.answerable && (t.state === 'not_reviewed' || t.state === 'asked_again')) w.waiting += 1
    works.set(t.work_id, w)
  }
  return [...works.values()].sort((a, b) =>
    (a.id === 'other' ? 1 : 0) - (b.id === 'other' ? 1 : 0) || (b.waiting - a.waiting) || String(a.next ?? '~').localeCompare(String(b.next ?? '~')))
}

/** The profiles holding only one work's posts (its mini page); the posted feed is the "Your feed" page's. */
export function profilesForWork(profiles: readonly NetworkProfile[], workId: string): NetworkProfile[] {
  return profiles
    .map(p => ({ ...p, booked: p.booked.filter(t => t.work_id === workId), off: p.off.filter(t => t.work_id === workId), posted: [], feed_problem: null }))
    .filter(p => p.booked.length + p.off.length > 0)
}

/** How many booked posts wait on the client's word — the tab's badge. */
export function schedulingWaiting(profiles: readonly NetworkProfile[]): number {
  const ids = new Set<string>()
  for (const p of profiles) for (const t of p.booked) if (t.answerable && (t.state === 'not_reviewed' || t.state === 'asked_again')) ids.add(t.post_id)
  for (const p of profiles) for (const t of p.off) if (t.answerable) ids.add(t.post_id)
  return ids.size
}
