import { NextResponse } from 'next/server'
import { logClickAndResolve } from '../../lib/tracker'

/**
 * PUBLIC — the tracked link. /go/<slug> logs the click server-side (the
 * evidence record) and forwards the visitor with the asset and click identity
 * in the query string. Never cached: every hit must be counted.
 *
 * An unknown slug lands on the marketing site rather than a 404 — a broken
 * printed QR code should still take a customer somewhere useful.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const dest = await logClickAndResolve(slug.toLowerCase())
    return NextResponse.redirect(dest ?? 'https://www.mdmmarketing.com.au', 302)
  } catch (e) {
    console.error('tracked link failed:', e)
    return NextResponse.redirect('https://www.mdmmarketing.com.au', 302)
  }
}
