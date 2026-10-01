import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DrivePull } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { filesOf, pullInFlight } from './drive-pull-core'
import { readDriveTarget, startPull, type DriveTargetFile } from './drive-pull'
import {
  NOT_SHARED_WORDS, driveHandInsOf, driveLinkTarget, handInPullId, handInRefusal, mergeDriveHandIn, pendingHandIn,
  sanitiseMap, sanitisePicked, settledHandIn, withHandIn, type DriveHandIn, type MergeResult,
} from './drive-handin-core'
import { LOOKING_STATUSES, finalFilesChangeRefusal, finalFilesOf, needsAdoption } from './final-files-core'
import { handInRound, versionLabel } from './edit-round-core'
import { logActivity } from './workflow'
import { kindOf, type FileKind } from './files-core'

/** what a whole-link hand-in takes: what an upload takes (image/*, video/*, PDF) */
const HANDIN_KINDS: FileKind[] = ['video', 'image', 'pdf']
import { announceItemChange } from './production-live'

/**
 * A VERSION HANDED IN FROM GOOGLE DRIVE — the server half (drive-handin-core.ts has the rules and the why).
 *
 *   list   — what the pasted link holds, read from Drive (read only), for the editor to pick and order;
 *   start  — the hand-in recorded on the card and the background copy queued: the existing `drive-pull-folder`
 *            Inngest job (event `drive/pull.folder`), so no new function and no re-sync (CLAUDE.md trap 5b);
 *   settle — called by that job's last step (drive-pull.finishPull): every picked file copied → the files go on
 *            the card inside one claim; any not copied → nothing goes on, and the card says which.
 *
 * Drive is only read: its listing and each file's bytes. Nothing in Drive is created, moved, renamed, shared or
 * deleted (trap 13) — the copies land in our own storage (R2), exactly where an upload lands.
 */

export type HandInListing = { ok: true; kind: 'folder' | 'file'; id: string; url: string; files: DriveTargetFile[] } | { ok: false; status: number; error: string }

/** what a Drive link holds, for the picker */
export async function listDriveHandIn(rawUrl: unknown): Promise<HandInListing> {
  const target = driveLinkTarget(rawUrl)
  if (!target.ok) return { ok: false, status: 400, error: target.error }
  let kind = target.kind
  let files = await readDriveTarget(kind, target.id, { cuts: true })
  // an open?id= link names a folder as often as a file: a file Drive would not describe is asked for as a folder
  if (files.length === 0 && kind === 'file') {
    const asFolder = await readDriveTarget('folder', target.id, { cuts: true })
    if (asFolder.length > 0) { kind = 'folder'; files = asFolder }
  }
  if (files.length === 0) return { ok: false, status: 422, error: NOT_SHARED_WORDS }
  return { ok: true, kind, id: target.id, url: target.url, files }
}

export type StartResult = { ok: true; handIn: DriveHandIn; round: number } | { ok: false; status: number; error: string }

/** record the hand-in on the card and queue the copy of the picked files */
export async function startDriveHandIn(user: TeamUser, item: ContentItem, body: { url?: unknown; ids?: unknown; map?: unknown }): Promise<StartResult> {
  const manager = user.role === 'account_manager' || user.role === 'super_admin'
  const refusal = handInRefusal(item as never, manager)
  if (refusal) return { ok: false, status: 409, error: refusal }
  const listing = await listDriveHandIn(body.url)
  if (!listing.ok) return listing
  // THE WHOLE LINK IS THE VERSION (the owner, 30 Sep 2026: "they just need to know they need to submit the Drive link
  // again and all will become Version 2"): no ids sent → every picture, clip and PDF in it, in Drive's order, matched
  // to the card's pieces by Drive id then name when the copy lands. Ids sent (the older picker) still work.
  const whole = !Array.isArray(body.ids)
  const media = listing.files.filter(f => HANDIN_KINDS.includes(kindOf(f.mime, f.name)))
  if (whole && media.length === 0) return { ok: false, status: 422, error: 'There are no pictures, clips or PDFs in that Drive link' }
  const picked = sanitisePicked(whole ? media.map(f => f.id) : body.ids, listing.files)
  if (!picked.ok) return { ok: false, status: 400, error: picked.error }
  const map = whole ? {} : sanitiseMap(body.map, picked.ids, item as never)
  const pull = handInPullId(listing.id, item.id)
  const now = new Date().toISOString()
  // one at a time on a card: a hand-in still copying is waited for, not raced
  const pending = pendingHandIn(item as never)
  if (pending) {
    const row = await table<DrivePull>('drive_pulls').get(pending.pull_id).catch(() => null)
    if (row && pullInFlight(row as never)) return { ok: false, status: 409, error: 'A hand-in from Drive is still copying on this card — wait for it to finish' }
  }
  const round = handInRound(item as never)
  const names = Object.fromEntries(listing.files.filter(f => picked.ids.includes(f.id)).map(f => [f.id, f.name]))
  const handIn: DriveHandIn = {
    id: `${pull}#${now}`, pull_id: pull, link: listing.url, drive_ids: picked.ids, names, map, round, ...(whole ? { whole: true } : {}),
    by: user.id, manager, requested_at: now, status: 'copying',
  }
  const items = table<ContentItem>('content_items')
  const put = await items.claim(item.id, cur => {
    if (!cur) return null
    // the card moved on since it was loaded (approved, with the client): refused inside the write too
    if (handInRefusal(cur as never, manager)) return null
    // a hand-in left 'copying' whose copy is not running any more is superseded by this one
    const list = driveHandInsOf(cur as never).map(h => (h.status === 'copying' ? { ...h, status: 'failed' as const, error: 'Replaced by a newer hand-in from Drive', settled_at: now } : h))
    return { ...cur, drive_handins: withHandIn(list, handIn), updated_at: now } as unknown as ContentItem
  })
  if (!put.claimed) return { ok: false, status: 409, error: 'This card was just changed — refresh and try again' }
  const started = await startPull({
    kind: 'item', scopeId: item.id, folderUrl: listing.url, version: round, by: user.id, purpose: 'handin',
    handIn: { pullId: pull, onlyIds: picked.ids, handInId: handIn.id },
  })
  if (!started.started) {
    await markHandIn(item.id, handIn.id, { status: 'failed', error: started.reason ?? 'The copy from Drive could not be started', settled_at: new Date().toISOString() })
    return { ok: false, status: 409, error: started.reason === 'Already being pulled' ? 'That Drive link is still being copied onto this card — wait for it to finish' : (started.reason ?? 'The copy from Drive could not be started') }
  }
  await logActivity({
    actor: user, clientId: item.client_id, entityType: 'content_item', entityId: item.id,
    action: 'drive_handin_started', newValue: `v${round}`,
    detail: `Handing in ${picked.ids.length} ${picked.ids.length === 1 ? 'file' : 'files'} from Google Drive as ${versionLabel(item as never, round)} — copying`,
  })
  announceItemChange({ item_id: item.id, client_id: item.client_id, status: item.status, kind: 'updated' })
  return { ok: true, handIn, round }
}

async function markHandIn(itemId: string, handInId: string, patch: Partial<DriveHandIn>): Promise<void> {
  await table<ContentItem>('content_items').claim(itemId, cur => {
    if (!cur) return null
    const list = driveHandInsOf(cur as never)
    const h = list.find(x => x.id === handInId)
    if (!h) return null
    return { ...cur, drive_handins: withHandIn(list, { ...h, ...patch }), updated_at: new Date().toISOString() } as unknown as ContentItem
  }).catch(() => undefined)
}

/** THE COPY COULD NOT EVEN BEGIN (the link unreadable, the listing failed): the hand-in on the card says so, so it
 *  never sits at "copying" for ever */
export async function failDriveHandIn(pullId: string, error: string): Promise<void> {
  const row = await table<DrivePull>('drive_pulls').get(pullId).catch(() => null)
  const handInId = String((row as { handin_id?: unknown } | null)?.handin_id ?? '')
  if (!row || !handInId || row.kind !== 'item') return
  await markHandIn(row.scope_id, handInId, { status: 'failed', error: error.slice(0, 500), settled_at: new Date().toISOString() })
}

/**
 * THE COPY IS DONE: put the files on the card. Once — the hand-in record is 'copying' until this claim settles it,
 * so a retried job step or a second run finds it settled and writes nothing.
 */
export async function settleDriveHandIn(pullId: string): Promise<{ settled: boolean; result?: MergeResult; reason?: string }> {
  const row = await table<DrivePull>('drive_pulls').get(pullId)
  if (!row) return { settled: false, reason: 'no pull row' }
  const handInId = String((row as { handin_id?: unknown }).handin_id ?? '')
  if (!handInId || row.kind !== 'item') return { settled: false, reason: 'not a hand-in' }
  const items = table<ContentItem>('content_items')
  let item = await items.get(row.scope_id)
  if (!item) return { settled: false, reason: 'no card' }
  // AN OLD LINK CARD first takes its earlier Drive copies in as files (adopt-clips.ts), exactly as a send-back or
  // opening the card does — so its Version 1 is pieces this version can replace, not a lump beside them
  if (needsAdoption(item as never)) {
    try {
      const { adoptClips } = await import('./adopt-clips')
      await adoptClips(item, null)
      item = (await items.get(row.scope_id)) ?? item
    } catch (e) {
      console.error('[drive-handin] adopting the old link copies failed:', e instanceof Error ? e.message : e)
    }
  }
  const pulled = filesOf(row)
  const now = new Date().toISOString()
  let outcome: { result: MergeResult; handIn: DriveHandIn; round: number } | null = null
  const put = await items.claim(row.scope_id, cur => {
    if (!cur) return null
    const list = driveHandInsOf(cur as never)
    const h = list.find(x => x.id === handInId)
    if (!h || h.status !== 'copying') return null
    const round = handInRound(cur as never)
    const before = finalFilesOf(cur as never)
    let result = mergeDriveHandIn(before, pulled, h, cur as never, round, now)
    if (result.ok) {
      // the same server rules a save of the list follows (the audit of 25 Sep 2026)
      // a hand-in the editor made BEFORE submitting finishes landing at the quality check — the reviewer is waiting on
      // exactly these files; only the client stage stays closed to it
      const landingAtCheck = String((cur as { status?: unknown }).status ?? '') === 'quality_check'
        // …or at the client's stage when the card has NOTHING for this version yet (1 Oct 2026): the piece went
        // ahead of its files, and refusing them left the client a link with nothing on it
        || (LOOKING_STATUSES.includes(String((cur as { status?: unknown }).status ?? '')) && !before.some(f => f.version === round))
      const refused = finalFilesChangeRefusal(before, result.files, cur as never, h.manager === true || landingAtCheck)
      if (refused) result = { ok: false, error: `Nothing was handed in — ${refused}`, failed: [] }
    }
    const settled = settledHandIn(h, result, round, now)
    outcome = { result, handIn: settled, round }
    return {
      ...cur,
      ...(result.ok && result.added.length > 0 ? { final_files: result.files } : {}),
      drive_handins: withHandIn(list, settled),
      updated_at: now,
    } as unknown as ContentItem
  })
  if (!put.claimed || !outcome) return { settled: false, reason: 'already settled' }
  const done = outcome as { result: MergeResult; handIn: DriveHandIn; round: number }
  const fresh = put.row as ContentItem | null
  const by = done.handIn.by ? await table('team_users').get(done.handIn.by).catch(() => null) : null
  await logActivity({
    actor: (by as TeamUser | null) ?? null, clientId: item.client_id, entityType: 'content_item', entityId: item.id,
    action: done.result.ok ? 'drive_handin_done' : 'drive_handin_failed', newValue: `v${done.round}`,
    detail: done.result.ok
      ? `Handed in from Google Drive as ${versionLabel((fresh ?? item) as never, done.round)}: ${done.result.added.length} ${done.result.added.length === 1 ? 'file' : 'files'}${done.result.carried.length ? `, ${done.result.carried.length} unchanged` : ''}`
      : done.result.error,
  }).catch(() => undefined)
  announceItemChange({ item_id: item.id, client_id: item.client_id, status: String(fresh?.status ?? item.status), kind: 'updated' })
  return { settled: true, result: done.result }
}
