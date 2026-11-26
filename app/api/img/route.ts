import { NextResponse } from 'next/server'
import { thumbPlan } from '../../lib/board-thumb-core'
import { putObjectAt, r2Configured } from '../../lib/storage'

/**
 * A SMALL COPY OF A BOARD PICTURE (the owner, 26 Nov 2026: a board "lags heavily when going around the canvas" —
 * see board-thumb-core for what was measured).
 *
 *   GET /api/img?u=<a picture in our own storage>&w=640|1280   →   302 to the small copy
 *
 * The first time a picture is asked for, it is fetched, shrunk to that width (never enlarged), saved beside the
 * original under a name worked out from its address, and the answer is a redirect to that saved copy. Every time
 * after, the copy is already there and this only redirects — so a picture is shrunk once, ever, whatever is deployed.
 *
 * PUBLIC, because a client's portal draws boards without a login. What keeps it safe is `thumbPlan`: it only ever
 * fetches an address inside our own storage, at one of two widths. Anything else is refused, never fetched.
 *
 * NEVER BREAKS A PICTURE: if the copy cannot be made (a format the resizer cannot read, the original too large,
 * storage not answering) the answer is a redirect to the original, which is what the board drew before this existed.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** an original larger than this is not pulled into memory to shrink; the board shows it as it is */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024
const WEEK = 'public, max-age=604800'
const BRIEFLY = 'public, max-age=300'

const to = (url: string, cache: string) => new NextResponse(null, { status: 302, headers: { Location: url, 'Cache-Control': cache } })

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const base = process.env.R2_PUBLIC_BASE_URL
  const plan = thumbPlan(q.get('u'), q.get('w'), base)
  if (!plan.ok || !base) return NextResponse.json({ error: 'Not a picture in our storage' }, { status: 400 })
  const copy = `${base.replace(/\/$/, '')}/${plan.key}`

  try {
    // already made? then this is only a signpost
    const have = await fetch(copy, { method: 'HEAD', signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (have?.ok) return to(copy, WEEK)
    if (!r2Configured()) return to(plan.source, BRIEFLY)

    const res = await fetch(plan.source, { signal: AbortSignal.timeout(25000) })
    if (!res.ok) return to(plan.source, BRIEFLY)
    if (Number(res.headers.get('content-length') ?? 0) > MAX_SOURCE_BYTES) return to(plan.source, WEEK)
    const original = Buffer.from(await res.arrayBuffer())
    if (original.byteLength > MAX_SOURCE_BYTES) return to(plan.source, WEEK)

    const sharp = (await import('sharp')).default
    const small = await sharp(original, { failOn: 'none' })
      .rotate()                                        // a phone photo's "this way up" note, applied before it is lost
      .resize({ width: plan.width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    // a picture that was already small and tight gains nothing from a copy
    if (small.byteLength >= original.byteLength) return to(plan.source, WEEK)

    await putObjectAt(plan.key, small, 'image/webp')
    return to(copy, WEEK)
  } catch (e) {
    console.error('[img] small copy not made, showing the original', plan.source, e)
    return to(plan.source, BRIEFLY)
  }
}
