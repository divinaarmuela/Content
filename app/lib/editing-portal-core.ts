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
import { finishedEditOf, driveTargetOf } from './card-link-core'
import { isClientFacing } from './portal-core'
import { kindOf, type DriveEntry } from './files-core'
import type { ItemStatus } from './workflow-core'

/** the client's page for one editing card */
export function editingPortalPath(token: string, itemId: string): string {
  return `/portal/${encodeURIComponent(token)}/edit/${encodeURIComponent(itemId)}`
}

/** A card the editing portal is for: a piece of editing (not an uploaded
 *  post) that the client may see, whose finished edit is a Drive folder —
 *  or one Drive file (16 Sep 2026). */
export function editingPortalFolder(card: {
  status?: string | null; adhoc_post?: boolean | null
  link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null; link_final?: boolean | null
}): { url: string; folderId: string; kind: 'folder' | 'file' } | null {
  if (card.adhoc_post === true) return null
  if (!portalOpenFor(card)) return null
  const finished = finishedEditOf(card)
  if (!finished) return null
  const target = driveTargetOf(finished.url)
  return target ? { url: finished.url, folderId: target.id, kind: target.kind } : null
}

export type PortalClip = {
  id: string
  name: string
  /** a public picture of the clip, when Drive shows one to the link; else null */
  thumb: string | null
  /** a picture handed in as a file is shown, not played (17 Sep 2026) */
  kind?: 'video' | 'image'
}

/** DOES THE PORTAL HAVE WORK TO SHOW? A finished Drive link, or files uploaded
 *  onto the card (the Designer page, 17 Sep 2026) — at a client-facing stage */
export function portalHasWork(card: Parameters<typeof editingPortalFolder>[0] & { final_files?: unknown }): boolean {
  if (editingPortalFolder(card)) return true
  if (card.adhoc_post === true) return false
  if (!portalOpenFor(card)) return false
  return Array.isArray(card.final_files) && card.final_files.length > 0
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

/* ── ONE LINK PER CARD, OPEN THE WHOLE WAY (22 Sep 2026) ───────────────────
 * The owner: "one portal link of the card and the comments will be there …
 * the old version with their comments and the new version near it." The link
 * used to open only while the card was at a client-facing stage, so sending a
 * card back for changes turned the client's link into "not found" while they
 * were still giving feedback (The Glass Den's First Shoot, 21 Sep 2026).
 *
 *   OPEN   once the card has been given to the client (delivered_at), the
 *          link works at every stage after — also while it is being revised.
 *   SHOWS  never more than the client was given: the version stamped when the
 *          card last went to With client (client_round). A newer version
 *          still with the team, or at the quality check, is not theirs yet.
 *   ACTS   the client may always comment; they approve only while the card
 *          is actually with them.
 */
export function portalOpenFor(card: { status?: string | null; delivered_at?: string | null }): boolean {
  return isClientFacing(String(card.status ?? '') as ItemStatus) || !!card.delivered_at
}

export function clientMayApprove(card: { status?: string | null }): boolean {
  return isClientFacing(String(card.status ?? '') as ItemStatus)
}

/** the newest version the link may show. An older card has no stamp: what it is on now if it is with the
 *  client, else the round it was on when it was sent back. */
export function clientSeenRound(card: { client_round?: unknown; edit_round?: unknown }): number {
  const stamped = Number(card.client_round)
  if (Number.isFinite(stamped) && stamped >= 1) return Math.floor(stamped)
  const n = Number(card.edit_round)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

export type VersionedClip = { id: string; version: number; asset_id?: string | null; carries?: boolean }

/**
 * THE CARD AS IT STOOD AT A VERSION. Uploaded files are assets that CARRY FORWARD: Version 2 of the card is
 * every asset's newest file up to 2 — the two that were fine as they were, and the one that was replaced.
 * A Drive-link round has no assets (a folder is one lump), so its clips belong to their own version only.
 */
export function clipsAtRound<T extends VersionedClip>(clips: readonly T[], round: number): T[] {
  const newest = new Map<string, T>()
  const out: T[] = []
  for (const c of clips) {
    if (c.version > round) continue
    if (!c.carries) { if (c.version === round) out.push(c); continue }
    const a = c.asset_id || c.id, have = newest.get(a)
    if (!have || c.version > have.version) newest.set(a, c)
  }
  const order = [...new Set(clips.filter(c => c.carries).map(c => c.asset_id || c.id))]
  return [...out, ...order.map(a => newest.get(a)).filter((c): c is T => !!c)]
}

/** one asset's versions the client may see, newest first — the tabs beside a replaced clip */
export function assetLine<T extends VersionedClip>(clips: readonly T[], clip: T): T[] {
  if (!clip.carries) return [clip]
  const a = clip.asset_id || clip.id
  return clips.filter(c => c.carries && (c.asset_id || c.id) === a).sort((x, y) => y.version - x.version)
}
