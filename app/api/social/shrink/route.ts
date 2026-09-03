import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { smallerCopyOf } from '../../../lib/stream'

/**
 * A smaller copy of an uploaded video, for a channel that cannot take the
 * master. Polled by the composer; each call reports where the copy has got to.
 */
export async function POST(req: Request) {
  try {
    await requireRole('scheduler')
    const body = await req.json().catch(() => ({})) as { url?: unknown }
    const url = String(body.url ?? '').trim()
    if (!/^https:\/\//.test(url)) return NextResponse.json({ error: 'Not a video we hold' }, { status: 400 })
    return NextResponse.json(await smallerCopyOf(url))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
