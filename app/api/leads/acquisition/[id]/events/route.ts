import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { LOGGABLE_KINDS, acqStageByKey, isAcqEventKind, type Prospect } from '../../../../../lib/acquisition-core'
import { logAcqEvent, onContentReady, onReply } from '../../../../../lib/acquisition'

/**
 * SOMETHING HAPPENED (the acquisition blueprint, 21 Sep 2026): a person logs
 * a signal on the prospect's timeline — a reply, a click, a booked call, a
 * follow-up sent, "not interested", a note — and the score follows, because
 * the score IS the timeline's points.
 *
 * Two of them do more (§12): "content ready" tells Joy and makes her outreach
 * task; a REPLY stamps the reply, moves an outreach-stage target into New
 * lead / Engaged, and pauses the no-response reminders.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { kind?: unknown; detail?: unknown }
      const kind = body.kind
      if (!isAcqEventKind(kind) || !([...LOGGABLE_KINDS, 'content_ready', 'fit', 'weak_presence'] as readonly string[]).includes(kind)) {
        return NextResponse.json({ error: 'That is not something a person logs' }, { status: 422 })
      }
      const detail = String(body.detail ?? '').trim().slice(0, 2000) || null
      if (kind === 'note' && !detail) return NextResponse.json({ error: 'Write the note' }, { status: 422 })
      const prospects = table<ProspectRow>('prospects')
      const p = await prospects.get(id) as (ProspectRow & Prospect) | null
      if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })

      const now = new Date().toISOString()
      const event = await logAcqEvent({ prospectId: id, kind, by: user.id, detail })

      if (kind === 'content_ready') {
        try { await onContentReady(user, p) } catch (e) { console.error('[acquisition] telling Joy failed:', e) }
      }
      if (kind === 'reply') {
        // a target that answers IS a lead: claimed, so two people logging the same reply move it once
        const moved = await prospects.claim(id, ((cur: ProspectRow | null): unknown => {
          const row = cur as (ProspectRow & Prospect) | null
          if (!row) return null
          const atOutreach = acqStageByKey(row.stage).key === 'outreach'
          return { ...row, replied_at: row.replied_at ?? now, ...(atOutreach ? { stage: 'engaged', stage_entered_at: now } : {}), updated_at: now }
        }) as (c: ProspectRow | null) => ProspectRow | null)
        if (moved.claimed && acqStageByKey(p.stage).key === 'outreach') {
          await logAcqEvent({ prospectId: id, kind: 'stage', by: user.id, source: 'system', detail: 'Moved to New lead / Engaged — they replied' })
        }
        try { await onReply(user, p, detail) } catch (e) { console.error('[acquisition] pausing the follow-ups failed:', e) }
      }
      if (kind === 'not_interested') {
        await prospects.update(id, { dormant_at: now, next_action: null, updated_at: now } as never)
        try { await onReply(user, p, detail) } catch (e) { console.error('[acquisition] pausing the follow-ups failed:', e) }
      }
      return NextResponse.json({ event }, { status: 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
