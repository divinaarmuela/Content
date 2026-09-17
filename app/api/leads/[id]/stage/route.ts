import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '../../../../lib/authz'
import { STAGE_KEYS, moveRefusal, moveStamps, nextStage, previousStage, stageOf, type PipelineLead, type StageKey } from '../../../../lib/pipeline-core'

/**
 * A DEAL MOVES (the acquisition doc, 17 Sep 2026): right only when the exit
 * rule is met — checked here, on the row as it is, never on what the page
 * believed — and never skipping a stage. Back one stage is allowed, for a
 * hand that slipped. "Not now" parks the deal with a 90-day re-open date;
 * "reopen" brings it back to where it was.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') return NextResponse.json({ error: 'Not for clients' }, { status: 403 })
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { to?: unknown; action?: unknown }
    const leads = table<Lead>('leads')
    const now = new Date().toISOString()

    const action = body.action === 'not_now' || body.action === 'reopen' || body.action === 'back' ? body.action : 'move'
    const result = await leads.claim(id, ((cur: Lead | null): unknown => {
      if (!cur) return null
      const lead = cur as unknown as PipelineLead
      if (action === 'not_now') {
        const reopen = new Date(Date.now() + 90 * 86_400_000).toISOString()
        return { ...cur, not_now_at: now, reopen_at: reopen }
      }
      if (action === 'reopen') return { ...cur, not_now_at: null, reopen_at: null, stage_entered_at: now }
      if (action === 'back') {
        const prev = previousStage(stageOf(lead).key)
        return prev ? { ...cur, stage: prev.key, stage_entered_at: now } : null
      }
      const to = typeof body.to === 'string' && (STAGE_KEYS as readonly string[]).includes(body.to) ? body.to as StageKey : nextStage(stageOf(lead).key)?.key
      if (!to) return null
      const next = nextStage(stageOf(lead).key)
      if (!next || next.key !== to) return null
      if (moveRefusal(lead)) return null
      return { ...cur, ...moveStamps(to, now) }
    }) as (c: Lead | null) => Lead | null)
    if (!result.claimed) {
      const cur = result.current as unknown as PipelineLead | null
      if (!cur) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      if (action === 'back') return NextResponse.json({ error: 'This is the first stage' }, { status: 400 })
      const why = moveRefusal(cur) ?? 'A deal moves one stage at a time, and only forward'
      return NextResponse.json({ error: why }, { status: 400 })
    }
    return NextResponse.json(result.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
