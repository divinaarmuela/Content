import 'server-only'
import { table } from '@/lib/db'
import type { MetaIgAccount } from '@/lib/db-types'
import { decryptSecret } from './secret-box'
import * as ig from './meta-ig-client'
import {
  ACCOUNT_METRICS, COMMENT_FIELDS, CONVERSATION_FIELDS, MEDIA_FIELDS, POST_METRICS, PROFILE_FIELDS,
  insightRange, parseComments, parseConversations, parseInsights, parsePosts, parseProfile, replyWindowOpen,
  type IgConversation, type IgPost, type IgProfile, type IgThreadComment, type InboxRequest, type Insight,
} from './meta-ig-inbox-core'

/**
 * COMMENTS, MESSAGES AND INSIGHTS THROUGH OUR OWN META APP — MD Media's
 * wiring (5 Oct 2026). The pure half is meta-ig-inbox-core.ts; the Graph
 * calls are meta-ig-client.ts. This file finds the client's own direct
 * connection and calls Instagram with ITS token — a token reaches only its
 * own account's posts, comments and conversations, so an id belonging to
 * another account is refused by Instagram itself.
 *
 * Nothing here is called by a job, a webhook or a rule: only by
 * /api/meta/instagram/inbox, for a person who pressed a button. Zernio still
 * carries every client that has no direct connection.
 */

export type DirectAccount = { igUserId: string; username: string | null; token: string }

/** The client's ACTIVE direct connection, or the sentence that says there is none. */
export async function directAccountFor(clientId: string): Promise<{ ok: true; account: DirectAccount } | { ok: false; reason: string }> {
  const rows = await table<MetaIgAccount>('meta_ig_accounts').list({ by: { client_id: clientId }, fresh: true })
  if (rows.length === 0) return { ok: false, reason: 'This client has no Instagram connected directly. Connect it first.' }
  const row = rows.find(r => r.status === 'active')
  if (!row) return { ok: false, reason: `This client's direct Instagram connection is ${rows[0].status} — reconnect it.` }
  return { ok: true, account: { igUserId: row.id, username: row.username ?? null, token: decryptSecret(row.access_token_encrypted) } }
}

export async function postsFor(a: DirectAccount): Promise<IgPost[]> {
  return parsePosts(await ig.listMedia(a.token, a.igUserId, MEDIA_FIELDS))
}

export async function commentsFor(a: DirectAccount, mediaId: string): Promise<IgThreadComment[]> {
  return parseComments(await ig.listCommentThreads(a.token, mediaId, COMMENT_FIELDS), { userId: a.igUserId, username: a.username })
}

export type ConversationOut = IgConversation & { canReply: boolean }

/**
 * The account's conversations with their latest messages. Where Instagram
 * answers a message as an id only, its details are read one by one (it gives
 * them for the 20 most recent messages of a conversation).
 */
export async function conversationsFor(a: DirectAccount, now: number): Promise<ConversationOut[]> {
  const raw = await ig.listConversations(a.token, CONVERSATION_FIELDS) as { data?: any[] } | null
  const convs = Array.isArray(raw?.data) ? raw.data : []
  await Promise.all(convs.slice(0, 10).map(async c => {
    const msgs: any[] = Array.isArray(c?.messages?.data) ? c.messages.data : []
    const bare = msgs.filter(m => m && m.id != null && m.from == null).slice(0, 20)
    const filled = await Promise.all(bare.map(m => ig.messageDetail(a.token, String(m.id)).catch(() => null)))
    bare.forEach((m, i) => { if (filled[i]) Object.assign(m, filled[i]) })
  }))
  return parseConversations({ data: convs }, a.igUserId).map(c => ({ ...c, canReply: replyWindowOpen(c.lastFromThemAt, now) }))
}

export type InsightsOut = { profile: IgProfile; days: number; account: Insight[]; accountError: string | null }

export async function insightsFor(a: DirectAccount, days: number, now: number): Promise<InsightsOut> {
  const range = insightRange(days, now)
  const [profileJson, account] = await Promise.all([
    ig.profile(a.token, PROFILE_FIELDS),
    // the numbers failing (a young account, a metric Instagram has withdrawn) must not hide the profile
    ig.accountInsights(a.token, a.igUserId, { metrics: [...ACCOUNT_METRICS], period: 'day', metricType: 'total_value', ...range })
      .then(j => ({ rows: parseInsights(j, ACCOUNT_METRICS), error: null as string | null }))
      .catch(e => ({ rows: [] as Insight[], error: e instanceof Error ? e.message : 'Instagram did not answer' })),
  ])
  return {
    profile: parseProfile(profileJson),
    days: Math.round((range.until - range.since) / 86400),
    account: account.rows, accountError: account.error,
  }
}

export async function postInsightsFor(a: DirectAccount, mediaId: string): Promise<Insight[]> {
  return parseInsights(await ig.mediaInsights(a.token, mediaId, [...POST_METRICS]), POST_METRICS)
}

/** One thing a person asked for. Throws MetaIgError with Instagram's own sentence when it refuses. */
export async function act(a: DirectAccount, req: InboxRequest): Promise<{ id: string | null }> {
  switch (req.action) {
    case 'reply': return { id: (await ig.replyToComment(a.token, req.commentId, req.text)).id }
    case 'hide': await ig.hideComment(a.token, req.commentId, true); return { id: req.commentId }
    case 'unhide': await ig.hideComment(a.token, req.commentId, false); return { id: req.commentId }
    case 'delete': await ig.deleteComment(a.token, req.commentId); return { id: req.commentId }
    case 'private_reply': return { id: (await ig.privateReply(a.token, req.commentId, req.text)).messageId }
    // inside Instagram's 24 hours only: the HUMAN_AGENT tag is never asked for here
    case 'message': return { id: (await ig.sendMessage(a.token, req.recipientId, req.text)).messageId }
  }
}
