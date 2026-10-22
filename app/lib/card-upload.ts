import 'server-only'
import { table } from '@/lib/db'
import type { Client, ContentItem, DriveUpload, TeamUser as TeamRow } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { createSubfolder, ensureFolder, findSubfolder, listFolderNames, listSubfolders, renameFolder, rootFolderId } from './gdrive'
import { entryDetail, grantUserPermission, isInside, openUploadSession, pushUploadChunk, shareableLink, uploadStreamToFolder } from './gdrive-files'
import { isDriveId } from './files-core'
import { handInRound } from './edit-round-core'
import { startDriveHandIn } from './drive-handin'
import { assetIdOf, currentFiles, finalFilesOf, type FinalFile } from './final-files-core'
import {
  DIRECT_CHUNK, cardFilingAllowed, folderNameOf, isVersionFolderName, resumableMatch, sharingUrl, uniqueName, versionFolderName,
} from './card-upload-core'

/**
 * THE CARD'S OWN DRIVE FOLDER — the server half (card-upload-core.ts has the why and the rules).
 *
 * THE ONE PLACE THE DASHBOARD WRITES TO GOOGLE DRIVE BY DESIGN (gdrive-policy.ts, CLAUDE.md trap 13): it makes the
 * client's folder and the card's folder inside the app's own "Clients" folder, shares the card's folder view-only
 * with anyone who has the link, gives the card's editor edit access, opens upload sessions into it, and makes or
 * renames folders a person asks for inside it. Nothing else: nothing outside a card's folder is written, nothing is
 * ever moved or deleted, and V1 / V2 keep their names. Every entry point checks `cardFilingAllowed` first.
 */

export type CardFolders = { folderId: string; url: string; versionId: string; version: number }
type Fail = { ok: false; status: number; error: string }

const OFF: Fail = { ok: false, status: 403, error: 'Uploading to Drive from the card is not on for this client yet' }
const items = () => table<ContentItem>('content_items')

const versionKey = (n: number) => `v${n}`
function versionFoldersOf(item: { upload_version_folders?: unknown }): Record<string, string> {
  const raw = item.upload_version_folders
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, string> : {}
}

/** the client's folder in the app's Clients folder: recorded on the client, made once */
async function clientFolder(clientId: string): Promise<{ ok: true; id: string } | Fail> {
  const clients = table<Client>('clients')
  const client = await clients.get(clientId)
  if (!client) return { ok: false, status: 404, error: 'No such client' }
  const known = String(client.upload_folder_id ?? '').trim()
  if (known) return { ok: true, id: known }
  const root = await rootFolderId().catch(() => null)
  if (!root) return { ok: false, status: 409, error: 'Google Drive is not connected — connect it in Settings → Google' }
  const name = folderNameOf(client.name, 'Client')
  // a folder the app made earlier under this name is the client's (the app only sees what it made — drive.file)
  const found = await findSubfolder(root, name)
  const made = found.ok && found.id ? { ok: true as const, id: found.id } : await ensureFolder(root, name)
  if (!made.ok) return { ok: false, status: 502, error: made.message }
  // first writer wins; a racing second request reads the winner's folder
  const put = await clients.claim(clientId, cur => (cur && !String(cur.upload_folder_id ?? '').trim() ? { ...cur, upload_folder_id: made.id } : null))
  return { ok: true, id: put.claimed ? made.id : String(put.current?.upload_folder_id ?? made.id) }
}

/**
 * THE CARD'S FOLDER, made the first time anything is uploaded to the card: "Card title" — "(2)" when another card of
 * this client has that name — shared view-only with anyone who has the link, the card's editor given edit access.
 * One maker at a time: `upload_folder_lock` is claimed first (trap 11), and a request that loses waits for the winner.
 */
async function cardFolder(item: ContentItem): Promise<{ ok: true; id: string; url: string } | Fail> {
  const have = String(item.upload_folder_id ?? '').trim()
  if (have) return { ok: true, id: have, url: String(item.upload_folder_url ?? sharingUrl(have)) }
  const now = Date.now()
  const lock = new Date(now).toISOString()
  const took = await items().claim(item.id, cur => {
    if (!cur || String(cur.upload_folder_id ?? '').trim()) return null
    const held = Date.parse(String(cur.upload_folder_lock ?? ''))
    if (Number.isFinite(held) && now - held < 60_000) return null
    return { ...cur, upload_folder_lock: lock }
  })
  if (!took.claimed) {
    // someone else is making it — read it back for a few seconds
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const cur = await items().get(item.id)
      const id = String(cur?.upload_folder_id ?? '').trim()
      if (id) return { ok: true, id, url: String(cur?.upload_folder_url ?? sharingUrl(id)) }
    }
    return { ok: false, status: 409, error: 'The card’s Drive folder is being made — try again in a moment' }
  }
  const parent = await clientFolder(item.client_id)
  if (!parent.ok) return parent
  const taken = await listFolderNames(parent.id)
  const made = await createSubfolder(parent.id, uniqueName(folderNameOf(item.title, 'Card'), taken))
  if (!made.ok) return { ok: false, status: 502, error: made.message }
  const shared = await shareableLink(made.id)
  if (!shared.ok) console.error('[card-upload] sharing the card folder failed:', shared.message)
  const url = sharingUrl(made.id)
  await items().claim(item.id, cur => (cur ? { ...cur, upload_folder_id: made.id, upload_folder_url: url, upload_folder_lock: null } : null))
  // the card's editor works in it with their own Google account (Drive for desktop): edit access, no email
  if (item.owner_id) {
    const owner = await table<TeamRow>('team_users').get(item.owner_id).catch(() => null)
    if (owner?.email) await grantEditor(made.id, owner.email)
  }
  return { ok: true, id: made.id, url }
}

const granted = new Set<string>()
async function grantEditor(folderId: string, email: string): Promise<void> {
  const key = `${folderId}:${email.toLowerCase()}`
  if (granted.has(key)) return
  const r = await grantUserPermission(folderId, email).catch(() => null)
  if (r?.ok) granted.add(key)
  else console.error('[card-upload] edit access for', email, 'failed:', r && !r.ok ? r.message : 'no answer')
}

/** the folder this version's files go in — V1, V2 … inside the card's folder, recorded on the card */
async function versionFolder(item: ContentItem, folderId: string, round: number): Promise<{ ok: true; id: string } | Fail> {
  const known = versionFoldersOf(item)[versionKey(round)]
  if (known) return { ok: true, id: known }
  const made = await ensureFolder(folderId, versionFolderName(round))
  if (!made.ok) return { ok: false, status: 502, error: made.message }
  await items().claim(item.id, cur => {
    if (!cur) return null
    const map = versionFoldersOf(cur)
    if (map[versionKey(round)]) return null
    return { ...cur, upload_version_folders: { ...map, [versionKey(round)]: made.id } }
  })
  const fresh = await items().get(item.id)
  return { ok: true, id: versionFoldersOf(fresh ?? item)[versionKey(round)] ?? made.id }
}

/** the folders, made if missing — the first upload's job */
export async function ensureCardFolders(item: ContentItem): Promise<({ ok: true } & CardFolders) | Fail> {
  if (!cardFilingAllowed(item.client_id)) return OFF
  const folder = await cardFolder(item)
  if (!folder.ok) return folder
  const fresh = (await items().get(item.id)) ?? item
  const round = handInRound(fresh as never)
  const v = await versionFolder(fresh, folder.id, round)
  if (!v.ok) return v
  return { ok: true, folderId: folder.id, url: folder.url, versionId: v.id, version: round }
}

export type FolderNode = { id: string; name: string; fixed: boolean; children: FolderNode[] }

/** the folders inside the card's folder, two levels down — for "upload into" and New folder / Rename */
export async function cardFolderTree(item: ContentItem): Promise<FolderNode[]> {
  const id = String(item.upload_folder_id ?? '').trim()
  if (!id || !cardFilingAllowed(item.client_id)) return []
  const walk = async (parent: string, depth: number): Promise<FolderNode[]> => {
    const list = await listSubfolders(parent)
    if (!list.ok) return []
    return Promise.all(list.folders.map(async f => ({
      id: f.id, name: f.name, fixed: depth === 0 && isVersionFolderName(f.name),
      children: depth < 2 ? await walk(f.id, depth + 1) : [],
    })))
  }
  return walk(id, 0)
}

/** is this folder the version folder or inside it? Uploads land nowhere else */
async function insideVersion(folderId: string, versionId: string): Promise<boolean> {
  if (folderId === versionId) return true
  return (await isInside(folderId, versionId)) === 'inside'
}

/**
 * START (OR CARRY ON) ONE FILE. The same file picked again by the same person carries on from the byte Google has
 * (card-upload-core.resumableMatch) — a half-sent file is finished tomorrow, not sent twice. The session URI goes to
 * the browser so it can send the pieces to Google itself: it writes this one file and nothing else.
 */
export async function startCardUpload(user: TeamUser, item: ContentItem, body: { name?: unknown; size?: unknown; mime?: unknown; parent?: unknown; replaces?: unknown }, origin: string | null): Promise<
  { ok: true; upload: string; uri: string; received: number; done: boolean; chunk: number; version: number } | Fail
> {
  if (!cardFilingAllowed(item.client_id)) return OFF
  // ANY STAGE, approved too (the owner, 22 Oct 2026: "we can enter files at any given time")
  // REPLACE: the piece on the card this file is the new version of ("we pick the file and put the new version with it")
  const replaces = body.replaces == null || body.replaces === '' ? null : String(body.replaces)
  if (replaces && !currentFiles(item as never).some(f => assetIdOf(f) === replaces)) {
    return { ok: false, status: 400, error: 'That file is not on the card any more — refresh and pick it again' }
  }
  const name = folderNameOf(body.name, '')
  const size = Number(body.size)
  if (!name) return { ok: false, status: 400, error: 'That file has no name' }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, status: 400, error: 'That file is empty' }
  const folders = await ensureCardFolders(item)
  if (!folders.ok) return folders
  const parent = isDriveId(body.parent) ? body.parent : folders.versionId
  if (!(await insideVersion(parent, folders.versionId))) {
    return { ok: false, status: 400, error: `Files go in ${versionFolderName(folders.version)} or a folder inside it` }
  }
  if (user.email) await grantEditor(folders.folderId, user.email)
  const by = user.email ?? user.id
  const uploads = table<DriveUpload>('drive_uploads')
  const now = Date.now()
  const open = (await uploads.list({ where: r => resumableMatch(r as never, { itemId: item.id, parentId: parent, name, size, by, replaces }, now) }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  if (open) {
    // where Google is: an empty piece asks without sending anything
    const status = await pushUploadChunk(open.upload_uri, new Uint8Array(0), 0, size)
    if (status.ok && status.done) {
      await uploads.update(open.id, { status: 'done', drive_file_id: status.id, received: size, updated_at: new Date().toISOString() } as Partial<DriveUpload>)
      return { ok: true, upload: open.id, uri: open.upload_uri, received: size, done: true, chunk: DIRECT_CHUNK, version: folders.version }
    }
    if (status.ok) {
      return { ok: true, upload: open.id, uri: open.upload_uri, received: status.received, done: false, chunk: DIRECT_CHUNK, version: folders.version }
    }
    // Google forgot it (over a week, or cancelled): start fresh below
    await uploads.update(open.id, { status: 'failed', error: status.message, updated_at: new Date().toISOString() } as Partial<DriveUpload>)
  }
  const mime = String(body.mime ?? '').slice(0, 100) || undefined
  const session = await openUploadSession(parent, name, size, mime, origin ?? undefined)
  if (!session.ok) return { ok: false, status: 502, error: session.message }
  const stamp = new Date().toISOString()
  const row = await uploads.insert({
    upload_uri: session.uri, name, parent_id: parent, mime_type: mime ?? null, size, received: 0, client_id: item.client_id,
    status: 'open', drive_file_id: null, created_by: by, created_at: stamp, updated_at: stamp,
    purpose: 'card', item_id: item.id, version: folders.version, copied_at: null, final_file_id: null, error: null, replaces,
  } as unknown as Omit<DriveUpload, 'id'>)
  return { ok: true, upload: row.id, uri: session.uri, received: 0, done: false, chunk: DIRECT_CHUNK, version: folders.version }
}

/** the open card upload, only for the person who started it */
export async function cardUploadRow(id: string, user: TeamUser, itemId: string): Promise<DriveUpload | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  const row = await table<DriveUpload>('drive_uploads').get(id)
  if (!row || row.purpose !== 'card' || row.item_id !== itemId) return null
  if (row.created_by !== (user.email ?? user.id)) return null
  return row
}

/**
 * THE FILES ARE IN DRIVE — PUT THEM ON THE CARD. Each upload is asked of Google (never taken from the browser's
 * word), checked to be inside the card's folder, then every finished file not yet handed in goes to the existing
 * Drive hand-in in one go. While another hand-in is still copying, it answers `waiting` and the page asks again.
 */
export async function finishCardUploads(user: TeamUser, item: ContentItem, ids: unknown): Promise<
  { ok: true; handedIn: number; waiting: boolean; note?: string } | Fail
> {
  if (!cardFilingAllowed(item.client_id)) return OFF
  const uploads = table<DriveUpload>('drive_uploads')
  const folderId = String(item.upload_folder_id ?? '').trim()
  if (!folderId) return { ok: false, status: 409, error: 'Nothing has been uploaded to this card yet' }
  for (const id of Array.isArray(ids) ? ids.slice(0, 200) : []) {
    const row = await cardUploadRow(String(id), user, item.id)
    if (!row || row.status !== 'open') continue
    const status = await pushUploadChunk(row.upload_uri, new Uint8Array(0), 0, row.size ?? 0)
    if (status.ok && status.done) {
      await uploads.update(row.id, { status: 'done', drive_file_id: status.id, received: row.size ?? status.bytes, updated_at: new Date().toISOString() } as Partial<DriveUpload>)
    } else if (status.ok) {
      await uploads.update(row.id, { received: status.received, updated_at: new Date().toISOString() } as Partial<DriveUpload>)
    }
  }
  const ready = await uploads.list({ where: r => r.purpose === 'card' && r.item_id === item.id && r.status === 'done' && !r.copied_at && !!r.drive_file_id })
  if (ready.length === 0) return { ok: true, handedIn: 0, waiting: false }
  const fresh = (await items().get(item.id)) ?? item
  const round = handInRound(fresh as never)
  const versionId = versionFoldersOf(fresh)[versionKey(round)]
  // files from an earlier version folder (sent back since) are handed in with their own folder's link
  const groups = new Map<string, DriveUpload[]>()
  for (const r of ready) {
    const v = versionFoldersOf(fresh)[versionKey(Number(r.version) || round)] ?? versionId
    if (!v) continue
    groups.set(v, [...(groups.get(v) ?? []), r])
  }
  let handedIn = 0
  for (const [vId, rows] of groups) {
    const inside = await Promise.all(rows.map(async r => ((await isInside(r.drive_file_id!, folderId)) === 'inside' ? r : null)))
    const ok = inside.filter((r): r is DriveUpload => !!r)
    if (ok.length === 0) continue
    // each file says what it is: the new version of the piece picked with Replace, or a new piece
    const map = Object.fromEntries(ok.map(r => [r.drive_file_id!, String(r.replaces ?? '') || 'new']))
    const started = await startDriveHandIn(user, fresh, { url: sharingUrl(vId), ids: ok.map(r => r.drive_file_id), map }, { anyTime: true })
    if (!started.ok) {
      if (started.status === 409 && /still copying/i.test(started.error)) return { ok: true, handedIn, waiting: true }
      return { ok: false, status: started.status, error: started.error }
    }
    const at = new Date().toISOString()
    await Promise.all(ok.map(r => uploads.update(r.id, { copied_at: at, updated_at: at } as Partial<DriveUpload>)))
    handedIn += ok.length
  }
  return { ok: true, handedIn, waiting: false }
}

/** NEW FOLDER inside the card's folder (the owner: "or add folders?") */
export async function makeCardFolder(item: ContentItem, parent: unknown, name: unknown): Promise<{ ok: true; id: string } | Fail> {
  if (!cardFilingAllowed(item.client_id)) return OFF
  const root = String(item.upload_folder_id ?? '').trim()
  if (!root) return { ok: false, status: 409, error: 'Upload a file first — that makes the card’s folder' }
  const where = isDriveId(parent) ? parent : root
  if (where !== root && (await isInside(where, root)) !== 'inside') return { ok: false, status: 400, error: 'Folders go inside this card’s folder' }
  const clean = folderNameOf(name, '')
  if (!clean) return { ok: false, status: 400, error: 'Give the folder a name' }
  const taken = await listFolderNames(where)
  const made = await createSubfolder(where, uniqueName(clean, taken))
  if (!made.ok) return { ok: false, status: 502, error: made.message }
  return { ok: true, id: made.id }
}

/** RENAME a folder inside the card's folder (the owner: "rename folders in there?") — never V1 / V2, never the card's */
export async function renameCardFolder(item: ContentItem, id: unknown, name: unknown): Promise<{ ok: true; name: string } | Fail> {
  if (!cardFilingAllowed(item.client_id)) return OFF
  const root = String(item.upload_folder_id ?? '').trim()
  if (!root || !isDriveId(id) || id === root) return { ok: false, status: 400, error: 'That folder cannot be renamed' }
  if (Object.values(versionFoldersOf(item)).includes(id)) return { ok: false, status: 400, error: 'V1, V2 … are the versions — they keep their names' }
  const detail = await entryDetail(id)
  if (!detail.ok) return { ok: false, status: 404, error: 'That folder could not be found' }
  if (detail.entry.parents[0] === root && isVersionFolderName(detail.entry.name)) return { ok: false, status: 400, error: 'V1, V2 … are the versions — they keep their names' }
  if ((await isInside(id, root)) !== 'inside') return { ok: false, status: 400, error: 'Only folders inside this card’s folder can be renamed' }
  const clean = folderNameOf(name, '')
  if (!clean) return { ok: false, status: 400, error: 'Give the folder a name' }
  if (isVersionFolderName(clean) && detail.entry.parents[0] === root) return { ok: false, status: 400, error: 'V1, V2 … are kept for the versions — pick another name' }
  const done = await renameFolder(id, clean)
  if (!done) return { ok: false, status: 502, error: 'Google Drive would not rename it' }
  return { ok: true, name: done }
}

/** what the card's upload box draws: the folder, the version it is on, the folders, this person's unfinished files */
export async function cardUploadState(user: TeamUser, item: ContentItem) {
  const allowed = cardFilingAllowed(item.client_id)
  if (!allowed) return { allowed: false as const }
  const folderId = String(item.upload_folder_id ?? '').trim() || null
  const round = handInRound(item as never)
  const by = user.email ?? user.id
  const now = Date.now()
  const rows = await table<DriveUpload>('drive_uploads').list({ where: r => r.purpose === 'card' && r.item_id === item.id })
  // HOW FAR EACH STOPPED FILE GOT is Google's to say: the pieces went from the browser straight to Google, so our own
  // row never heard (live, 22 Oct 2026: a file 27 MB in read "0 MB of 40 MB sent")
  const mine = rows.filter(r => r.status === 'open' && r.created_by === by && now - Date.parse(String(r.created_at)) < 6 * 864e5).slice(0, 10)
  const had = await Promise.all(mine.map(async r => {
    const s = await pushUploadChunk(r.upload_uri, new Uint8Array(0), 0, r.size ?? 0).catch(() => null)
    return s?.ok ? (s.done ? (r.size ?? 0) : s.received) : r.received
  }))
  return {
    allowed: true as const,
    folder: folderId ? { id: folderId, url: String(item.upload_folder_url ?? sharingUrl(folderId)) } : null,
    version: round,
    version_folder: versionFoldersOf(item)[versionKey(round)] ?? null,
    tree: folderId ? await cardFolderTree(item) : [],
    unfinished: mine.map((r, i) => ({ id: r.id, name: r.name, size: r.size, received: had[i], parent: r.parent_id, version: r.version, replaces: r.replaces ?? null })),
    waiting: rows.filter(r => r.status === 'done' && !r.copied_at).length,
  }
}

/* ── THE CARDS' FILES BEFORE THIS, PUT IN THEIR FOLDERS ────────────────────
 * The owner, 22 Oct 2026: "merge all existing ones to the folders correctly". Every card's files that went on before
 * the card had a folder are copied — from our own stored copy — into Clients / {Client} / {Card} / V{n}: the cut each
 * piece had at each version (an attempt replaced inside the same version is not filed). Run once by a super admin
 * (POST /api/production/drive-backfill), one card per job and one file per step (drive-card-backfill). For EVERY
 * client — the owner's order — so it does not ask cardFilingAllowed; it writes only inside each card's own folder.
 *
 * NEVER TWICE: each file claims `claim_locks/card_backfill__{file id}` before it is copied (trap 11); a copy that
 * failed or stalled for 20 minutes may be tried again, one that landed never is. A file that came from the card's
 * own folder in the first place (uploaded there) is already in it and is skipped.
 */
type BackfillLock = { id: string; item_id: string; file_id: string; status: 'copying' | 'done' | 'failed'; drive_id?: string | null; error?: string | null; at: string }
const backfillKey = (fileId: string) => `card_backfill__${fileId}`

/** the files of a card to file: the last cut of each piece at each version */
export function backfillFilesOf(item: { final_files?: unknown }): FinalFile[] {
  const last = new Map<string, FinalFile>()
  for (const f of finalFilesOf(item)) {
    const k = `${assetIdOf(f)}@${f.version}`
    const have = last.get(k)
    if (!have || f.uploaded_at > have.uploaded_at) last.set(k, f)
  }
  return [...last.values()].sort((a, b) => a.version - b.version || a.uploaded_at.localeCompare(b.uploaded_at))
}

export async function backfillPlan(itemId: string): Promise<{ ok: true; files: string[] } | Fail> {
  const item = await items().get(itemId)
  if (!item) return { ok: false, status: 404, error: 'No such card' }
  const fromFolder = new Set((await table<DriveUpload>('drive_uploads').list({ where: r => r.purpose === 'card' && r.item_id === itemId && !!r.drive_file_id }))
    .map(r => String(r.drive_file_id)))
  const files = backfillFilesOf(item).filter(f => !(f.drive_file_id && fromFolder.has(f.drive_file_id)))
  if (files.length === 0) return { ok: true, files: [] }
  // the folders first, once, so the file steps never race to make them
  const folder = await cardFolder(item)
  if (!folder.ok) return folder
  for (const v of [...new Set(files.map(f => f.version))]) {
    const made = await versionFolder((await items().get(itemId)) ?? item, folder.id, v)
    if (!made.ok) return made
  }
  return { ok: true, files: files.map(f => f.id) }
}

export async function backfillFile(itemId: string, fileId: string): Promise<{ ok: true; drive_id: string | null; skipped?: string } | Fail> {
  const item = await items().get(itemId)
  const f = item ? finalFilesOf(item).find(x => x.id === fileId) : null
  if (!item || !f) return { ok: true, drive_id: null, skipped: 'no longer on the card' }
  const folderId = String(item.upload_folder_id ?? '').trim()
  const vId = versionFoldersOf(item)[versionKey(f.version)]
  if (!folderId || !vId) return { ok: false, status: 409, error: 'The card’s folders are not made' }
  const locks = table<BackfillLock>('claim_locks')
  const now = new Date().toISOString()
  const took = await locks.claim(backfillKey(fileId), cur => {
    if (cur && (cur.status === 'done' || (cur.status === 'copying' && Date.now() - Date.parse(cur.at) < 20 * 60_000))) return null
    return { id: backfillKey(fileId), item_id: itemId, file_id: fileId, status: 'copying', at: now }
  })
  if (!took.claimed) return { ok: true, drive_id: took.current?.drive_id ?? null, skipped: took.current?.status === 'done' ? 'already in Drive' : 'being copied' }
  const up = await uploadStreamToFolder({ sourceUrl: f.url, name: f.name, parentId: vId })
  await locks.claim(backfillKey(fileId), cur => (cur ? {
    ...cur, status: up.ok ? 'done' : 'failed', drive_id: up.ok ? up.id : null, error: up.ok ? null : up.message.slice(0, 300), at: new Date().toISOString(),
  } : null))
  return up.ok ? { ok: true, drive_id: up.id } : { ok: false, status: 502, error: up.message }
}
