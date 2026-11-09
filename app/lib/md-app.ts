import 'server-only'
import { table } from '@/lib/db'
import type { MdAppAsset, MdAppConnection, MdAppEvent, MdAppPublish } from '@/lib/db-types'
import { credentialsKeyConfigured, decryptSecret, encryptSecret } from './secret-box'
import type { GraphErrorDetail, PublishItem } from './meta-ig-core'
import { carouselItemParams, carouselParentParams, containerParams, containerState } from './meta-ig-core'
import { fbMultiPhotoParams, fbPublishCall, fbUnpublishedPhotoParams, publishedPostId } from './meta-fb-core'
import {
  IG_ACCOUNT_METRICS, IG_MEDIA_METRICS, IG_WEBHOOK_FIELDS, MD_TESTS, PAGE_METRICS, PAGE_WEBHOOK_FIELDS_MD,
  assetRowId, mdAppReadiness, mdAppsecretProof, mdCodeExchangeUrl, mdErrorDetail, mdErrorMessage, mdGraphUrl,
  mdMessageBody, mdRedactUrl, mdResumeDecision, parseAssigned, parseBisuToken, parseGrantedTargets, parseBusinessId, parseMdInsights,
  parseMdWebhook, readMdAppEnv, summariseTestResult, testNeeds, usesMdApp, validateMdPublish,
  type AssetKind, type AssignedAsset, type MdAppReady, type MdInsight, type MdPublishRequest, type MdTestId,
} from './md-app-core'
import { allowedAdAccounts } from './md-app-ads-core'

/**
 * MD APP — the I/O half (6 Nov 2026). Pure rules and the doc quotes: md-app-core.ts. Read docs/MD_APP_SETUP.md.
 *
 * A separate, opt-in road: nothing here is called by Zernio's publisher, Zernio's webhook, the inbox copy or
 * the old meta-ig / meta-fb roads. Tables: md_app_connections (one per client, BISU token encrypted with
 * CREDENTIALS_KEY), md_app_assets, md_app_events, md_app_publishes. A token is never logged, returned or put
 * in an error (errors carry Meta's text, token-redacted, or a redacted URL).
 */

export class MdAppError extends Error {
  public detail: GraphErrorDetail | null
  constructor(message: string, public status?: number, detail?: GraphErrorDetail | null) {
    super(message); this.name = 'MdAppError'; this.detail = detail ?? null
  }
}

export function mdAppReady(): MdAppReady {
  return mdAppReadiness(readMdAppEnv(), credentialsKeyConfigured())
}

/* ── the Graph, on graph.facebook.com v27.0 ───────────────────────────── */

/** appId: needed only to read the token's granted accounts back (debug_token, see readAssigned) */
type Auth = { token: string; appSecret: string; appId?: string }

async function call(url: string, init?: RequestInit): Promise<any> {
  let res: Response
  try { res = await fetch(url, { ...init, cache: 'no-store' }) } catch {
    throw new MdAppError(`Could not reach Meta (${mdRedactUrl(url).split('?')[0]})`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || (json && typeof json === 'object' && 'error' in json && json.error)) {
    throw new MdAppError(mdErrorMessage(json, res.status), res.status, mdErrorDetail(json))
  }
  return json
}
const signed = (url: string, a: Auth) => {
  const u = new URL(url)
  u.searchParams.set('access_token', a.token)
  u.searchParams.set('appsecret_proof', mdAppsecretProof(a.token, a.appSecret))
  return u.toString()
}
const get = (a: Auth, path: string, params?: Record<string, string | number | boolean | undefined>) => call(signed(mdGraphUrl(path, params), a))
const post = (a: Auth, path: string, params: Record<string, string>) => call(signed(mdGraphUrl(path), a), {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
})
const postJson = (a: Auth, path: string, body: Record<string, unknown>) => call(signed(mdGraphUrl(path), a), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const del = (a: Auth, path: string) => call(signed(mdGraphUrl(path), a), { method: 'DELETE' })

/* ── tables ───────────────────────────────────────────────────────────── */

const connections = () => table<MdAppConnection>('md_app_connections')
const assets = () => table<MdAppAsset>('md_app_assets')

export type PublicConnection = Omit<MdAppConnection, 'token_encrypted'>
export function publicConnection(r: MdAppConnection): PublicConnection {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { token_encrypted, ...rest } = r
  return rest
}

/* ── connect ──────────────────────────────────────────────────────────── */

/** Every assigned asset of a kind, following paging (at most 5 pages). */
async function listAll(a: Auth, path: string, fields: string, kind: AssetKind): Promise<AssignedAsset[]> {
  const out: AssignedAsset[] = []
  let json = await get(a, path, { fields, limit: 100 })
  for (let i = 0; i < 5; i++) {
    out.push(...parseAssigned(kind, json))
    const next = json?.paging?.next
    if (typeof next !== 'string' || !next.startsWith('https://graph.facebook.com/')) break
    json = await call(next)
  }
  return out
}

/** Read what the BISU token was given. Each list may fail on its own (e.g. no ad accounts permission granted). */
export async function readAssigned(a: Auth): Promise<{ businessId: string | null; assets: AssignedAsset[]; errors: string[] }> {
  const errors: string[] = []
  const safe = async <T>(label: string, p: Promise<T>, fallback: T) => p.catch(e => { errors.push(`${label}: ${e instanceof Error ? e.message : 'failed'}`); return fallback })
  const failed = new Set<AssetKind>()
  const list = (label: string, kind: AssetKind, p: Promise<AssignedAsset[]>) =>
    p.catch(e => { failed.add(kind); errors.push(`${label}: ${e instanceof Error ? e.message : 'failed'}`); return [] as AssignedAsset[] })
  const [me, ig, pages, ads] = await Promise.all([
    // client_business_id answers only a system-user token; the one-login (personal) token gets #190 — not an error worth showing (9 Nov 2026)
    get(a, 'me', { fields: 'client_business_id' }).catch(() => null),
    list('Instagram', 'instagram', listAll(a, 'me/assigned_instagram_accounts', 'id,username', 'instagram')),
    list('Pages', 'page', listAll(a, 'me/accounts', 'id,name', 'page')),
    list('Ad accounts', 'ad_account', listAll(a, 'me/adaccounts', 'id,account_id,name', 'ad_account')),
  ])
  const found: Record<AssetKind, AssignedAsset[]> = { instagram: ig, page: pages, ad_account: ads }
  // Instagram through its linked Page — Meta's documented road for Instagram API with Facebook Login:
  // GET /{page-id}?fields=instagram_business_account (6 Nov 2026: the assigned-accounts edge came back empty).
  if (found.instagram.length === 0) {
    for (const p of found.page.slice(0, 50)) {
      const one = await get(a, p.id, { fields: 'instagram_business_account{id,username}' })
        .then(j => parseAssigned('instagram', { data: j?.instagram_business_account ? [j.instagram_business_account] : [] }))
        .catch(e => { errors.push(`Instagram via Page ${p.id}: ${e instanceof Error ? e.message : 'failed'}`); return [] as AssignedAsset[] })
      for (const x of one) if (!found.instagram.some(y => y.id === x.id)) found.instagram.push(x)
    }
  }
  // A list edge that failed or came back empty: read the granted ids from the token itself and fetch each asset
  // by id (parseGrantedTargets says why). An asset that reads fine clears that list's error.
  const missing = (Object.keys(found) as AssetKind[]).filter(k => found[k].length === 0)
  if (missing.length && a.appId) {
    const debug = await call(mdGraphUrl('debug_token', { input_token: a.token, access_token: `${a.appId}|${a.appSecret}` }))
      .catch(e => { errors.push(`granted accounts: ${e instanceof Error ? e.message : 'failed'}`); return null })
    const granted = debug ? parseGrantedTargets(debug) : null
    // Names only (never the token): which permissions Meta says this connection holds, so a missing one is visible.
    const scopes: unknown = debug?.data?.scopes
    if (Array.isArray(scopes)) errors.push(`Meta granted: ${scopes.filter(x => typeof x === 'string').join(', ') || 'nothing'}`)
    for (const kind of granted ? missing : []) {
      const fields = kind === 'instagram' ? 'id,username' : kind === 'ad_account' ? 'id,account_id,name' : 'id,name'
      for (const id of granted![kind].slice(0, 50)) {
        const one = await get(a, id, { fields }).then(j => parseAssigned(kind, { data: [j] })).catch(e => {
          errors.push(`${kind} ${id}: ${e instanceof Error ? e.message : 'failed'}`); return [] as AssignedAsset[]
        })
        found[kind].push(...one)
      }
      if (found[kind].length && failed.has(kind)) {
        const label = kind === 'instagram' ? 'Instagram' : kind === 'ad_account' ? 'Ad accounts' : 'Pages'
        for (let i = errors.length - 1; i >= 0; i--) if (errors[i].startsWith(`${label}:`)) errors.splice(i, 1)
      }
    }
  }
  return { businessId: parseBusinessId(me), assets: [...found.instagram, ...found.page, ...found.ad_account], errors }
}

/** Code → BISU token (stored encrypted, one per client) → assigned assets stored for a super admin to pick. */
export async function connectClient(ready: MdAppReady & { ok: true }, input: { code: string; clientId: string; userId: string; now: number }): Promise<{ assets: number; errors: string[] }> {
  const ex = parseBisuToken(await call(mdCodeExchangeUrl({ appId: ready.env.appId, appSecret: ready.env.appSecret, redirectUri: ready.env.redirectUri, code: input.code })))
  if (!ex.ok) throw new MdAppError(ex.error)
  return saveConnection(ready, { token: ex.token, clientId: input.clientId, userId: input.userId, now: input.now })
}

/**
 * Store a token as the client's connection and read what it reaches. Used by the system-user connect above AND by
 * the ONE-LOGIN connect (9 Nov 2026, md-app-ads.ts connectAds): before App Review, Meta gives ads permissions only to a
 * person's own login, so one user-token login now carries Instagram, Pages and Ads together. Page calls already read a
 * Page token on demand (pageAuth), so the same token works for every road. Ad accounts are kept to our own
 * (allowedAdAccounts) — a person's login sees every account they manage.
 */
export async function saveConnection(ready: MdAppReady & { ok: true }, input: { token: string; clientId: string; userId: string; now: number }): Promise<{ assets: number; errors: string[] }> {
  const auth = { token: input.token, appSecret: ready.env.appSecret, appId: ready.env.appId }
  const found = await readAssigned(auth)
  const kept = found.assets.filter(x => x.kind !== 'ad_account' || allowedAdAccounts([{ id: x.id.startsWith('act_') ? x.id : `act_${x.id}` }]).length > 0)
  const nowIso = new Date(input.now).toISOString()
  await connections().claim(input.clientId, cur => ({
    id: input.clientId, client_id: input.clientId, business_id: found.businessId ?? cur?.business_id ?? null,
    token_encrypted: encryptSecret(input.token), connected_by: input.userId, connected_at: nowIso, active: true,
    use_md_app: cur?.use_md_app === true, last_error: found.errors.length ? found.errors.join(' · ').slice(0, 600) : null,
  }))
  await storeAssets(input.clientId, kept, nowIso)
  return { assets: kept.length, errors: found.errors }
}

async function storeAssets(clientId: string, list: AssignedAsset[], nowIso: string) {
  for (const x of list) {
    await assets().claim(assetRowId(clientId, x.kind, x.id), cur => ({
      id: assetRowId(clientId, x.kind, x.id), client_id: clientId, kind: x.kind, asset_id: x.id, name: x.name,
      picked: cur?.picked === true, seen_at: nowIso,
    }))
  }
}

export async function refreshAssets(clientId: string, now: number): Promise<{ assets: number; errors: string[] }> {
  const c = await authFor(clientId)
  const found = await readAssigned(c.auth)
  await storeAssets(clientId, found.assets, new Date(now).toISOString())
  // the card's "Some things could not be read" line is this check's answer, not the first connect's
  await connections().claim(clientId, cur => (cur ? { ...cur, last_error: found.errors.length ? found.errors.join(' · ').slice(0, 600) : null } : null))
  return { assets: found.assets.length, errors: found.errors }
}

export async function statusFor(clientId: string): Promise<{ connection: PublicConnection | null; assets: MdAppAsset[]; usesMdApp: boolean }> {
  const [conn, rows] = await Promise.all([
    connections().get(clientId, { fresh: true }).catch(() => null),
    assets().list({ by: { client_id: clientId }, fresh: true }).catch(() => [] as MdAppAsset[]),
  ])
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || (a.name ?? '').localeCompare(b.name ?? ''))
  return { connection: conn ? publicConnection(conn) : null, assets: rows, usesMdApp: usesMdApp(conn) }
}

export async function setPicked(clientId: string, kind: AssetKind, assetId: string, picked: boolean): Promise<boolean> {
  const res = await assets().claim(assetRowId(clientId, kind, assetId), cur => (cur && cur.client_id === clientId ? { ...cur, picked } : null))
  return res.claimed
}

/** THE switch. Turning it on needs an active connection; it never touches the clients row or Zernio. */
export async function setUseMdApp(clientId: string, on: boolean): Promise<boolean> {
  const res = await connections().claim(clientId, cur => (cur && (cur.active || !on) ? { ...cur, use_md_app: on } : null))
  return res.claimed
}

export async function disconnect(clientId: string): Promise<boolean> {
  const cur = await connections().get(clientId, { fresh: true })
  if (!cur) return false
  await connections().remove(clientId)
  for (const r of await assets().list({ by: { client_id: clientId }, fresh: true })) await assets().remove(r.id).catch(() => undefined)
  return true
}

/** The client's decrypted BISU token — server side only. */
export async function authFor(clientId: string): Promise<{ auth: Auth; picked: MdAppAsset[] }> {
  const ready = mdAppReady()
  if (!ready.ok) throw new MdAppError(ready.reason, 503)
  const conn = await connections().get(clientId, { fresh: true })
  if (!conn || !conn.active) throw new MdAppError('This client is not connected to MD App yet. Press Connect first.', 409)
  const picked = (await assets().list({ by: { client_id: clientId }, fresh: true })).filter(r => r.picked)
  return { auth: { token: decryptSecret(conn.token_encrypted), appSecret: ready.env.appSecret, appId: ready.env.appId }, picked }
}

const pickedOf = (picked: MdAppAsset[], kind: AssetKind, id?: string) => {
  const row = id ? picked.find(r => r.kind === kind && r.asset_id === id) : picked.find(r => r.kind === kind)
  if (!row) throw new MdAppError(`Pick the client's ${kind === 'instagram' ? 'Instagram account' : kind === 'page' ? 'Facebook Page' : 'ad account'} first.`, 409)
  return row.asset_id
}

/** A Page token, read on demand with the BISU token (GET /{page-id}?fields=access_token — UNVERIFIED for BISU). Never stored. */
async function pageAuth(a: Auth, pageId: string): Promise<Auth> {
  const j = await get(a, pageId, { fields: 'access_token' })
  if (typeof j?.access_token !== 'string' || !j.access_token) throw new MdAppError('Meta did not give a Page token for that Page')
  return { token: j.access_token, appSecret: a.appSecret }
}

/* ── Instagram ────────────────────────────────────────────────────────── */

export const igApi = {
  profile: (a: Auth, ig: string) => get(a, ig, { fields: 'id,username,name,followers_count,follows_count,media_count,profile_picture_url' }),
  media: (a: Auth, ig: string, limit = 12) => get(a, `${ig}/media`, { fields: 'id,caption,media_type,timestamp,permalink,comments_count,like_count', limit }),
  comments: (a: Auth, mediaId: string) => get(a, `${mediaId}/comments`, { fields: 'id,text,username,timestamp,hidden,like_count,replies{id,text,username,timestamp}' }),
  reply: async (a: Auth, commentId: string, message: string) => ({ id: String((await post(a, `${commentId}/replies`, { message })).id) }),
  hide: (a: Auth, commentId: string, hide: boolean) => post(a, commentId, { hide: String(hide) }),
  deleteComment: (a: Auth, commentId: string) => del(a, commentId),
  accountInsights: async (a: Auth, ig: string): Promise<MdInsight[]> =>
    parseMdInsights(await get(a, `${ig}/insights`, { metric: IG_ACCOUNT_METRICS.join(','), period: 'day', metric_type: 'total_value' })),
  mediaInsights: async (a: Auth, mediaId: string): Promise<MdInsight[]> =>
    parseMdInsights(await get(a, `${mediaId}/insights`, { metric: IG_MEDIA_METRICS.join(',') })),
  conversations: (a: Auth, ig: string) => get(a, `${ig}/conversations`, { platform: 'instagram', fields: 'id,updated_time,participants,messages.limit(20){id,created_time,from,to,message}' }),
  send: (a: Auth, ig: string, to: string, text: string, mode: 'response' | 'human_agent') => postJson(a, `${ig}/messages`, mdMessageBody({ userId: to }, text, mode)),
  privateReply: (a: Auth, ig: string, commentId: string, text: string) => postJson(a, `${ig}/messages`, mdMessageBody({ commentId }, text)),
  publishLimit: (a: Auth, ig: string) => get(a, `${ig}/content_publishing_limit`, { fields: 'quota_usage,config' }),
  subscribe: (a: Auth, ig: string) => post(a, `${ig}/subscribed_apps`, { subscribed_fields: IG_WEBHOOK_FIELDS.join(',') }),
}

/* ── Facebook Page (Page token read on demand) ───────────────────────── */

export const pageApi = {
  posts: async (a: Auth, page: string) => get(await pageAuth(a, page), `${page}/feed`, { fields: 'id,message,created_time,permalink_url', limit: 12 }),
  comments: async (a: Auth, page: string, postId: string) => get(await pageAuth(a, page), `${postId}/comments`, { fields: 'id,message,created_time,from{id,name},is_hidden' }),
  replyComment: async (a: Auth, page: string, commentId: string, message: string) => post(await pageAuth(a, page), `${commentId}/comments`, { message }),
  hideComment: async (a: Auth, page: string, commentId: string, hide: boolean) => post(await pageAuth(a, page), commentId, { is_hidden: String(hide) }),
  deleteComment: async (a: Auth, page: string, commentId: string) => del(await pageAuth(a, page), commentId),
  insights: async (a: Auth, page: string): Promise<MdInsight[]> =>
    parseMdInsights(await get(await pageAuth(a, page), `${page}/insights`, { metric: PAGE_METRICS.join(','), period: 'day' })),
  conversations: async (a: Auth, page: string) => get(await pageAuth(a, page), `${page}/conversations`, { platform: 'messenger', fields: 'id,updated_time,participants' }),
  send: async (a: Auth, page: string, psid: string, text: string, mode: 'response' | 'human_agent') => postJson(await pageAuth(a, page), `${page}/messages`, mdMessageBody({ userId: psid }, text, mode)),
  leadForms: async (a: Auth, page: string) => get(await pageAuth(a, page), `${page}/leadgen_forms`, { fields: 'id,name,status' }),
  subscribe: async (a: Auth, page: string) => post(await pageAuth(a, page), `${page}/subscribed_apps`, { subscribed_fields: PAGE_WEBHOOK_FIELDS_MD.join(',') }),
}

/* ── the test buttons: ONE real call each ─────────────────────────────── */

export async function runTest(clientId: string, id: MdTestId): Promise<{ ok: true; summary: string; permissions: readonly string[] }> {
  const { auth, picked } = await authFor(clientId)
  const needs = testNeeds(id)
  const target = needs ? pickedOf(picked, needs) : null
  let json: unknown
  switch (id) {
    case 'ig_profile': json = await igApi.profile(auth, target!); break
    case 'ig_media': json = await igApi.media(auth, target!); break
    case 'ig_insights': json = { data: await igApi.accountInsights(auth, target!) }; break
    case 'ig_comments': {
      const media = await igApi.media(auth, target!, 1)
      const first = Array.isArray(media?.data) ? media.data[0]?.id : null
      if (!first) throw new MdAppError('That Instagram account has no posts to read comments from', 409)
      json = await igApi.comments(auth, String(first)); break
    }
    case 'ig_conversations': json = await igApi.conversations(auth, target!); break
    case 'ig_publish_limit': json = await igApi.publishLimit(auth, target!); break
    case 'ig_subscribe': json = await igApi.subscribe(auth, target!); break
    case 'pages': json = await get(auth, 'me/accounts', { fields: 'id,name' }); break
    case 'page_posts': json = await pageApi.posts(auth, target!); break
    case 'page_insights': json = { data: await pageApi.insights(auth, target!) }; break
    case 'page_conversations': json = await pageApi.conversations(auth, target!); break
    case 'page_subscribe': json = await pageApi.subscribe(auth, target!); break
    case 'page_leadforms': json = await pageApi.leadForms(auth, target!); break
    case 'ad_accounts': json = await get(auth, 'me/adaccounts', { fields: 'id,name' }); break
  }
  return { ok: true, summary: summariseTestResult(json), permissions: MD_TESTS[id].permissions }
}

/* ── publishing: never twice ──────────────────────────────────────────── */

const publishes = () => table<MdAppPublish>('md_app_publishes')

async function waitReady(a: Auth, containerId: string, tries = 20, delayMs = 15_000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const s = containerState((await get(a, containerId, { fields: 'status_code' }))?.status_code)
    if (s === 'ready') return
    if (s === 'failed') throw new MdAppError('Instagram could not process that media', 400)
    await new Promise(r => setTimeout(r, delayMs))
  }
  throw new MdAppError('Instagram is still processing the media — try again in a few minutes', 503)
}

export type MdPublishOutcome = { kind: 'published'; postId: string } | { kind: 'refused'; message: string } | { kind: 'unknown'; message: string }

/**
 * Publish ONCE for a client on the MD App road. The row id is the caller's key, so a repeat finds the row. The
 * `sending_at` mark is CLAIMED onto the row before the one publishing call (meta-fb-publish's rule): a retry
 * that finds the mark and no post id never posts again — a person checks the account instead.
 */
export async function mdPublish(input: { id: string; clientId: string; request: MdPublishRequest; accountId?: string; now: number; pollDelayMs?: number }): Promise<MdPublishOutcome> {
  const bad = validateMdPublish(input.request)
  if (bad) return { kind: 'refused', message: bad }
  const { auth, picked } = await authFor(input.clientId)
  const network = input.request.network
  const accountId = pickedOf(picked, network === 'instagram' ? 'instagram' : 'page', input.accountId)
  const nowIso = new Date(input.now).toISOString()
  // the row exists (claimed once, never overwritten)
  await publishes().claim(input.id, cur => cur ?? {
    id: input.id, client_id: input.clientId, network, account_id: accountId, request: input.request,
    container_id: null, sending_at: null, post_id: null, published_at: null, error: null, created_at: nowIso,
  })
  const row = await publishes().get(input.id, { fresh: true })
  if (!row || row.client_id !== input.clientId) return { kind: 'refused', message: 'That publish belongs to another client' }
  const decision = mdResumeDecision(row)
  if (decision === 'done') return { kind: 'published', postId: row.post_id! }
  if (decision === 'unknown') return { kind: 'unknown', message: 'An earlier try was cut off while posting, so it is not sent again — check the account; if the post is not there, book it again.' }

  // build everything that is invisible until published (containers / unpublished photos) BEFORE the mark
  let finalCall: () => Promise<string>
  if (input.request.network === 'instagram') {
    const r = input.request.req
    const pa = auth
    let containerId: string
    if (r.kind === 'CAROUSEL') {
      const kids: string[] = []
      for (const item of r.items as PublishItem[]) {
        const kid = String((await post(pa, `${accountId}/media`, carouselItemParams(item))).id)
        if (item.type === 'video') await waitReady(pa, kid, 20, input.pollDelayMs ?? 15_000)
        kids.push(kid)
      }
      containerId = String((await post(pa, `${accountId}/media`, carouselParentParams(kids, r.caption))).id)
    } else {
      containerId = String((await post(pa, `${accountId}/media`, containerParams(r))).id)
    }
    await waitReady(pa, containerId, 20, input.pollDelayMs ?? 15_000)
    await publishes().update(input.id, { container_id: containerId })
    finalCall = async () => String((await post(pa, `${accountId}/media_publish`, { creation_id: containerId })).id)
  } else {
    const r = input.request.req
    const pa = await pageAuth(auth, accountId)
    if (r.kind === 'PHOTOS') {
      const ids: string[] = []
      for (const url of r.urls) ids.push(String((await post(pa, `${accountId}/photos`, fbUnpublishedPhotoParams(url))).id))
      finalCall = async () => publishedPostId(await post(pa, `${accountId}/feed`, fbMultiPhotoParams(ids, r.message))) ?? ''
    } else {
      const c = fbPublishCall(accountId, r)
      finalCall = async () => publishedPostId(await post(pa, c.path, c.params)) ?? ''
    }
  }

  // THE MARK, by claim: exactly one sender gets past this line
  const mark = await publishes().claim(input.id, cur => (cur && !cur.sending_at && !cur.post_id ? { ...cur, sending_at: new Date().toISOString() } : null))
  if (!mark.claimed) return { kind: 'unknown', message: 'Another send of this post is already under way — check the account before trying again.' }
  try {
    const postId = await finalCall()
    await publishes().update(input.id, { post_id: postId || 'unknown', published_at: new Date().toISOString(), error: null })
    return { kind: 'published', postId }
  } catch (e) {
    const err = e instanceof MdAppError ? e : new MdAppError(e instanceof Error ? e.message : String(e))
    // Meta ANSWERED with a refusal: nothing was posted, so the mark comes off; a network loss keeps it
    if (err.status !== undefined && err.status < 500) await publishes().update(input.id, { sending_at: null, error: err.message.slice(0, 300) }).catch(() => {})
    else await publishes().update(input.id, { error: err.message.slice(0, 300) }).catch(() => {})
    return err.status !== undefined && err.status < 500 ? { kind: 'refused', message: err.message } : { kind: 'unknown', message: `${err.message} — it may or may not have posted; check the account.` }
  }
}


/* ── webhook: store, never act ────────────────────────────────────────── */

export async function recordMdAppWebhook(body: unknown, now: number): Promise<{ stored: number }> {
  const events = parseMdWebhook(body)
  const receivedAt = new Date(now).toISOString()
  const owners = new Map<string, string | null>()
  let stored = 0
  for (const ev of events) {
    if (!owners.has(ev.accountId)) {
      const kind: AssetKind = ev.object === 'instagram' ? 'instagram' : 'page'
      const rows = await assets().list({ by: { asset_id: ev.accountId } }).catch(() => [] as MdAppAsset[])
      owners.set(ev.accountId, rows.find(r => r.kind === kind && r.picked)?.client_id ?? null)
    }
    const res = await table<MdAppEvent>('md_app_events').claim(ev.key, cur => cur ? null : {
      id: ev.key, object: ev.object, account_id: ev.accountId, client_id: owners.get(ev.accountId) ?? null,
      field: ev.field, payload: ev.payload, occurred_at: ev.occurredAt, received_at: receivedAt,
    })
    if (res.claimed) stored++
  }
  return { stored }
}
