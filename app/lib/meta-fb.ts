import 'server-only'
import { DbError, table } from '@/lib/db'
import type { MetaFbEvent, MetaFbPage } from '@/lib/db-types'
import { credentialsKeyConfigured, decryptSecret, encryptSecret } from './secret-box'
import { deliveryIdOf } from './meta-ig-core'
import {
  FB_POST_METRICS, PAGE_METRICS, candidatePlan, fbInsightRange, fbReadiness, parseFbComments, parseFbInsights,
  parseFbConversations, parseFbPosts, parsePageWebhookEvents, readMetaFbEnv, messengerWindowOpen,
  type FbConversation,
  type FbComment, type FbInboxRequest, type FbInsight, type FbPost, type FbReady,
} from './meta-fb-core'
import * as fb from './meta-fb-client'

/**
 * THE AGENCY'S OWN FACEBOOK PAGE CONNECTION — MD Media's wiring (6 Nov 2026). The pure half is
 * meta-fb-core.ts, the Graph calls meta-fb-client.ts. This file ties them to `meta_fb_pages` /
 * `meta_fb_events`, encrypts the Page token (secret-box, CREDENTIALS_KEY — never logged, never returned to
 * a browser), and reads/answers a picked Page's posts, comments and numbers for a person who pressed a button.
 *
 * INERT until configured: every entry point asks metaFbReady() first (503 with the reason otherwise).
 */

export { MetaFbError } from './meta-fb-client'

export function metaFbReady(): FbReady {
  return fbReadiness(readMetaFbEnv(), credentialsKeyConfigured())
}

export type PublicFbPage = Omit<MetaFbPage, 'access_token_encrypted'>
export function publicPage(r: MetaFbPage): PublicFbPage {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { access_token_encrypted, ...rest } = r
  return rest
}

const pages = () => table<MetaFbPage>('meta_fb_pages')

/**
 * Code → the person's Pages → one row per Page for this client: new ones as CANDIDATES (active false), the
 * client's already-picked Page with a fresh token, and a Page that is another client's picked Page left alone.
 * Each row is written with a claim, so two connects at once cannot tangle a row.
 */
export async function connectPages(
  ready: FbReady & { ok: true },
  input: { code: string; clientId: string; userId: string; now: number },
): Promise<{ offered: number; kept: number; taken: number; autoPicked: string | null }> {
  const { pages: grants } = await fb.completeFbLogin(ready.env, input.code)
  const existing = new Map((await Promise.all(grants.map(g => pages().get(g.id, { fresh: true }).catch(() => null))))
    .filter((r): r is MetaFbPage => !!r).map(r => [r.id, { id: r.id, client_id: r.client_id, active: r.active === true }]))
  const plan = candidatePlan(input.clientId, grants, existing)
  const nowIso = new Date(input.now).toISOString()
  let offered = 0; let kept = 0
  for (const g of grants) {
    if (plan.taken.includes(g.id)) continue
    const res = await pages().claim(g.id, cur => {
      // someone else's picked Page landed in between: leave it
      if (cur && cur.active && cur.client_id !== input.clientId) return null
      return {
        id: g.id, client_id: input.clientId, page_id: g.id, name: g.name, category: g.category, picture: g.picture,
        access_token_encrypted: encryptSecret(g.accessToken), tasks: g.tasks, connected_by: input.userId,
        connected_at: cur?.connected_at ?? nowIso, active: cur?.active === true && cur.client_id === input.clientId,
        last_error: null,
      }
    })
    if (res.claimed) { if (res.row.active) kept++; else offered++ }
  }
  // one Page offered and nothing picked yet: that is the client's Page — the person still sees it and can disconnect
  let autoPicked: string | null = null
  const rows = await pages().list({ by: { client_id: input.clientId }, fresh: true })
  if (!rows.some(r => r.active) && rows.length === 1) {
    const picked = await pickPage(input.clientId, rows[0].id).catch(() => null)
    autoPicked = picked ? picked.id : null
  }
  return { offered, kept, taken: plan.taken.length, autoPicked }
}

export async function listClientPages(clientId: string): Promise<PublicFbPage[]> {
  const rows = await pages().list({ by: { client_id: clientId }, fresh: true })
  return rows.map(publicPage).sort((a, b) => Number(b.active) - Number(a.active) || (a.name ?? '').localeCompare(b.name ?? ''))
}

/** The person picks THE Page of this client: it becomes active, the other candidates are removed, and it is subscribed to the webhook. */
export async function pickPage(clientId: string, pageId: string): Promise<PublicFbPage> {
  const res = await pages().claim(pageId, cur => (cur && cur.client_id === clientId ? { ...cur, active: true } : null))
  if (!res.claimed) throw new fb.MetaFbError('That Page is not one offered for this client — connect again')
  for (const r of await pages().list({ by: { client_id: clientId }, fresh: true })) {
    if (r.id === pageId) continue
    // only this client's unpicked candidates (read fresh; lib/db has no conditional delete — a candidate row
    // holds nothing but an unused token, so the narrow window is harmless)
    const fresh = await pages().get(r.id, { fresh: true }).catch(() => null)
    // (a previously picked Page of this client goes too: a client has ONE Page on this road)
    if (fresh && fresh.client_id === clientId) await pages().remove(r.id).catch(() => undefined)
  }
  await subscribePageWebhooks(pageId).catch(() => { /* written on the row */ })
  return publicPage((await pages().get(pageId, { fresh: true })) ?? res.row)
}

/** Disconnect: the row is removed (its token with it). Meta-side removal is the person's, in Facebook's Business Integrations. */
export async function disconnectPage(clientId: string, pageId: string): Promise<boolean> {
  const row = await pages().get(pageId, { fresh: true })
  if (!row || row.client_id !== clientId) return false
  await pages().remove(pageId)
  return true
}

export type PageAuth = { pageId: string; name: string | null; auth: fb.FbAuth }

/** The client's picked Page with its decrypted token — server side only. */
export async function activePageFor(clientId: string): Promise<{ ok: true; page: PageAuth } | { ok: false; reason: string }> {
  const ready = metaFbReady()
  if (!ready.ok) return { ok: false, reason: ready.reason }
  const rows = await pages().list({ by: { client_id: clientId }, fresh: true })
  const row = rows.find(r => r.active === true)
  if (!row) return { ok: false, reason: rows.length ? 'Pick which Facebook Page belongs to this client first.' : 'This client has no Facebook Page connected directly. Connect it first.' }
  return { ok: true, page: { pageId: row.id, name: row.name ?? null, auth: { token: decryptSecret(row.access_token_encrypted), appSecret: ready.env.appSecret } } }
}

export async function pageAuthById(pageId: string): Promise<PageAuth> {
  const ready = metaFbReady()
  if (!ready.ok) throw new fb.MetaFbError(ready.reason)
  const row = await pages().get(pageId, { fresh: true })
  if (!row || row.active !== true) throw new fb.MetaFbError('That Facebook Page is not connected directly any more')
  return { pageId: row.id, name: row.name ?? null, auth: { token: decryptSecret(row.access_token_encrypted), appSecret: ready.env.appSecret } }
}

export async function subscribePageWebhooks(pageId: string): Promise<{ success: boolean }> {
  try {
    const p = await pageAuthById(pageId)
    const out = await fb.subscribePage(p.auth, pageId)
    await pages().update(pageId, { last_error: out.success ? null : 'Facebook did not confirm the webhook subscription' } as never)
    return out
  } catch (e) {
    await pages().update(pageId, { last_error: (e instanceof Error ? e.message : 'The webhook subscription failed').slice(0, 300) } as never).catch(() => {})
    throw e
  }
}

/* ── the inbox: a person reading and answering ────────────────────────── */

export async function fbPostsFor(p: PageAuth): Promise<FbPost[]> {
  return parseFbPosts(await fb.listPagePosts(p.auth, p.pageId))
}
export async function fbCommentsFor(p: PageAuth, postId: string): Promise<FbComment[]> {
  return parseFbComments(await fb.listPostComments(p.auth, postId), p.pageId)
}
export async function fbPostInsightsFor(p: PageAuth, postId: string): Promise<FbInsight[]> {
  return parseFbInsights(await fb.postInsights(p.auth, postId, FB_POST_METRICS), FB_POST_METRICS)
}

export type FbInsightsOut = { name: string | null; followers: number | null; link: string | null; days: number; page: FbInsight[]; pageError: string | null }

export async function fbInsightsFor(p: PageAuth, days: number, now: number): Promise<FbInsightsOut> {
  const range = fbInsightRange(days, now)
  const [profile, numbers] = await Promise.all([
    fb.pageProfile(p.auth, p.pageId),
    // a metric Meta withdrew must not hide the profile
    fb.pageInsights(p.auth, p.pageId, { metrics: PAGE_METRICS, since: range.since, until: range.until })
      .then(j => ({ rows: parseFbInsights(j, PAGE_METRICS), error: null as string | null }))
      .catch(e => ({ rows: [] as FbInsight[], error: e instanceof Error ? e.message : 'Facebook did not answer' })),
  ])
  return { ...profile, days: range.days, page: numbers.rows, pageError: numbers.error }
}

export type FbConversationOut = FbConversation & { canReply: boolean }

/** The Page's Messenger conversations; a message Meta answered as an id only is filled in (the 20 most recent). */
export async function fbConversationsFor(p: PageAuth, now: number): Promise<FbConversationOut[]> {
  const raw = await fb.listPageConversations(p.auth, p.pageId) as { data?: any[] } | null
  const convs = Array.isArray(raw?.data) ? raw.data : []
  await Promise.all(convs.slice(0, 10).map(async c => {
    const msgs: any[] = Array.isArray(c?.messages?.data) ? c.messages.data : []
    const bare = msgs.filter(m => m && m.id != null && m.from == null).slice(0, 20)
    const filled = await Promise.all(bare.map(m => fb.pageMessageDetail(p.auth, String(m.id)).catch(() => null)))
    bare.forEach((m, i) => { if (filled[i]) Object.assign(m, filled[i]) })
  }))
  return parseFbConversations({ data: convs }, p.pageId).map(c => ({ ...c, canReply: messengerWindowOpen(c.lastFromThemAt, now) }))
}

export async function fbAct(p: PageAuth, req: FbInboxRequest): Promise<{ id: string | null }> {
  switch (req.action) {
    case 'reply': return { id: (await fb.replyToFbComment(p.auth, req.commentId, req.text)).id }
    case 'hide': await fb.hideFbComment(p.auth, req.commentId, true); return { id: req.commentId }
    case 'unhide': await fb.hideFbComment(p.auth, req.commentId, false); return { id: req.commentId }
    case 'delete': await fb.deleteFbComment(p.auth, req.commentId); return { id: req.commentId }
    // inside the 24-hour window only (RESPONSE); no message tag is ever sent
    case 'message': return { id: (await fb.sendPageMessage(p.auth, p.pageId, req.recipientId, req.text)).messageId }
  }
}

/* ── the Page webhook: record, never act ──────────────────────────────── */

export async function recordPageWebhook(rawBody: string, body: unknown, now: number): Promise<{ kind: 'duplicate' } | { kind: 'recorded'; stored: number }> {
  const hash = deliveryIdOf(rawBody)
  const receivedAt = new Date(now).toISOString()
  const events = parsePageWebhookEvents(body)
  let deliveryRowId: string
  try {
    const row = await table('webhook_deliveries').insert({
      provider: 'meta_fb', event: 'page', provider_event_id: hash, provider_event_key: `meta_fb__${hash}`,
      received_at: receivedAt, handled: false, note: null,
    })
    deliveryRowId = row.id
  } catch (e) {
    if (e instanceof DbError && e.code === 'unique') return { kind: 'duplicate' }
    throw e
  }
  try {
    const owners = new Map<string, string | null>()
    let stored = 0
    for (const ev of events) {
      if (!owners.has(ev.pageId)) owners.set(ev.pageId, (await pages().get(ev.pageId))?.client_id ?? null)
      const res = await table<MetaFbEvent>('meta_fb_events').claim(ev.key, cur => cur ? null : {
        id: ev.key, page_id: ev.pageId, client_id: owners.get(ev.pageId) ?? null, kind: ev.kind, item: ev.item,
        payload: ev.payload, occurred_at: ev.occurredAt, received_at: receivedAt, delivery_id: deliveryRowId,
      })
      if (res.claimed) stored++
    }
    await table('webhook_deliveries').update(deliveryRowId, {
      handled: stored > 0, note: events.length ? `stored ${stored} of ${events.length} event(s)` : 'nothing stored (field not kept)',
    }).catch(() => undefined)
    return { kind: 'recorded', stored }
  } catch (e) {
    await table('webhook_deliveries').remove(deliveryRowId).catch(() => undefined)
    throw e
  }
}
