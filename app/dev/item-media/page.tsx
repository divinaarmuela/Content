import { notFound } from 'next/navigation'
import Harness from './Harness'

/**
 * The item page's media, on a page with no Clerk session behind it.
 *
 * `scripts/check-item-media.mjs` loads this in a clean browser and measures
 * what the item page costs to open: bytes on the wire and the longest task
 * on the main thread. It exists because "May Shoot 05" — one 184 MB .mov cut
 * and three source files of 100–400 MB on R2 — froze a Chrome tab for half a
 * minute, and the real page cannot be loaded by a script (it needs a person's
 * sign-in).
 *
 * Off unless DEV_HARNESS=1 is set on the server. It is never on in
 * production: the route is not in the middleware allowlist, so the flag is
 * the only gate, and nothing here is data — the URLs are public R2 objects.
 */
export const dynamic = 'force-dynamic'

export default function ItemMediaHarnessPage() {
  if (process.env.DEV_HARNESS !== '1' || process.env.NODE_ENV === 'production' && process.env.VERCEL) notFound()
  return <Harness />
}
