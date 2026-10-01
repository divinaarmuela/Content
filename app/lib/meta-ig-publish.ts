import 'server-only'
import { table } from '@/lib/db'
import type { Client, MetaIgAccount, PublishJob as PublishJobRow, SocialAccount } from '@/lib/db-types'
import type { MediaItem, Target } from './publish-core'
import { containerState } from './meta-ig-core'
import * as ig from './meta-ig-client'
import { accessTokenFor } from './meta-ig'
import { headStoredObject } from './storage'
import {
  META_PROVIDER, instagramRoute, mediaForTarget, metaFailure, metaRequestFor, readMetaJobState,
  type InstagramRoute, type MetaAccountLite, type MetaJobState,
} from './meta-route-core'

/**
 * INSTAGRAM THROUGH THE AGENCY'S OWN META APP — the publishing road (1 Oct
 * 2026, branch meta-publish). The rule is meta-route-core.ts; this file is
 * the I/O: reading the client's switch and connections, and publishing one
 * job's Instagram target container by container.
 *
 * NEVER TWICE. A publish job is already claimed by exactly one worker
 * (publish.ts, queued → publishing). On top of that, everything Meta hands
 * back is written onto the job (`publish_jobs.meta_ig`) the moment it exists
 * — the carousel's item containers, then the container to publish, then the
 * media id — and the container id is on the row BEFORE media_publish is
 * called. A retry (a crashed run, a timeout, the 15-minute reclaim) does not
 * start again: it asks Instagram what became of that container. PUBLISHED
 * means it went out and is recorded as out; FINISHED means media_publish is
 * called with the same container, which Instagram publishes only once.
 * (The re-send incident of 24 Sep 2026 — a stale "failed" acted on, LinkedIn
 * posted twice — is why a recorded live post is never re-sent here.)
 */

/** The client's switch and its direct connections (no tokens). */
export async function metaRoutingFor(clientId: string | null | undefined): Promise<{ viaMeta: boolean; accounts: MetaAccountLite[] }> {
  if (!clientId) return { viaMeta: false, accounts: [] }
  const client = await table<Client>('clients').get(clientId, { fresh: true }).catch(() => null)
  const viaMeta = (client as { instagram_via_meta?: unknown } | null)?.instagram_via_meta === true
  if (!viaMeta) return { viaMeta: false, accounts: [] }
  const rows = await table<MetaIgAccount>('meta_ig_accounts').list({ by: { client_id: clientId }, fresh: true }).catch(() => [])
  return { viaMeta, accounts: rows.map(r => ({ id: r.id, username: r.username, status: r.status })) }
}

/**
 * A booking's targets, split: the one Instagram target that goes through
 * Meta (if any), and the rest — which go to Zernio exactly as before. With
 * the switch off this is `{ meta: null, rest: targets }` and nothing changes.
 */
export async function splitBookingForMeta(input: {
  clientId: string | null | undefined
  targets: Target[]
  accounts: Pick<SocialAccount, 'id' | 'platform' | 'username' | 'provider_account_id'>[]
  media: MediaItem[]
}): Promise<{ meta: { target: Target; state: MetaJobState } | null; rest: Target[]; routes: InstagramRoute[] }> {
  const routing = await metaRoutingFor(input.clientId)
  if (!routing.viaMeta) return { meta: null, rest: input.targets, routes: [] }
  let meta: { target: Target; state: MetaJobState } | null = null
  const rest: Target[] = []
  const routes: InstagramRoute[] = []
  for (const t of input.targets) {
    if (t.platform !== 'instagram' || meta) { rest.push(t); continue }
    const account = input.accounts.find(a => a.platform === 'instagram' && (a.provider_account_id || a.id) === t.accountId)
    const route = instagramRoute({
      clientViaMeta: routing.viaMeta, metaAccounts: routing.accounts,
      channelUsername: account?.username ?? null, options: t.options ?? null,
      media: mediaForTarget(input.media, t),
    })
    routes.push(route)
    if (route.via === 'meta') meta = { target: t, state: { ig_user_id: route.igUserId, username: route.username } }
    else rest.push(t)
  }
  return { meta, rest, routes }
}

/** At its time: is the switch still on and the connection still active? Otherwise the job goes through Zernio. */
export async function metaStillRouted(job: Pick<PublishJobRow, 'client_id' | 'provider' | 'meta_ig'>): Promise<{ ok: true; state: MetaJobState } | { ok: false; reason: string }> {
  if (job.provider !== META_PROVIDER) return { ok: false, reason: 'not a Meta job' }
  const state = readMetaJobState(job.meta_ig)
  if (!state) return { ok: false, reason: 'The job does not say which Instagram account to post to' }
  // already out: whatever the switch says now, it is not sent again anywhere
  if (state.media_id || state.creation_id) return { ok: true, state }
  const routing = await metaRoutingFor(job.client_id)
  if (!routing.viaMeta) return { ok: false, reason: 'Instagram via Meta was switched off for this client, so it went through Zernio' }
  const acct = routing.accounts.find(a => a.id === state.ig_user_id)
  if (!acct || acct.status !== 'active') return { ok: false, reason: 'The direct Instagram connection is no longer active, so it went through Zernio' }
  return { ok: true, state }
}

export type MetaPublishOutcome =
  | { kind: 'published'; mediaId: string | null; permalink: string | null; note: string | null }
  | { kind: 'retryable'; message: string }
  | { kind: 'permanent'; message: string }

/** Poll interval for a container still processing. META_IG_POLL_MS exists for the tests. */
const pollMs = () => {
  const n = Number(process.env.META_IG_POLL_MS)
  return Number.isFinite(n) && n >= 0 ? n : 5000
}
/** How long one run waits on Instagram's processing in all (the Inngest run is capped at 300 s). */
const WAIT_BUDGET_MS = 200_000

class StillProcessing extends Error {}

/** The file's own Content-Type, when our storage says one — the check for a URL with no extension. */
async function contentTypeProblem(item: { type: 'image' | 'video'; url: string }, n: number): Promise<string | null> {
  const head = await headStoredObject(item.url).catch(() => null)
  const ct = head?.contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!ct || ct === 'application/octet-stream' || ct === 'binary/octet-stream') return null
  if (item.type === 'image' && ct !== 'image/jpeg' && ct !== 'image/jpg') {
    return `Instagram (direct, Meta): Instagram's own API takes JPEG pictures only, and file ${n} is ${ct}. Export it as a JPEG and book it again.`
  }
  if (item.type === 'video' && ct !== 'video/mp4' && ct !== 'video/quicktime') {
    return `Instagram (direct, Meta): Instagram's own API takes MP4 or MOV video only, and file ${n} is ${ct}. Export it as MP4 and book it again.`
  }
  return null
}

/**
 * Publish one Meta job's Instagram target. Never throws: every road ends in
 * published / retryable / permanent, with the words for the post.
 */
export async function publishJobToInstagram(job: {
  id: string; caption: string; media: MediaItem[]; targets: Target[]; meta_ig?: unknown
}): Promise<MetaPublishOutcome> {
  const target = job.targets.find(t => t.platform === 'instagram')
  let state = readMetaJobState(job.meta_ig)
  if (!target || !state) return { kind: 'permanent', message: 'Instagram (direct, Meta): the job has no Instagram account to post to' }
  const igUserId = state.ig_user_id

  const save = async (patch: Partial<MetaJobState>) => {
    state = { ...state!, ...patch }
    await table('publish_jobs').update(job.id, { meta_ig: state, updated_at: new Date().toISOString() })
  }

  const plan = metaRequestFor({ caption: job.caption, media: mediaForTarget(job.media, target), options: target.options ?? null })
  if (!plan.ok) return { kind: 'permanent', message: `Instagram (direct, Meta): ${plan.reason}` }
  const req = plan.req

  const deadline = Date.now() + WAIT_BUDGET_MS
  const waitReady = async (token: string, id: string) => {
    for (;;) {
      const code = await ig.containerStatus(token, id)
      const s = containerState(code)
      if (s === 'ready') return
      if (s === 'failed') throw new ig.MetaIgError(`Instagram could not process the media (${String(code)})`)
      if (Date.now() + pollMs() > deadline) throw new StillProcessing('Instagram is still processing the media — it will be tried again in a few minutes')
      await new Promise(r => setTimeout(r, pollMs()))
    }
  }

  try {
    const token = await accessTokenFor(igUserId)

    // ── already out (a run that died after media_publish answered) ──
    if (state.media_id) {
      return { kind: 'published', mediaId: state.media_id, permalink: state.permalink ?? null, note: null }
    }

    // ── a container from an earlier try: ask Instagram what became of it ──
    if (state.creation_id) {
      const code = await ig.containerStatus(token, state.creation_id)
      if (code === 'PUBLISHED') {
        // it went out; the media id never reached the row. Out is out — it is not published again.
        const at = new Date().toISOString()
        await save({ published_at: at })
        return { kind: 'published', mediaId: null, permalink: null, note: 'Published on Instagram; the link could not be read back' }
      }
      if (code === 'EXPIRED') await save({ creation_id: null, children: [] })     // unpublished and gone: make it again
      else if (code === 'ERROR') return { kind: 'permanent', message: 'Instagram (direct, Meta): Instagram could not process the media' }
    }

    if (!state.creation_id) {
      // the quota first: a full one refuses before anything is made
      const room = await ig.publishingLimit(token, igUserId)
      if (room && room.used >= room.total) {
        return { kind: 'permanent', message: `Instagram (direct, Meta): the account has reached Instagram's limit of ${room.total} posts in 24 hours (${room.used} used). Book it again later.` }
      }
      // a file with no extension in its URL: its Content-Type decides
      const items = req.kind === 'CAROUSEL' ? req.items
        : req.kind === 'STORIES' ? [req.media]
          : req.kind === 'REELS' ? [{ type: 'video' as const, url: req.videoUrl }]
            : [{ type: 'image' as const, url: req.imageUrl }]
      for (const [i, it] of items.entries()) {
        const problem = await contentTypeProblem(it, i + 1)
        if (problem) return { kind: 'permanent', message: problem }
      }

      const children: string[] = []
      if (req.kind === 'CAROUSEL') {
        // in the post's order; each one written down as it is made, so a retry carries on from there
        const made = state.children ?? []
        for (const [i, item] of req.items.entries()) {
          const id = made[i] ?? await ig.createCarouselItem(token, igUserId, item)
          children.push(id)
          if (!made[i]) await save({ children: [...children] })
        }
        for (const [i, item] of req.items.entries()) if (item.type === 'video') await waitReady(token, children[i])
      }
      const creationId = await ig.createContainer(token, igUserId, req, children)
      // ON THE ROW BEFORE media_publish: the line between "make it again" and "ask what became of it"
      await save({ creation_id: creationId })
    }

    await waitReady(token, state.creation_id!)
    const { mediaId } = await ig.publishContainer(token, igUserId, state.creation_id!)
    // IT IS OUT. From here nothing may turn this into a failure or a retry — a row write that fails
    // is logged, and the claim (status 'published') is what stops it ever being sent again
    await save({ media_id: mediaId, published_at: new Date().toISOString() })
      .catch(e => console.error('[meta-ig publish] published, but the media id was not written', job.id, mediaId, e instanceof Error ? e.message : e))

    // the rest is bookkeeping and a courtesy: neither can make a published post look failed
    const permalink = await ig.mediaPermalink(token, mediaId).catch(() => null)
    if (permalink) await save({ permalink }).catch(() => {})
    let note: string | null = null
    if (plan.firstComment && !state.first_comment_id) {
      try {
        const c = await ig.commentOnMedia(token, mediaId, plan.firstComment)
        await save({ first_comment_id: c.id, first_comment_error: null })
      } catch (e) {
        const words = metaFailure(e as ig.MetaIgError).words
        note = `The first comment did not go up — ${words}`
        await save({ first_comment_error: words }).catch(() => {})
      }
    }
    return { kind: 'published', mediaId, permalink, note }
  } catch (e) {
    if (e instanceof StillProcessing) return { kind: 'retryable', message: `Instagram (direct, Meta): ${e.message}` }
    // not Meta's answer (the database, a bug): a bad moment, tried again — nothing was published past
    // the last write, and anything made before it is on the row
    if (!(e instanceof ig.MetaIgError)) return { kind: 'retryable', message: `Instagram (direct, Meta): ${e instanceof Error ? e.message : String(e)}` }
    const f = metaFailure(e)
    return f.retry ? { kind: 'retryable', message: f.words } : { kind: 'permanent', message: f.words }
  }
}
