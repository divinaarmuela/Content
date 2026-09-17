/**
 * THE SITE'S CLIPS ON CLOUDFLARE STREAM (the owner, 17 Sep 2026: "on the
 * phone the site takes a long time to play video", "the work page videos
 * are very slow on mobile too"). Every marketing clip lives in the R2 bucket
 * as an mp4 of 5 to 26 MB behind an r2.dev address Cloudflare throttles on
 * purpose. Each one was handed to Stream once (/api/stream/preview) and this
 * is the map: file name → Stream id. SiteMedia looks a clip up by its file
 * name and plays the adaptive copy from the edge, with the mp4 kept as the
 * fallback. A clip not in the map plays as before.
 *
 * Adding a clip: put the file in the bucket, ask /api/stream/preview for it
 * with claim=1 from a signed-in dashboard tab, and add the id here.
 */
export const STREAM_BASE = 'https://customer-g32uhnka70ibwlas.cloudflarestream.com'

export const SITE_STREAM: Record<string, string> = {
  'strategy-waterside.mp4': '63820c9b0df42df294ddc8e0f3da2ba0',
  'Senorita.mp4': 'ad5dfdfc8af7210dcd96e82eaed17e1b',
  'website-landscape.mp4': '0f41bd1aea1f0ec48c8fab933904c055',
  'cecconis.mp4': 'a0552dc54cd4c9da54af62947e5fd4d9',
  'Automodellista.mp4': 'b256a53e8154d76f221787871212338f',
  'hero-spec-ad.mp4': '9f0991271f05e9a62931bfb01ec11f4e',
  'Pattons.mp4': '692eee8144b1010f617bb68402f63a88',
  'jason-hero.mp4': 'aef6e2830c99cb74df743999a14faade',
}

/** the file name a media address ends in, decoded — the map's key */
export function siteFileOf(src: string | null | undefined): string {
  try { return decodeURIComponent(String(src ?? '').split('?')[0].split('/').pop() ?? '') } catch { return '' }
}

/** the clip's stream and its still, or null when the clip is not on Stream */
export function siteStream(src: string | null | undefined): { hls: string; poster: string } | null {
  const uid = SITE_STREAM[siteFileOf(src)]
  if (!uid) return null
  return {
    hls: `${STREAM_BASE}/${uid}/manifest/video.m3u8`,
    poster: `${STREAM_BASE}/${uid}/thumbnails/thumbnail.jpg?time=1s&height=720`,
  }
}
