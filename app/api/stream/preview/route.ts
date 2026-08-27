import { NextResponse } from 'next/server'
import { lookupPreview } from '@/app/lib/stream'

export const dynamic = 'force-dynamic'

/**
 * "Is there a playable copy of this file yet?" — asked by every player.
 *
 * Public, and it has to be: the client portal at `/portal/[token]` has no
 * Clerk session at all, and a client watching a review copy needs the same
 * answer a team member gets. What keeps that safe is that this route grants
 * nothing. It takes a URL the caller must already possess — the R2 object is
 * served from a public bucket, so holding the URL is holding the video — and
 * returns only whether a preview of it exists.
 *
 * With `claim=1` it will also START a preview for a video that has none,
 * which is what covers files uploaded before this feature existed — the first
 * person to open a stuck video begins the fix instead of filing a bug. Two
 * things keep that from being expensive: only a player that has already
 * probed the file and found it unplayable sends `claim=1` (a thumbnail asking
 * for a still never does), and `isOwnStorageUrl` refuses any URL outside our
 * own bucket, so this is not an open button for encoding the internet at our
 * expense.
 *
 * A failure here answers `{configured:false}` rather than an error status.
 * The player reads that as "no opinion" and falls back to exactly what it did
 * before Stream existed — a preview lookup must never be the reason a video
 * that WOULD have played does not.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const url = params.get('url') ?? ''
  if (!url) return NextResponse.json({ configured: false, row: null })
  try {
    return NextResponse.json(await lookupPreview(url, { claim: params.get('claim') === '1' }))
  } catch (e) {
    console.error('[stream] preview lookup:', e)
    return NextResponse.json({ configured: false, row: null })
  }
}
