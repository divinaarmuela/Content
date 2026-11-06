import 'server-only'
import { table } from '@/lib/db'
import type { Client, MetaFbPage, PublishJob as PublishJobRow } from '@/lib/db-types'
import type { MediaItem, Target } from './publish-core'
import { mediaForTarget } from './meta-route-core'
import {
  META_FB_PROVIDER, facebookRoute, fbFailure, fbRequestFor, fbResumeDecision, readMetaFbJobState,
  type FacebookRoute, type FbPageLite, type MetaFbJobState,
} from './meta-fb-core'
import * as fb from './meta-fb-client'
import { pageAuthById } from './meta-fb'

/**
 * FACEBOOK PAGE THROUGH THE AGENCY'S OWN META APP — the publishing road (6 Nov 2026), the twin of
 * meta-ig-publish.ts. The rule is meta-fb-core.ts facebookRoute; this is the I/O.
 *
 * Only when `clients.facebook_via_meta` is on AND the client has its picked (active) meta_fb_pages row.
 * Everything else — every other client — goes to Zernio exactly as before.
 *
 * NEVER TWICE. Facebook has no container to ask about afterwards, so the job writes `sending_at` on its row
 * BEFORE the one publishing call. A retry that finds `sending_at` and no `post_id` does not post again: it
 * fails with words asking a person to look at the Page (a missing post is fixable; a doubled one is not).
 */

export async function metaFbRoutingFor(clientId: string | null | undefined): Promise<{ viaMeta: boolean; pages: FbPageLite[] }> {
  if (!clientId) return { viaMeta: false, pages: [] }
  const client = await table<Client>('clients').get(clientId, { fresh: true }).catch(() => null)
  const viaMeta = (client as { facebook_via_meta?: unknown } | null)?.facebook_via_meta === true
  if (!viaMeta) return { viaMeta: false, pages: [] }
  const rows = await table<MetaFbPage>('meta_fb_pages').list({ by: { client_id: clientId }, fresh: true }).catch(() => [])
  return { viaMeta, pages: rows.map(r => ({ id: r.id, name: r.name ?? null, active: r.active === true })) }
}

/** The booking's targets split: the one Facebook target through Meta (if any) and the rest, unchanged. */
export async function splitBookingForMetaFb(input: { clientId: string | null | undefined; targets: Target[]; media: MediaItem[] }):
  Promise<{ meta: { target: Target; state: MetaFbJobState } | null; rest: Target[]; routes: FacebookRoute[] }> {
  const routing = await metaFbRoutingFor(input.clientId)
  if (!routing.viaMeta) return { meta: null, rest: input.targets, routes: [] }
  let meta: { target: Target; state: MetaFbJobState } | null = null
  const rest: Target[] = []
  const routes: FacebookRoute[] = []
  for (const t of input.targets) {
    if (t.platform !== 'facebook' || meta) { rest.push(t); continue }
    const route = facebookRoute({ clientViaMeta: true, pages: routing.pages, media: mediaForTarget(input.media, t), options: (t.options ?? null) as never })
    routes.push(route)
    if (route.via === 'meta') meta = { target: t, state: { page_id: route.pageId, page_name: route.pageName } }
    else rest.push(t)
  }
  return { meta, rest, routes }
}

/** At its time: still switched on, still the picked Page? Otherwise it goes through Zernio — unless it may already be out. */
export async function metaFbStillRouted(job: Pick<PublishJobRow, 'client_id' | 'provider' | 'meta_fb'>): Promise<{ ok: true; state: MetaFbJobState } | { ok: false; reason: string }> {
  if (job.provider !== META_FB_PROVIDER) return { ok: false, reason: 'not a Facebook (Meta) job' }
  const state = readMetaFbJobState(job.meta_fb)
  if (!state) return { ok: false, reason: 'The job does not say which Facebook Page to post to' }
  if (state.post_id || state.sending_at) return { ok: true, state }
  const routing = await metaFbRoutingFor(job.client_id)
  if (!routing.viaMeta) return { ok: false, reason: 'Facebook via Meta was switched off for this client, so it went through Zernio' }
  if (!routing.pages.some(p => p.id === state.page_id && p.active)) return { ok: false, reason: 'The direct Facebook Page connection is no longer active, so it went through Zernio' }
  return { ok: true, state }
}

export type MetaFbPublishOutcome =
  | { kind: 'published'; postId: string | null; permalink: string | null; note: string | null }
  | { kind: 'retryable'; message: string }
  | { kind: 'permanent'; message: string }

/** Publish one Meta job's Facebook target. Never throws. */
export async function publishJobToFacebook(job: { id: string; caption: string; media: MediaItem[]; targets: Target[]; meta_fb?: unknown }): Promise<MetaFbPublishOutcome> {
  const target = job.targets.find(t => t.platform === 'facebook')
  let state = readMetaFbJobState(job.meta_fb)
  if (!target || !state) return { kind: 'permanent', message: 'Facebook (direct, Meta): the job has no Facebook Page to post to' }
  const save = async (patch: Partial<MetaFbJobState>) => {
    state = { ...state!, ...patch }
    await table('publish_jobs').update(job.id, { meta_fb: state, updated_at: new Date().toISOString() })
  }

  const decision = fbResumeDecision(state)
  if (decision === 'done') return { kind: 'published', postId: state.post_id ?? null, permalink: state.permalink ?? null, note: null }
  if (decision === 'unknown') {
    return { kind: 'permanent', message: 'Facebook (direct, Meta): an earlier try was cut off while posting, so it is not sent again — check the Page; if the post is not there, book it again' }
  }

  const plan = fbRequestFor({ caption: job.caption, media: mediaForTarget(job.media, target) as never, options: (target.options ?? null) as never })
  if (!plan.ok) return { kind: 'permanent', message: `Facebook (direct, Meta): ${plan.reason}` }

  try {
    const p = await pageAuthById(state.page_id)
    const photoIds: string[] = []
    if (plan.req.kind === 'PHOTOS') {
      // unpublished pictures are invisible until attached, so making them again on a retry posts nothing
      for (const url of plan.req.urls) photoIds.push(await fb.uploadUnpublishedPhoto(p.auth, p.pageId, url))
      await save({ photo_ids: photoIds })
    }
    // ON THE ROW BEFORE THE CALL: from here, a retry never posts again
    await save({ sending_at: new Date().toISOString() })
    let postId: string
    try {
      postId = (await fb.publishOnce(p.auth, p.pageId, plan.req, photoIds)).postId
    } catch (e) {
      // Facebook ANSWERED with a refusal: nothing was posted, so the mark comes off and it may be tried again
      if (e instanceof fb.MetaFbError && e.status !== undefined && e.status < 500) await save({ sending_at: null }).catch(() => {})
      throw e
    }
    await save({ post_id: postId, published_at: new Date().toISOString() })
      .catch(err => console.error('[meta-fb publish] published, but the post id was not written', job.id, postId, err instanceof Error ? err.message : err))
    const permalink = await fb.postPermalink(p.auth, postId).catch(() => null)
    if (permalink) await save({ permalink }).catch(() => {})
    let note: string | null = null
    if (plan.firstComment) {
      try {
        const c = await fb.replyToFbComment(p.auth, postId, plan.firstComment)
        await save({ first_comment_id: c.id, first_comment_error: null })
      } catch (e) {
        const words = fbFailure(e as fb.MetaFbError).words
        note = `The first comment did not go up — ${words}`
        await save({ first_comment_error: words }).catch(() => {})
      }
    }
    return { kind: 'published', postId, permalink, note }
  } catch (e) {
    if (!(e instanceof fb.MetaFbError)) return { kind: 'retryable', message: `Facebook (direct, Meta): ${e instanceof Error ? e.message : String(e)}` }
    const f = fbFailure(e)
    return f.retry && !state.sending_at ? { kind: 'retryable', message: f.words } : { kind: 'permanent', message: f.words }
  }
}
