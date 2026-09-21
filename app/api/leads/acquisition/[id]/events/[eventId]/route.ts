import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Prospect as ProspectRow, ProspectEvent } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../../lib/authz'
import { isOpenFinding } from '../../../../../../lib/acq-agent-core'
import { ACQ_EVENT_KINDS, type AcqEventKind } from '../../../../../../lib/acquisition-core'
import { onReply } from '../../../../../../lib/acquisition'

/**
 * A PERSON ANSWERS A FINDING (acq-agent-core.ts, rule 3). Confirm makes the
 * line count — its points, and the date it proves stamped on the prospect, so
 * the stage's "Move to" opens; the move itself stays the person's press. "Not
 * this" closes it for good. Decided inside a claim: two people answering the
 * same finding answer it once.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id, eventId } = await params
      const body = await req.json().catch(() => ({})) as { confirm?: unknown }
      const yes = body.confirm === true
      const now = new Date().toISOString()
      const events = table<ProspectEvent>('prospect_events')
      const result = await events.claim(eventId, ((cur: ProspectEvent | null): unknown => {
        if (!cur || cur.prospect_id !== id || !isOpenFinding(cur)) return null
        return yes
          ? { ...cur, confirmed: true, by: user.id, points: cur.points ?? ACQ_EVENT_KINDS[cur.kind as AcqEventKind]?.points ?? 0 }
          : { ...cur, dismissed_at: now, dismissed_by: user.id }
      }) as (c: ProspectEvent | null) => ProspectEvent | null)
      if (!result.claimed) return NextResponse.json({ error: 'That finding has already been answered' }, { status: 409 })
      const ev = result.row as ProspectEvent
      if (yes) {
        const prospects = table<ProspectRow>('prospects')
        const at = ev.at ?? now
        const stamp: Record<string, unknown> =
          ev.kind === 'deposit_paid' ? { deposit_paid_at: at }
          : ev.kind === 'signed' ? { signed_at: at }
          : ev.kind === 'not_interested' ? { dormant_at: now, next_action: null }
          : {}
        if (Object.keys(stamp).length > 0) await prospects.update(id, { ...stamp, updated_at: now } as never)
        if (ev.kind === 'not_interested') {
          const p = await prospects.get(id)
          if (p) await onReply(user, p, ev.detail ?? null).catch(e => console.error('[acquisition] pausing the follow-ups failed:', e))
        }
      }
      return NextResponse.json({ event: ev })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
