import { NextResponse } from 'next/server'
import { manifestFor } from '../lib/app-icon-core'

/**
 * THE WEB MANIFEST (the owner, 23 Sep 2026: "an icon on the phone like an
 * app"). Android and desktop Chrome read this to install the app: its name,
 * its icon, and `display: standalone`, which is what removes the address bar.
 *
 * Answered per host because www and app are one deployment: added from
 * app.mdmmarketing.com.au it opens on the dashboard, from the marketing site
 * on the homepage. Public by design — a phone fetches it before anyone signs
 * in (middleware.ts gates an explicit list; this is not on it).
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const host = req.headers.get('host') ?? new URL(req.url).host
  return NextResponse.json(manifestFor(host), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
