/**
 * EDITORS UPLOAD STRAIGHT INTO THE CARD'S OWN DRIVE FOLDER (the owner, 22 Oct 2026: "we will upload everything as
 * files and everything will be tracked via drive"; "what i thought uploading here uploaded straight to drive").
 *
 *   Clients / {Client} / {Card} / V1 / file.mp4
 *                               / V2 / …
 *
 * The app makes the client folder and the card's folder the first time a file is uploaded to the card, shares the
 * card's folder "anyone with the link can view" (the link sits on the card) — view only for every person, so files go
 * in only through the card and Drive always matches it (the owner, 23 Oct 2026). The browser sends the bytes to Google
 * itself, in resumable pieces, so a file half-sent today carries on tomorrow from where it stopped ("an editor can
 * submit a file in progress and come back next day to continue"). When the files are in, the existing Drive hand-in
 * (drive-handin.ts) copies them onto the card — versions, replacements and matching exactly as a pasted Drive link.
 *
 * Inside the card's folder a person may add folders and rename the ones they made ("allow the editor to rename
 * folders in there? or add folders?"). The V1 / V2 folders are the versions and keep their names.
 *
 * LIVE FOR EVERY CLIENT since 22 Oct 2026 (the owner, after the preview on the test clients: "1 and 2 do it").
 * DRIVE_CARD_FILING=test puts it back on the test clients only.
 *
 * Pure: names, links, the switch, the resume rule. No I/O.
 */
import { isTestClient } from './test-clients-core'
import { finalFilesOf } from './final-files-core'
import { handInRound } from './edit-round-core'
import { clipApprovalsOf } from './clip-approvals-core'

/** on for every client; `test` keeps it on the test clients only (gdrive-policy.ts, trap 13) */
export const DRIVE_CARD_FILING = 'DRIVE_CARD_FILING'

export function cardFilingAllowed(clientId: string | null | undefined): boolean {
  if (!clientId) return false
  return process.env[DRIVE_CARD_FILING] !== 'test' || isTestClient(clientId)
}

/** a Drive name: no slashes, no control characters, not empty, not absurdly long */
export function folderNameOf(raw: unknown, fallback: string): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)
  return s || fallback
}

/** "Travel Vlogs" taken → "Travel Vlogs (2)", then "(3)" — two cards with one title never share a folder */
export function uniqueName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map(t => t.trim().toLowerCase()))
  if (!lower.has(name.toLowerCase())) return name
  for (let n = 2; n < 1000; n++) {
    const next = `${name} (${n})`
    if (!lower.has(next.toLowerCase())) return next
  }
  return `${name} (${Date.now()})`
}

export function versionFolderName(round: number): string {
  return `V${Math.max(1, Math.floor(round))}`
}

/** V1, V2 … are the versions: never renamed from the dashboard */
export function isVersionFolderName(name: string): boolean {
  return /^V\d+$/i.test(name.trim())
}

/** the link anyone can open (view only) — what the card shows and Copy link copies */
export function sharingUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}?usp=sharing`
}

/**
 * HOW BIG EACH PIECE IS. Google wants every piece but the last to be a multiple of 256 KB. Sent from the browser
 * straight to Google: 16 MB — few round trips, and a dropped connection costs at most 16 MB. Through our server (the
 * fallback when the browser may not talk to Google): 4 MB, under the host's 4.5 MB request limit.
 */
export const DIRECT_CHUNK = 16 * 1024 * 1024
export const PROXY_CHUNK = 4 * 1024 * 1024
/** files sent at the same time — enough to fill a line, not so many that each one crawls */
export const PARALLEL_FILES = 3
/** Google keeps an unfinished upload for about a week; we offer to carry on for six days */
export const RESUME_FOR_MS = 6 * 24 * 60 * 60 * 1000

/**
 * IS THIS THE FILE THAT WAS HALF-SENT? Same card, same version folder, same name and same size, by the same person, for the same piece,
 * still open and not older than RESUME_FOR_MS. The browser cannot keep a file across a closed tab, so the person
 * picks it again; this is how the app knows to carry on instead of starting over.
 */
export function resumableMatch(
  row: { purpose?: string | null; item_id?: string | null; parent_id?: string | null; name?: string | null; size?: number | null; status?: string | null; created_by?: string | null; created_at?: string | null; replaces?: string | null },
  want: { itemId: string; parentId: string; name: string; size: number; by: string | null; replaces?: string | null },
  nowMs: number,
): boolean {
  if (row.purpose !== 'card' || row.status !== 'open') return false
  if (row.item_id !== want.itemId || row.parent_id !== want.parentId) return false
  if (row.name !== want.name || row.size !== want.size) return false
  if ((row.created_by ?? null) !== want.by) return false
  // the same file meant for another piece (or as a new one) is another upload
  if ((row.replaces ?? null) !== (want.replaces ?? null)) return false
  const at = Date.parse(String(row.created_at ?? ''))
  return Number.isFinite(at) && nowMs - at < RESUME_FOR_MS
}

/**
 * FINISHED WORK ONLY: videos, pictures and PDFs. A zip plays nowhere and shows no picture (live, 25 Oct 2026: a
 * 682 MB "drive-download-….zip" — a whole Drive folder downloaded — went into V1 and onto no card).
 */
export function uploadKindRefusal(name: string, mime: string | null | undefined): string | null {
  const m = String(mime ?? '').toLowerCase()
  if (m.startsWith('video/') || m.startsWith('image/') || m === 'application/pdf') return null
  if (/\.(mp4|mov|m4v|mxf|avi|mkv|webm|jpe?g|png|gif|webp|heic|heif|tiff?|psd|pdf)$/i.test(name)) return null
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name) || /zip|compressed|x-tar|x-7z/.test(m)) return `${name} is a zip — unzip it and upload the videos inside`
  return `${name} is not a video, picture or PDF`
}

/**
 * MAY THIS FILE BE DELETED FROM THE CARD (the owner, 25 Oct 2026: "once a card is present we can delete the files there
 * and reflect in drive too")? Deleting takes it off the card and puts the card's Drive copy in Drive's bin.
 *   - anyone on the team (the owner, 25 Oct 2026: "anyone can delete");
 *   - never once the card is booked in or posted — the channel has the files;
 *   - only the newest cut of a video — an older cut is what the newer one replaced;
 *   - only in the version being worked on — an earlier version went to the client and stays as they saw it;
 *   - never a file the client approved.
 */
export function deleteRefusal(
  item: { status?: unknown; owner_id?: unknown; final_files?: unknown; clip_approvals?: unknown; edit_round?: unknown; client_round?: unknown; client_rounds?: unknown },
  fileId: string,
  viewer: { id: string; role: string },
): string | null {
  const files = finalFilesOf(item)
  const f = files.find(x => x.id === fileId)
  if (!f) return 'That file is not on the card any more'
  if (viewer.role === 'client') return 'Only the team can delete a file'
  const status = String(item.status ?? '')
  if (status === 'scheduled' || status === 'published') return 'This card is booked in or posted — its files stay'
  if (files.some(x => x.replaces === f.id)) return `A newer cut of ${f.name} is on the card — delete that one first`
  if (f.version < handInRound(item as never)) return `${f.name} is part of an earlier version the client has seen — it stays`
  if (clipApprovalsOf(item).some(a => a.file_id === f.id)) return `The client approved ${f.name} — it stays`
  return null
}

