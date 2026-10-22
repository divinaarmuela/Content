/**
 * EDITORS UPLOAD STRAIGHT INTO THE CARD'S OWN DRIVE FOLDER (the owner, 22 Oct 2026: "we will upload everything as
 * files and everything will be tracked via drive"; "what i thought uploading here uploaded straight to drive").
 *
 *   Clients / {Client} / {Card} / V1 / file.mp4
 *                               / V2 / …
 *
 * The app makes the client folder and the card's folder the first time a file is uploaded to the card, shares the
 * card's folder "anyone with the link can view" (the link sits on the card), and gives the card's editor edit access
 * with their own Google account so Drive for desktop can drop files in too. The browser sends the bytes to Google
 * itself, in resumable pieces, so a file half-sent today carries on tomorrow from where it stopped ("an editor can
 * submit a file in progress and come back next day to continue"). When the files are in, the existing Drive hand-in
 * (drive-handin.ts) copies them onto the card — versions, replacements and matching exactly as a pasted Drive link.
 *
 * Inside the card's folder a person may add folders and rename the ones they made ("allow the editor to rename
 * folders in there? or add folders?"). The V1 / V2 folders are the versions and keep their names.
 *
 * PREVIEW FIRST ("make it in preview mode first please"): on test clients only, until DRIVE_CARD_FILING=all.
 *
 * Pure: names, links, the switch, the resume rule. No I/O.
 */
import { isTestClient } from './test-clients-core'

/** `all` turns it on for every client; anything else keeps it on the test clients (gdrive-policy.ts trap 13) */
export const DRIVE_CARD_FILING = 'DRIVE_CARD_FILING'

export function cardFilingAllowed(clientId: string | null | undefined): boolean {
  if (!clientId) return false
  return process.env[DRIVE_CARD_FILING] === 'all' || isTestClient(clientId)
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
 * IS THIS THE FILE THAT WAS HALF-SENT? Same card, same version folder, same name and same size, by the same person,
 * still open and not older than RESUME_FOR_MS. The browser cannot keep a file across a closed tab, so the person
 * picks it again; this is how the app knows to carry on instead of starting over.
 */
export function resumableMatch(
  row: { purpose?: string | null; item_id?: string | null; parent_id?: string | null; name?: string | null; size?: number | null; status?: string | null; created_by?: string | null; created_at?: string | null },
  want: { itemId: string; parentId: string; name: string; size: number; by: string | null },
  nowMs: number,
): boolean {
  if (row.purpose !== 'card' || row.status !== 'open') return false
  if (row.item_id !== want.itemId || row.parent_id !== want.parentId) return false
  if (row.name !== want.name || row.size !== want.size) return false
  if ((row.created_by ?? null) !== want.by) return false
  const at = Date.parse(String(row.created_at ?? ''))
  return Number.isFinite(at) && nowMs - at < RESUME_FOR_MS
}

