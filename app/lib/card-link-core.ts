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
