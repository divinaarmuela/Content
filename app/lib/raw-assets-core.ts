/**
 * FILES TO WORK FROM — pure.
 *
 * The owner, 11 Sep 2026: "Abby (super admin) will assign an editor to edit
 * and she will show the files there". A manager attaches the material the
 * editor works from — footage, stills, references, or a Drive/Dropbox
 * folder — to the card itself, separate from the versions the editor
 * uploads. Stored where the job pack always kept them:
 * `content_items.raw_assets` (a list of {url, name}) and
 * `content_items.raw_assets_url` (the folder link).
 */

export type RawAsset = { url: string; name: string }

export const FILES_TO_WORK_FROM = 'Files to work from'
export const YOUR_VERSIONS = 'Versions'

/** The stored list, read tolerantly: anything without an https url is dropped. */
export function readRawAssets(raw: unknown): RawAsset[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a): a is { url?: unknown; name?: unknown } => !!a && typeof a === 'object')
    .map(a => ({ url: String(a.url ?? ''), name: String(a.name ?? '') }))
    .filter(a => /^https:\/\//.test(a.url))
}

/** Existing plus added, one entry per url, existing order kept. */
export function mergeRawAssets(existing: readonly RawAsset[], added: readonly RawAsset[]): RawAsset[] {
  const seen = new Set<string>()
  const out: RawAsset[] = []
  for (const a of [...existing, ...added]) {
    if (!a.url || seen.has(a.url)) continue
    seen.add(a.url)
    out.push({ url: a.url, name: a.name || nameFromUrl(a.url) })
  }
  return out
}

export function withoutRawAsset(list: readonly RawAsset[], url: string): RawAsset[] {
  return list.filter(a => a.url !== url)
}

/** The last path segment, decoded, for a file that arrived without a name. */
export function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(last)
  } catch {
    return url
  }
}

const IMAGE = /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp|avif)$/i
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|mxf|hevc)$/i

/** What a file is, from its name (or url), for the thumbnail choice. */
export function rawAssetKind(a: Pick<RawAsset, 'url' | 'name'>): 'image' | 'video' | 'other' {
  const probe = (a.name || nameFromUrl(a.url)).split('?')[0]
  if (IMAGE.test(probe)) return 'image'
  if (VIDEO.test(probe)) return 'video'
  return 'other'
}

/** The line under the heading: how much there is to work from. */
export function filesToWorkFromWords(count: number, hasFolder: boolean): string {
  if (count === 0 && !hasFolder) return 'Nothing yet. Files or a folder link a manager adds here are what the editor works from.'
  const files = count === 0 ? null : `${count} ${count === 1 ? 'file' : 'files'}`
  const folder = hasFolder ? 'a folder link' : null
  return `${[files, folder].filter(Boolean).join(' and ')} to work from.`
}
