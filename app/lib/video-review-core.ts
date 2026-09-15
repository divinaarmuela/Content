/**
 * A CLIP'S REVIEW PAGE, THE PURE HALF (the owner, 15 Sep 2026: "once a video
 * is clicked it opens a new page with the video on the left and the comments
 * on the right — comments mention the timestamp, and on the video there is a
 * highlight circle at that timestamp so we can see it").
 *
 * The comments are the card's own comments (item_comments), each with the
 * second it is about and the file it is on. This file turns them into what
 * the page draws: the stamp "1:23", the marker's place on the timeline, the
 * list in time order, and which comment the playhead is on right now.
 */
export type ReviewComment = {
  id: string
  body: string
  author_id?: string | null
  created_at?: string | null
  video_timestamp_sec?: number | null
  video_file_id?: string | null
  parent_id?: string | null
}

/** "1:23", "12:05", "1:02:07" — the way an editor says a time in a cut. */
export function formatStamp(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds ?? 0)))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`
}

/** "1:23" → 83; "12" → 12; junk → null. The other way, for a stamp typed by hand. */
export function parseStamp(text: string): number | null {
  const parts = String(text ?? '').trim().split(':').map(p => p.trim())
  if (parts.length === 0 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

/** The comments on THIS clip, oldest stamp first, then oldest written first. */
export function commentsOnClip<T extends ReviewComment>(comments: readonly T[], fileId: string): T[] {
  return comments
    .filter(c => c.video_file_id === fileId && !c.parent_id)
    .sort((a, b) =>
      (a.video_timestamp_sec ?? Number.MAX_SAFE_INTEGER) - (b.video_timestamp_sec ?? Number.MAX_SAFE_INTEGER)
      || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
}

export type Marker = { id: string; at: number; left: number; stamp: string }

/** Where each stamped comment sits on the timeline, as a percentage of the
 *  clip's length. A comment with no stamp has no marker; a stamp past the end
 *  sits at the end. */
export function markersFor(comments: readonly ReviewComment[], duration: number): Marker[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  return comments
    .filter(c => typeof c.video_timestamp_sec === 'number' && c.video_timestamp_sec >= 0)
    .map(c => {
      const at = Math.min(c.video_timestamp_sec as number, duration)
      return { id: c.id, at, left: Math.round((at / duration) * 1000) / 10, stamp: formatStamp(at) }
    })
}

/** The comment the playhead is on: the latest stamp at or before now, within
 *  `window` seconds — so the circle lights up as the clip reaches it. */
export function activeCommentId(comments: readonly ReviewComment[], now: number, window = 1.5): string | null {
  let best: ReviewComment | null = null
  for (const c of comments) {
    const at = c.video_timestamp_sec
    if (typeof at !== 'number') continue
    if (at <= now + 0.25 && now - at <= window && (!best || at > (best.video_timestamp_sec as number))) best = c
  }
  return best?.id ?? null
}

/** The clip's own page: the card, then the file. */
/** THE CLIP'S MIME, FROM ITS NAME: Google's public download answers
 *  `application/octet-stream` for everything, and a <video> given that has
 *  to guess. The name the tile carried says what it is. */
export function videoMimeOf(name: string | null | undefined): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec((name ?? '').trim())?.[1]?.toLowerCase() ?? ''
  return ({ mov: 'video/quicktime', qt: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska' } as Record<string, string>)[ext] ?? null
}

export function reviewPath(itemId: string, fileId: string, name?: string | null): string {
  const q = name ? `?name=${encodeURIComponent(name)}` : ''
  return `/dashboard/editor/${encodeURIComponent(itemId)}/video/${encodeURIComponent(fileId)}${q}`
}
