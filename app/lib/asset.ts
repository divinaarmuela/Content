// Resolves a public asset path. In production NEXT_PUBLIC_ASSET_URL points at the
// Cloudflare R2 public bucket (e.g. https://pub-xxxx.r2.dev) so large media is
// served from R2 instead of being committed to the repo. When the env var is
// unset (local dev) it falls back to the local /public path, so dev still works.
const BASE = (process.env.NEXT_PUBLIC_ASSET_URL ?? '').replace(/\/+$/, '')

export function asset(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  return BASE ? `${BASE}${clean}` : clean
}
