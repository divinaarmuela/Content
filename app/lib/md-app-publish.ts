import 'server-only'
import { MdAppError, authFor, mdGraph, mdPublish } from './md-app'
import { publishRowId } from './md-app-core'
import type { MdPublishRequest } from './md-app-core'

/**
 * MD APP PUBLISH TAB — the I/O half (9 Nov 2026). Publishing goes through mdPublish (the never-twice mark: a repeated
 * press with the same key is the same row, and a send cut off midway is never re-sent). Editing and deleting are
 * Facebook Page posts only — Instagram's API does not edit or delete published media — and only posts on the
 * client's own picked Page (the Page token cannot reach any other).
 */

const { get, post, del, pageAuth, pickedOf } = mdGraph

export type PublishInput = { platform: 'instagram' | 'facebook'; imageUrl: string | null; text: string; key: string }

export function publishRequestOf(p: PublishInput): MdPublishRequest | string {
  if (p.platform === 'instagram') {
    if (!p.imageUrl) return 'Instagram needs a photo.'
    return { network: 'instagram', req: { kind: 'IMAGE', imageUrl: p.imageUrl, ...(p.text ? { caption: p.text } : {}) } }
  }
  if (p.imageUrl) return { network: 'facebook', req: { kind: 'PHOTO', url: p.imageUrl, ...(p.text ? { message: p.text } : {}) } }
  if (!p.text) return 'Write something or add a photo.'
  return { network: 'facebook', req: { kind: 'TEXT', message: p.text } }
}

export async function publishNow(clientId: string, p: PublishInput): Promise<{ postId: string; link: string | null }> {
  const request = publishRequestOf(p)
  if (typeof request === 'string') throw new MdAppError(request, 409)
  const out = await mdPublish({ id: publishRowId(clientId, `tab:${p.key}`), clientId, request, now: Date.now() })
  if (out.kind !== 'published') throw new MdAppError(out.message, 409)
  // the permalink, so the person (and the screencast) can open the live post
  const { auth, picked } = await authFor(clientId)
  let link: string | null = null
  try {
    if (p.platform === 'instagram') link = String((await get(auth, out.postId, { fields: 'permalink' }))?.permalink ?? '') || null
    else link = String((await get(await pageAuth(auth, pickedOf(picked, 'page')), out.postId, { fields: 'permalink_url' }))?.permalink_url ?? '') || null
  } catch { /* the post is up; the link is a nicety */ }
  return { postId: out.postId, link }
}

async function pageCtx(clientId: string, postId: string) {
  const { auth, picked } = await authFor(clientId)
  const page = pickedOf(picked, 'page')
  // a Page post id is "<pageId>_<postId>": refuse anything that is not on this client's Page
  if (!postId.startsWith(`${page}_`)) throw new MdAppError('That post is not on this client\'s Page.', 409)
  return pageAuth(auth, page)
}

export async function editPagePost(clientId: string, postId: string, text: string): Promise<void> {
  await post(await pageCtx(clientId, postId), postId, { message: text })
}

export async function deletePagePost(clientId: string, postId: string): Promise<void> {
  await del(await pageCtx(clientId, postId), postId)
}
