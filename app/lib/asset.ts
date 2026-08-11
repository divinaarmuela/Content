// Marketing media (video, large files) is served from the Cloudflare R2 public
// bucket, never from /public — R2 egress is free, Vercel fast-data-transfer is
// not, and one autoplaying hero video can burn a month's allowance in days.
// The bucket URL is public information (it appears in every page's HTML), so
// it is safe as a committed default; NEXT_PUBLIC_MEDIA_URL overrides it.
// (Not NEXT_PUBLIC_ASSET_URL — that legacy var points at a different bucket
// that only ever held a handful of files.)
const BASE = (
  process.env.NEXT_PUBLIC_MEDIA_URL
  ?? 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev'
).replace(/\/+$/, '')

/** Absolute URL for a media file in the R2 public bucket. */
export function media(file: string): string {
  return `${BASE}/${encodeURIComponent(file.replace(/^\/+/, ''))}`
}
