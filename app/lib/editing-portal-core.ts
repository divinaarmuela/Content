/**
 * THE EDITING PORTAL (the owner, 16 Sep 2026: "build a portal for each
 * editing card — a new look where the videos are on the left and the
 * comment section is on the right; comments only, for the client to log
 * each video; no more 'in production' etc. — this is the editing portal").
 *
 * Pure: where the page lives, which cards get one, which files on the
 * finished edit are its clips, and the words. The server half
 * (editing-portal.ts) reads the card and lists the folder.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { finishedEditOf, driveFolderIdFromUrl } from './card-link-core'
import { isClientFacing } from './portal-core'
import { kindOf, type DriveEntry } from './files-core'
import type { ItemStatus } from './workflow-core'

/** the client's page for one editing card */
export function editingPortalPath(token: string, itemId: string): string {
  return `/portal/${encodeURIComponent(token)}/edit/${encodeURIComponent(itemId)}`
}

/** A card the editing portal is for: a piece of editing (not an uploaded
 *  post) that the client may see, whose finished edit is a Drive folder. */
export function editingPortalFolder(card: {
  status?: string | null; adhoc_post?: boolean | null
  link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null; link_final?: boolean | null
}): { url: string; folderId: string } | null {
  if (card.adhoc_post === true) return null
  if (!isClientFacing(String(card.status ?? '') as ItemStatus)) return null
  const finished = finishedEditOf(card)
  if (!finished) return null
  const folderId = driveFolderIdFromUrl(finished.url)
  return folderId ? { url: finished.url, folderId } : null
}

export type PortalClip = {
  id: string
  name: string
  /** a public picture of the clip, when Drive shows one to the link; else null */
  thumb: string | null
}

/** the clips on the finished edit: the videos, in name order, nothing else */
export function clipsOf(entries: readonly (DriveEntry & { thumbUrl?: string | null })[]): PortalClip[] {
  return entries
    .filter(e => kindOf(e.mimeType, e.name) === 'video')
    .map(e => ({ id: e.id, name: e.name, thumb: e.thumbUrl ?? null }))
}

/**
 * A SIGNED CLIP: the page hands the browser a stream address that names
 * the card and the file and carries a signature over both, so the stream
 * route can check "this file is one of this card's clips" without listing
 * the folder again on every Range request a <video> makes.
 */
export function clipSignature(secret: string, itemId: string, fileId: string): string {
  return createHmac('sha256', secret).update(`${itemId}:${fileId}`).digest('hex').slice(0, 40)
}

export function clipSignatureOk(secret: string, itemId: string, fileId: string, sig: string | null | undefined): boolean {
  const want = clipSignature(secret, itemId, fileId)
  const got = String(sig ?? '')
  if (got.length !== want.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

export function portalStreamPath(token: string, itemId: string, clip: { id: string; name: string }, sig: string): string {
  return `/api/portal/stream?` + new URLSearchParams({ token, item: itemId, id: clip.id, name: clip.name, sig }).toString()
}

/** what a client comment says in the team's notice: where on which clip */
export function clipCommentWhere(name: string | null | undefined, stamp: string | null): string {
  if (!name) return ''
  return stamp ? ` — at ${stamp} on ${name}` : ` — on ${name}`
}
