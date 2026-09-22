/**
 * A VIDEO ON OUR OWN ORIGIN, for the parts of the page that must READ it —
 * the cover picker drawing a frame onto a canvas (22 Sep 2026: "this video
 * will not open here"). A file in our bucket is served through
 * /api/assets/stream instead, so no cross-origin permission is needed; any
 * other address is left alone. Pure.
 */
export function sameOriginVideoUrl(url: string): string {
  try {
    const u = new URL(url)
    if (!/\.r2\.dev$/i.test(u.hostname)) return url
    return `/api/assets/stream?url=${encodeURIComponent(url)}`
  } catch {
    return url
  }
}

/** is this address already ours? then the element needs no cross-origin mode */
export function isSameOriginMedia(url: string): boolean {
  return url.startsWith('/api/assets/stream?')
}
