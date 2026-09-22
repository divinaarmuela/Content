import { table } from '@/lib/db'
import type { Prospect as ProspectRow } from '@/lib/db-types'
import { recordLinkClick } from '../../../lib/acquisition'
import { destinationFor, isLinkPreviewBot, isProspectId, isTrackedKind, withUtm } from '../../../lib/tracked-link-core'

/**
 * A TRACKED LINK, FOLLOWED (the acquisition blueprint, §8). The address in
 * the DM or email is ours; this sends the person on to the prospect's Loom,
 * audit post or booking page and records the click on the prospect — the
 * first click is the intent signal that makes a target a lead.
 *
 * PUBLIC on purpose: the prospect is not signed in. It answers only for a
 * prospect that exists and only with that prospect's own link, so the worst
 * a guessed address does is bounce to a page the prospect was already sent.
 * A messenger's preview fetch is sent on without a mark (tracked-link-core).
 * Recording never blocks the redirect: a click the timeline missed is a
 * smaller failure than a prospect staring at an error.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params
  if (!isProspectId(id) || !isTrackedKind(kind)) return new Response('Not found', { status: 404 })
  const p = await table<ProspectRow>('prospects').get(id).catch(() => null)
  const to = p ? destinationFor(p as never, kind) : null
  if (!p || !to) return new Response('Not found', { status: 404 })

  if (!isLinkPreviewBot(req.headers.get('user-agent'))) {
    try { await recordLinkClick(p, kind) } catch (e) { console.error('[acquisition] click not recorded:', e) }
  }
  return new Response(null, {
    status: 302,
    headers: { Location: withUtm(to, String((p as { business?: string }).business ?? 'prospect')), 'Cache-Control': 'no-store' },
  })
}
