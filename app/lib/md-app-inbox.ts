import 'server-only'
import { MdAppError, authFor, mdGraph } from './md-app'
import { table } from '@/lib/db'
import type { MdAppHiddenComment } from '@/lib/db-types'
import {
  parseIgComments, parseIgPosts, parsePageComments, parsePagePosts, parseThreads, withProfile,
  type InboxComment, type InboxPost, type InboxThread,
} from './md-app-inbox-core'

/**
 * MD APP INBOX — the I/O half (9 Nov 2026). Pure shapes: md-app-inbox-core.ts. Every call uses the client's own
 * connection (authFor) and the accounts ticked for the client, so nothing outside the client's Page and Instagram
 * account can be read or changed. No token is logged or returned.
 */

const { get, post, postJson, del, pageAuth, pickedOf } = mdGraph
const MSG_FIELDS = 'id,updated_time,participants,messages.limit(25){id,created_time,from,to,message}'

async function ctx(clientId: string) {
  const { auth, picked } = await authFor(clientId)
  const ig = picked.some(r => r.kind === 'instagram') ? pickedOf(picked, 'instagram') : null
  const page = picked.some(r => r.kind === 'page') ? pickedOf(picked, 'page') : null
  return { auth, ig, page }
}
/**
 * Instagram calls go out with the LINKED PAGE's token when there is one (10 Nov 2026, live: replying to an Instagram
 * comment with the user token failed "A Page access token is required for this call for the new Pages experience").
 * The DMs already did this (9 Nov). No Page ticked → the user token, as before.
 */
async function igAuth(auth: Awaited<ReturnType<typeof authFor>>['auth'], page: string | null) {
  if (!page) return auth
  try { return await pageAuth(auth, page) } catch { return auth }
}
const need = <T>(v: T | null, what: string): T => { if (!v) throw new MdAppError(`Tick this client's ${what} first.`, 409); return v }

/** Both platforms' recent posts with their comment counts — the left column of the Comments view. */
export async function inboxPosts(clientId: string): Promise<{ instagram: InboxPost[]; facebook: InboxPost[]; igUsername: string | null; pageName: string | null }> {
  const { auth, ig, page } = await ctx(clientId)
  const ia = ig ? await igAuth(auth, page) : auth
  const [igMedia, igMe, pa] = await Promise.all([
    ig ? get(ia, `${ig}/media`, { fields: 'id,caption,timestamp,permalink,comments_count,media_type,media_url,thumbnail_url', limit: 12 }) : null,
    ig ? get(ia, ig, { fields: 'username' }).catch(() => null) : null,
    page ? pageAuth(auth, page) : null,
  ])
  const [feed, pageMe] = pa && page ? await Promise.all([
    get(pa, `${page}/posts`, { fields: 'id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0)', limit: 12 }),
    get(pa, page, { fields: 'name' }).catch(() => null),
  ]) : [null, null]
  return {
    instagram: igMedia ? parseIgPosts(igMedia) : [], facebook: feed ? parsePagePosts(feed) : [],
    igUsername: typeof igMe?.username === 'string' ? igMe.username : null, pageName: typeof pageMe?.name === 'string' ? pageMe.name : null,
  }
}

export async function inboxComments(clientId: string, platform: 'instagram' | 'facebook', postId: string): Promise<InboxComment[]> {
  const { auth, ig, page } = await ctx(clientId)
  if (platform === 'instagram') {
    const id = need(ig, 'Instagram account')
    const ia = await igAuth(auth, page)
    const [json, me] = await Promise.all([
      get(ia, `${postId}/comments`, { fields: 'id,text,username,timestamp,hidden,from{id,username},replies{id,text,username,timestamp}', limit: 50 }),
      get(ia, id, { fields: 'username' }).catch(() => null),
    ])
    const got = parseIgComments(json, typeof me?.username === 'string' ? me.username : null)
    // the ones hidden from here: Instagram no longer lists them, we still do — marked Hidden, with Show
    const kept = await table<MdAppHiddenComment>('md_app_hidden_comments').list({ by: { client_id: clientId, post_id: postId }, fresh: true }).catch(() => [])
    const extra = kept.map(k => k.comment as InboxComment).filter(c => c && typeof c.id === 'string' && !got.some(g => g.id === c.id)).map(c => ({ ...c, hidden: true }))
    return [...got, ...extra]
  }
  const pid = need(page, 'Facebook Page')
  const pa = await pageAuth(auth, pid)
  // from{picture}: the commenter's name and picture — Business Asset User Profile Access
  const json = await get(pa, `${postId}/comments`, { fields: 'id,message,created_time,is_hidden,from{id,name,picture},comments{id,message,created_time,from{id,name}}', filter: 'toplevel', limit: 50 })
  return parsePageComments(json, pid)
}

export async function commentAction(clientId: string, platform: 'instagram' | 'facebook', action: 'reply' | 'hide' | 'unhide' | 'delete', commentId: string, text?: string): Promise<void> {
  const { auth, ig, page } = await ctx(clientId)
  if (platform === 'instagram') {
    need(ig, 'Instagram account')
    const ia = await igAuth(auth, page)
    const keep = table<MdAppHiddenComment>('md_app_hidden_comments')
    const keyId = `${clientId}__${commentId}`
    if (action === 'reply') await post(ia, `${commentId}/replies`, { message: text! })
    else if (action === 'delete') { await del(ia, commentId); await keep.remove(keyId).catch(() => {}) }
    else if (action === 'hide') {
      // copy it BEFORE hiding: afterwards Instagram stops listing it
      const raw = await get(ia, commentId, { fields: 'id,text,username,timestamp,hidden,from{id,username},media{id},replies{id,text,username,timestamp}' })
      await post(ia, commentId, { hide: 'true' })
      const postId = typeof raw?.media?.id === 'string' ? raw.media.id : null
      const [c] = parseIgComments({ data: [raw] }, null)
      if (postId && c) await keep.claim(keyId, () => ({ id: keyId, client_id: clientId, post_id: postId, comment: { ...c, hidden: true }, hidden_at: new Date().toISOString() }))
    } else { await post(ia, commentId, { hide: 'false' }); await keep.remove(keyId).catch(() => {}) }
    return
  }
  const pa = await pageAuth(auth, need(page, 'Facebook Page'))
  if (action === 'reply') await post(pa, `${commentId}/comments`, { message: text! })
  else if (action === 'delete') await del(pa, commentId)
  else await post(pa, commentId, { is_hidden: String(action === 'hide') })
}

/** Instagram DMs and Messenger conversations, each with the person's name and picture. */
export async function inboxThreads(clientId: string, platform: 'instagram' | 'facebook'): Promise<InboxThread[]> {
  const { auth, ig, page } = await ctx(clientId)
  if (platform === 'instagram') {
    // Instagram DMs with Facebook Login are read on the LINKED PAGE with the Page token (9 Nov 2026: the same call on
    // the Instagram account with the user token answered an empty list, not an error)
    const id = need(ig, 'Instagram account')
    const pid = need(page, 'Facebook Page (the one linked to the Instagram account)')
    const pa = await pageAuth(auth, pid)
    const threads = parseThreads(await get(pa, `${pid}/conversations`, { platform: 'instagram', fields: MSG_FIELDS, limit: 20 }), id)
    return Promise.all(threads.map(async t => t.withId
      ? withProfile(t, await get(pa, t.withId, { fields: 'name,username,profile_pic' }).catch(() => null)) : t))
  }
  const pid = need(page, 'Facebook Page')
  const pa = await pageAuth(auth, pid)
  const threads = parseThreads(await get(pa, `${pid}/conversations`, { platform: 'messenger', fields: MSG_FIELDS, limit: 20 }), pid)
  return Promise.all(threads.map(async t => t.withId
    ? withProfile(t, await get(pa, t.withId, { fields: 'name,profile_pic' }).catch(() => null)) : t))
}

/** A standard reply inside the 24-hour window (RESPONSE). No message tags: those are not for this. */
export async function sendMessage(clientId: string, platform: 'instagram' | 'facebook', to: string, text: string): Promise<void> {
  const { auth, ig, page } = await ctx(clientId)
  const body = { recipient: { id: to }, message: { text }, messaging_type: 'RESPONSE' }
  // Instagram replies go out from the linked Page with the Page token too (the recipient is the Instagram-scoped id)
  if (platform === 'instagram') { need(ig, 'Instagram account'); const pid = need(page, 'Facebook Page'); await postJson(await pageAuth(auth, pid), `${pid}/messages`, body); return }
  const pid = need(page, 'Facebook Page')
  await postJson(await pageAuth(auth, pid), `${pid}/messages`, body)
}
