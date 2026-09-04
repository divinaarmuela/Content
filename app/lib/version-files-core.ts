/**
 * A version is a POST, and a post can be many files.
 *
 * One item = one post is still true. What was not true is "one post = one
 * file": an Instagram carousel is two to ten images and/or videos published
 * together, in an order somebody chose. `asset_versions.file_url` could hold
 * exactly one, so a carousel could not be represented at all — the editor
 * uploaded six cards and the scheduler had one of them to post.
 *
 * `files` is the ordered array. `file_url` remains the FIRST slide, so every
 * reader written before this — the portal preview, the Drive mirror, the
 * publish planner — keeps seeing something real rather than nothing. Read
 * through `slidesOf` and the two shapes are one shape.
 *
 * Pure: no I/O, no SDK. The rules live here and are tested directly.
 */

export type SlideType = 'image' | 'video'

/** How a file got here: picked out of the agency's Drive, or uploaded. */
export type SlideSource = 'drive' | 'upload'

export type Slide = {
  url: string
  name: string
  type: SlideType
  /** file size, when the uploader knew it — display only */
  bytes?: number
  /**
   * WHERE THIS FILE CAME FROM, and the one value that changes behaviour.
   *
   * `'drive'` means somebody picked it in the composer's Google Drive tab: the
   * bytes were copied into our storage so a publisher can fetch them, but the
   * file itself is ALREADY in the agency's Drive, in the folder the person
   * picked it out of. Copying it back would put a second copy of the same
   * footage beside the first under a version-numbered name — which is exactly
   * the "auto upload to the drive" the owner ruled out. So a drive-sourced
   * slide is never mirrored, whatever the filing switch says.
   *
   * `'upload'` is the ordinary case, and so is ABSENT — every slide written
   * before this existed has no `source` at all and is an upload.
   */
  source?: SlideSource
  /** the Drive file it was picked from, kept so the version can point back at
   *  the original rather than only at our copy of it */
  drive_file_id?: string
}

/** Instagram's carousel ceiling, and the tightest of any platform we post to. */
export const MAX_SLIDES = 10
/** Below this it is not a carousel, it is a post. */
export const MIN_CAROUSEL_SLIDES = 2

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv|mpe?g)$/i

/** Guess image vs video from the URL — the only signal a pasted link carries. */
export function slideTypeFromUrl(url: string): SlideType {
  const clean = String(url ?? '').split('?')[0].split('#')[0]
  return VIDEO_EXT.test(clean) ? 'video' : 'image'
}

/** "…/9f2a1c/Hook cut.mp4?sig=…" → "Hook cut.mp4". */
export function slideNameFromUrl(url: string): string {
  const clean = String(url ?? '').split('?')[0].split('#')[0]
  const last = clean.slice(clean.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last) || 'file'
  } catch {
    return last || 'file'
  }
}

/** Only our own https uploads and https links may become slides. A blob: or
 *  data: URL is a browser-local artefact that no publisher could ever fetch. */
function usableUrl(url: unknown): string | null {
  const u = String(url ?? '').trim()
  return /^https:\/\/\S+$/i.test(u) ? u : null
}

/**
 * Clean whatever the client sent into slides we would be willing to publish.
 *
 * Everything unusable is DROPPED rather than rejected: a save that loses one
 * bad row is better than a save that loses the other nine good ones, and the
 * count the UI shows is the count that was kept. Mixed image/video is allowed
 * here — whether a given platform accepts the mix is `validatePost`'s call,
 * not this one's.
 */
export function normaliseSlides(input: unknown): Slide[] {
  const raw = Array.isArray(input) ? input : []
  const out: Slide[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const row = (entry ?? {}) as Record<string, unknown>
    // a bare string is a URL — the shortest thing a caller might send
    const url = usableUrl(typeof entry === 'string' ? entry : row.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const name = String(row.name ?? '').trim() || slideNameFromUrl(url)
    const type: SlideType = row.type === 'video' || row.type === 'image'
      ? row.type
      : slideTypeFromUrl(url)
    const bytes = Number(row.bytes)
    // where it came from survives the round trip: the picker sets it, the
    // version stores it, and the mirror reads it to know not to copy the file
    // back into the folder it was picked out of
    const driveId = String(row.drive_file_id ?? '').trim()
    out.push({
      url, name, type,
      ...(Number.isFinite(bytes) && bytes > 0 ? { bytes: Math.floor(bytes) } : {}),
      ...(row.source === 'drive' || row.source === 'upload'
        ? { source: row.source as SlideSource }
        : {}),
      ...(driveId ? { drive_file_id: driveId } : {}),
    })
    if (out.length === MAX_SLIDES) break
  }
  return out
}

export type VersionLike = {
  files?: unknown
  file_url?: string | null
}

/**
 * The slides of a version, whichever era it was written in.
 *
 * `files` when it holds anything; otherwise the single `file_url` as slide
 * one. A version that is only a pasted review link has no slides at all —
 * there are no bytes of ours to show or publish.
 */
export function slidesOf(version: VersionLike | null | undefined): Slide[] {
  const many = normaliseSlides(version?.files)
  if (many.length > 0) return many
  const one = usableUrl(version?.file_url)
  return one ? [{ url: one, name: slideNameFromUrl(one), type: slideTypeFromUrl(one) }] : []
}

/** Move a slide, returning a new array. Out-of-range indexes change nothing —
 *  a drag that ended off the strip must not silently drop a card. */
export function reorder<T>(slides: readonly T[], from: number, to: number): T[] {
  const list = [...slides]
  if (
    !Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < 0 || from >= list.length || to >= list.length || from === to
  ) return list
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return list
}

/** "6 slides" / "1 slide" / null when there is nothing to count. */
export function slideCountLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null
  return count === 1 ? '1 slide' : `${count} slides`
}

/** Is this item type a carousel? One spelling, in one place. */
export function isCarouselType(contentType: string | null | undefined): boolean {
  return String(contentType ?? '').toLowerCase() === 'carousel'
}

/**
 * What is wrong with this set of slides for this kind of item, or null.
 *
 * The server refuses a one-slide carousel here rather than letting it reach
 * Instagram as a lone photo with a caption written for six.
 */
export function slidesSatisfyType(
  contentType: string | null | undefined,
  slides: readonly Slide[],
): string | null {
  if (slides.length > MAX_SLIDES) {
    return `A carousel takes at most ${MAX_SLIDES} slides`
  }
  if (isCarouselType(contentType) && slides.length > 0 && slides.length < MIN_CAROUSEL_SLIDES) {
    return 'A carousel needs at least 2 slides'
  }
  return null
}

/**
 * Which slides actually GO OUT for an item of this type.
 *
 * A carousel posts all of them, in order — that order is the carousel. A Reel
 * or a Story posts exactly one, and the rest are working files: a Reel version
 * often carries its cover image as slide two, and publishing that alongside
 * the video is how a Reel gets rejected for containing a still. An item whose
 * type we have no rule for posts everything and lets the count decide, which
 * is what `contentTypeToKind` already does with it.
 */
export function postSlides(
  contentType: string | null | undefined, slides: readonly Slide[],
): Slide[] {
  const t = String(contentType ?? '').toLowerCase()
  if (t === 'carousel') return slides.slice(0, MAX_SLIDES)
  if (t === 'reel' || t === 'story' || t === 'static') return slides.slice(0, 1)
  return slides.slice(0, MAX_SLIDES)
}

/** `v3 - 02 - Hook cut.mp4` — what one slide is CALLED in Drive. Slide one of
 *  a single-file version keeps the old `v3 - name` so nothing already
 *  mirrored is copied a second time under a new name. */
export function slideFileName(
  versionNumber: number, index: number, originalName: string | null | undefined, total: number,
): string {
  const n = Number.isFinite(versionNumber) && versionNumber > 0 ? Math.floor(versionNumber) : 1
  const name = String(originalName ?? '').trim() || 'file'
  if (total <= 1) return `v${n} - ${name}`
  return `v${n} - ${String(index + 1).padStart(2, '0')} - ${name}`
}
