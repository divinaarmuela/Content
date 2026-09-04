/**
 * IS THIS ONE OF OUR OWN FILES?
 *
 * Pure, so it can be tested without a bucket, and separate from `storage.ts`
 * so the answer does not depend on a server module being importable.
 *
 * It exists because of a real hole: the route that saves a CROP writes the new
 * file into the version the client already approved and leaves the approval
 * standing. Checking only that the URL began `https://` meant a request could
 * name any file on the internet and have it published under a version still
 * labelled approved. A URL is only ours if it is on our own public storage
 * host, and its key has the shape `objectKey()` mints.
 */

/** `objectKey()` is `<epoch ms>-<6 base36 chars>-<sanitised filename>`, and
 *  the filename has already had everything outside `[A-Za-z0-9._-]` replaced
 *  with `_`. Nothing else can be a key we wrote. */
export const OBJECT_KEY_SHAPE = /^[0-9]{10,}-[a-z0-9]{4,10}-[A-Za-z0-9._-]+$/

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] as const
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'] as const

export type FileKind = 'image' | 'video'

export function extensionOf(url: string): string {
  const clean = String(url ?? '').split('?')[0].split('#')[0]
  const last = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = last.lastIndexOf('.')
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : ''
}

/**
 * The URL, if it is ours and of the kind asked for. Null otherwise.
 *
 * Refuses, in order: anything that is not a URL, anything not on the public
 * base, a key that is not `objectKey`-shaped, any `..` or `//` in the key
 * (path traversal, and a `//` would address a different object than the one
 * being checked), and an extension the kind does not allow.
 */
export function ourStorageUrl(
  url: unknown, base: string | null | undefined, kind: FileKind,
): string | null {
  const s = String(url ?? '').trim()
  const root = String(base ?? '').trim().replace(/\/+$/, '')
  if (!s || !root) return null
  if (!/^https:\/\//i.test(s) || !/^https:\/\//i.test(root)) return null
  if (!s.startsWith(`${root}/`)) return null

  const key = s.slice(root.length + 1)
  if (!key || key.includes('..') || key.includes('//') || key.includes('\\')) return null
  // no query, no fragment: a signed or decorated URL is not what we wrote
  if (key.includes('?') || key.includes('#')) return null
  if (!OBJECT_KEY_SHAPE.test(key)) return null

  const allowed: readonly string[] = kind === 'video' ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS
  if (!allowed.includes(extensionOf(key))) return null

  return s
}

/** Does what the storage host says about a file match what we are about to
 *  treat it as? Both halves matter: a `.jpg` key serving `text/html` is not a
 *  picture, and neither is a 900 MB one. */
export function storedFileIsUsable(
  head: { contentType?: string | null; bytes?: number | null } | null,
  kind: FileKind,
  maxBytes: number,
): { ok: true } | { ok: false; why: string } {
  if (!head) {
    return { ok: false, why: 'That file is not in our storage yet — try saving again' }
  }
  const type = String(head.contentType ?? '').toLowerCase()
  const wanted = kind === 'video' ? 'video/' : 'image/'
  if (!type.startsWith(wanted)) {
    return {
      ok: false,
      why: kind === 'video'
        ? 'That file is not a video'
        : 'That file is not a picture',
    }
  }
  if (typeof head.bytes === 'number' && head.bytes > maxBytes) {
    return { ok: false, why: 'That file is too big to put on a post' }
  }
  return { ok: true }
}
