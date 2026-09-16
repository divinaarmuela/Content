/**
 * A CARD CARRIES A LINK.
 *
 * The owner's words: "its either drive link or dropbox and the status keeps
 * them on track". A card points at where the work lives — a Google Drive or
 * Dropbox URL somebody pasted — and the app does nothing with that URL but
 * label it and open it. No account, no integration, and above all no write:
 * Google Drive stays read only (CLAUDE.md trap 13). A pasted link is a link.
 *
 * Pure: no I/O. The route that stores a link calls `linkKindOf` first.
 */

export type LinkKind = 'drive' | 'dropbox' | 'other'

export type LinkCheck =
  | { ok: true; kind: LinkKind; label: string; url: string }
  | { ok: false; reason: string }

/** What the chip on the card says. */
export const LINK_LABELS: Record<LinkKind, string> = {
  drive: 'Google Drive',
  dropbox: 'Dropbox',
  other: 'Link',
}

const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com'])
const DROPBOX_HOSTS = new Set(['dropbox.com', 'www.dropbox.com'])

/**
 * Detect the kind by HOST, and refuse anything that is not https.
 *
 * Hosts, not substrings: `evil.example/drive.google.com` is not Drive. A
 * Dropbox share link may come from `www.dropbox.com` or a `*.dropbox.com`
 * subdomain; a Drive link from `drive.google.com` or a Docs/Sheets/Slides
 * URL on `docs.google.com`. Anything else that is a real https URL is kept
 * as a plain "Link" — a Frame.io review or a Vimeo cut is still where the
 * work lives.
 */
/** The folder id inside a Google Drive folder link, or null for anything
 *  else — the post window's Drive tab opens on it. */
export function driveFolderIdFromUrl(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim()
  const m = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/.exec(text)
  return m ? m[1] : null
}

/** ONE FILE, NOT A FOLDER (the owner, 16 Sep 2026: a single clip's Drive link
 *  pasted as the source working folder — "the file is not showing"): the
 *  id in a /file/d/<id>/view, an open?id=<id> or a uc?id=<id> link. */
export function driveFileIdFromUrl(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim()
  if (!/drive\.google\.com|docs\.google\.com/.test(text)) return null
  const m = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(text) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(text)
  return m ? m[1] : null
}

/** what a Drive link points at — a folder to list, or one file — or null */
export function driveTargetOf(raw: string | null | undefined): { id: string; kind: 'folder' | 'file' } | null {
  const folder = driveFolderIdFromUrl(raw)
  if (folder) return { id: folder, kind: 'folder' }
  const file = driveFileIdFromUrl(raw)
  return file ? { id: file, kind: 'file' } : null
}

export function linkKindOf(raw: string | null | undefined): LinkCheck {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, reason: 'Paste a link first' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: 'That does not look like a link — paste the full address, starting with https://' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Links must start with https://' }
  }
  const host = url.hostname.toLowerCase()
  const kind: LinkKind = DRIVE_HOSTS.has(host)
    ? 'drive'
    : DROPBOX_HOSTS.has(host) || host.endsWith('.dropbox.com')
      ? 'dropbox'
      : 'other'
  return { ok: true, kind, label: LINK_LABELS[kind], url: url.toString().slice(0, 2000) }
}

/**
 * THE FOLDER ON A CARD — one answer, wherever it was written.
 *
 * Two fields grew up meaning the same thing: `link_url`/`link_kind` (the
 * card face's "Add a folder link", the Schedule rail's and the Overview's
 * "Folder to work from") and `raw_assets_url` (the open card's "Files to
 * work from"). The owner's New post saved the folder into one and the face
 * read the other, so a card with a Drive folder said "Add a folder link"
 * (13 Sep 2026). Every reader asks here; both writers now keep the two in
 * step, and rows written before that still resolve.
 */
export function folderOf(card: {
  link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null; link_final?: boolean | null
}): { url: string; kind: 'drive' | 'dropbox' } | null {
  const link = String(card.link_url ?? '').trim()
  // a link marked as the finished edit is never the folder (14 Sep 2026)
  if (link && card.link_final !== true && (card.link_kind === 'drive' || card.link_kind === 'dropbox')) return { url: link, kind: card.link_kind }
  const raw = linkKindOf(card.raw_assets_url)
  if (raw.ok && raw.kind !== 'other') return { url: raw.url, kind: raw.kind }
  return null
}

/**
 * THE FINISHED EDIT ON A CARD — the link the editor pasted as their work,
 * never the folder to work from (the owner, 14 Sep 2026: the quality
 * reviewer's card showed the submitted link only as "the folder").
 *
 * The link route marks it (`link_final`: true for the editor's "Your
 * finished edit" box, false for a folder). A row from before the mark
 * counts its link as the work when it is not also the folder — and never
 * on a posting job, whose link is always the folder the scheduler works
 * from.
 */
export function finishedEditOf(card: {
  link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null
  link_final?: boolean | null; adhoc_post?: boolean | null
}): { url: string; label: string } | null {
  const link = String(card.link_url ?? '').trim()
  if (!link) return null
  if (card.link_final === true) return { url: link, label: linkLabel(card.link_kind) }
  if (card.link_final === false || card.adhoc_post === true) return null
  if (link === String(card.raw_assets_url ?? '').trim()) return null
  return { url: link, label: linkLabel(card.link_kind) }
}

/** The link the card face shows: the pasted link, else the folder. */
export function cardLinkOf(card: {
  link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null
}): { url: string; label: string } | null {
  const link = String(card.link_url ?? '').trim()
  if (link) return { url: link, label: linkLabel(card.link_kind) }
  const folder = folderOf(card)
  return folder ? { url: folder.url, label: LINK_LABELS[folder.kind] } : null
}

/** The label for a kind already stored on a row (tolerant of a bad value). */
export function linkLabel(kind: string | null | undefined): string {
  return (LINK_LABELS as Record<string, string>)[kind ?? ''] ?? LINK_LABELS.other
}

/** "version 3" — how a card says which link it holds. Never sub-cards. */
export function versionWord(n: number | null | undefined): string {
  const v = Number(n)
  return `version ${Number.isFinite(v) && v > 0 ? Math.floor(v) : 1}`
}

/**
 * What replacing a link does to the version number, decided in one place so
 * the route and the tests agree.
 *
 * A first link on a card that has never had a version is version 1; a first
 * link on a card that already carries uploaded versions keeps that number
 * (the link describes the same work); replacing a link is a new version.
 */
export function nextVersionAfterLink(
  current: { link_url?: string | null; current_version_number?: number | null },
  url: string,
): { version: number; changed: boolean } {
  const now = Math.max(0, Math.floor(Number(current.current_version_number ?? 0) || 0))
  const had = String(current.link_url ?? '').trim()
  if (had && had === url) return { version: Math.max(now, 1), changed: false }
  if (!had) return { version: Math.max(now, 1), changed: true }
  return { version: now + 1, changed: true }
}
