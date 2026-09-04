import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { smallerCopyOf } from '../../../lib/stream'
import { isPlatform, type PostKind } from '../../../lib/publish-core'

/**
 * A publish-grade copy of an uploaded video, for a channel that cannot take
 * the master. Polled by the composer; each call reports where the copy has
 * got to.
 *
 * The CHANNEL matters: the bitrate the copy is made at is derived from that
 * channel's own size and length limits, so a copy made for Instagram is not
 * the same file as one made for X. When the composer does not say, Instagram
 * is assumed — the tightest of the channels a master is usually too big for.
 */
export async function POST(req: Request) {
  try {
    await requireRole('scheduler')
    const body = await req.json().catch(() => ({})) as {
      url?: unknown; platform?: unknown; kind?: unknown; seconds?: unknown
    }
    const url = String(body.url ?? '').trim()
    if (!/^https:\/\//.test(url)) return NextResponse.json({ error: 'Not a video we hold' }, { status: 400 })

    const asked = String(body.platform ?? '')
    const platform = isPlatform(asked) ? asked : 'instagram'
    const kind = typeof body.kind === 'string' ? (body.kind as PostKind) : undefined
    const seconds = typeof body.seconds === 'number' && body.seconds > 0 ? body.seconds : undefined

    return NextResponse.json(await smallerCopyOf(url, platform, kind, seconds))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
