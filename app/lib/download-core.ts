import { isDriveId } from './files-core'

/**
 * DOWNLOAD, ON EVERY ASSET (the owner, 17 Sep 2026: "add a download feature
 * on the Editor page — each asset should have a download button for them to
 * download, same with Designer").
 *
 * A browser ignores `download` on a link to another origin, and every asset
 * the dashboard holds lives on another origin (the R2 bucket) or behind
 * Google (a Drive original). So a download is always a same-origin address:
 *
 *   - a file in our own storage → /api/assets/download?url=…&name=…, which
 *     streams the bytes back with a Content-Disposition of attachment;
 *   - a Drive original with no copy yet → /api/drive/download?id=…, the Files
 *     page's own route, which pipes it from Google with our token.
 *
 * The server decides what "our own storage" is; a URL from anywhere else is
 * sent back as a redirect, so the person still lands on the file. Pure: the
 * route reads the environment and hands the bases in.
 */
export const OWN_STORAGE_DEFAULT = 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev'

export function ownStorageBases(env: { R2_PUBLIC_BASE_URL?: string | null; NEXT_PUBLIC_MEDIA_URL?: string | null }): string[] {
  return [env.R2_PUBLIC_BASE_URL, env.NEXT_PUBLIC_MEDIA_URL, OWN_STORAGE_DEFAULT]
    .map(b => String(b ?? '').trim().replace(/\/+$/, ''))
    .filter((b, i, all) => !!b && all.indexOf(b) === i)
}

export function isOwnAssetUrl(url: unknown, bases: readonly string[]): boolean {
  const u = String(url ?? '').trim()
  if (!/^https:\/\//i.test(u)) return false
  return bases.some(b => u.startsWith(`${b}/`))
}

/** The same-origin address that downloads this file, or null when there is
 *  nothing to download (no copy and no Drive id). `share` is a public share
 *  token: the route lets the file through without a sign-in when the token's
 *  card shares it. */
export function downloadHref(f: { url?: string | null; id?: string | null; name: string }, share?: string | null): string | null {
  const url = String(f.url ?? '').trim()
  if (/^https?:\/\//i.test(url)) {
    const q = new URLSearchParams({ url, name: f.name })
    if (share) q.set('share', share)
    return `/api/assets/download?${q.toString()}`
  }
  if (isDriveId(f.id)) return `/api/drive/download?id=${encodeURIComponent(f.id)}`
  return null
}

/** A filename safe to put in a header: quotes and control characters out,
 *  and the real name repeated as UTF-8 for browsers that read it. */
export function disposition(name: string): string {
  const clean = String(name ?? '').trim() || 'file'
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}
