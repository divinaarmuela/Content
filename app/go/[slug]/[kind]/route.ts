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

/*
 * The folder is [slug], not [id], on purpose: /go/<slug> (the older printed-QR tracker) already owns this
 * level of the path, and Next refuses two different parameter names on one path — `npm run dev` would not
 * start at all ("You cannot use different slug names for the same dynamic path ('id' !== 'slug')") from
 * 21 Sep until 23 Sep 2026. The production build was unaffected and the address is unchanged: checked live
 * on 23 Sep, /go/<prospect>/loom answered from this route, 404 only because that prospect had no Loom link.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug: id, kind } = await params
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
