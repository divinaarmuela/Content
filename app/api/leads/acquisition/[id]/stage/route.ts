import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { table, withRequestCache, DbError } from '@/lib/db'
import type { Client, Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import {
  acqMoveRefusal, acqMoveStamps, acqStageByKey, eventForMove, nextAcqStage, previousAcqStage, type AcqStageKey, type Prospect,
} from '../../../../../lib/acquisition-core'
import { logAcqEvent, onOutreachSent, onReadyForContent } from '../../../../../lib/acquisition'

/**
 * A PROSPECT MOVES (the acquisition blueprint, 21 Sep 2026). Forward one
 * stage, only when the stage's data is captured — decided on the row as it
 * is, inside a claim, never on what the page believed. Back one stage for a
 * hand that slipped. "Not now" parks it with a 90-day re-open date; "dormant"
 * is the blueprint's Day 21; "reopen" brings either back.
 *
 * A move tells the next person (§12): research done → Divina and Martin;
 * outreach sent → the Day 1 to 21 reminders. The handoff makes the client.
 */
export const dynamic = 'force-dynamic'

type Action = 'move' | 'back' | 'not_now' | 'dormant' | 'reopen'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { action?: unknown }
      const action: Action = ['back', 'not_now', 'dormant', 'reopen'].includes(String(body.action)) ? body.action as Action : 'move'
      const prospects = table<ProspectRow>('prospects')
      const now = new Date().toISOString()

      // THE HANDOFF MAKES THE CLIENT first, so the move's own rule ("the client it became") is met by a fact
      if (action === 'move') {
        const cur = await prospects.get(id, { fresh: true }) as (ProspectRow & Prospect) | null
        if (!cur) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
        if (acqStageByKey(cur.stage).key === 'signed' && !cur.client_id) {
          const made = await makeClient(cur)
          if ('error' in made) return NextResponse.json({ error: made.error }, { status: made.status })
          await prospects.update(id, { client_id: made.id, updated_at: now } as never)
        }
      }

      let from: AcqStageKey = 'target'
      let to: AcqStageKey | null = null
      const result = await prospects.claim(id, ((cur: ProspectRow | null): unknown => {
        if (!cur) return null
        const p = cur as ProspectRow & Prospect
        from = acqStageByKey(p.stage).key
        if (action === 'not_now') return { ...cur, not_now_at: now, reopen_at: new Date(Date.now() + 90 * 86_400_000).toISOString(), updated_at: now }
        if (action === 'dormant') return { ...cur, dormant_at: now, reopen_at: new Date(Date.now() + 90 * 86_400_000).toISOString(), updated_at: now }
        if (action === 'reopen') return { ...cur, not_now_at: null, dormant_at: null, reopen_at: null, stage_entered_at: now, updated_at: now }
        if (action === 'back') {
          const prev = previousAcqStage(from)
          if (!prev) return null
          to = prev.key
          return { ...cur, stage: prev.key, stage_entered_at: now, updated_at: now }
        }
        const next = nextAcqStage(from)
        if (!next || acqMoveRefusal(p)) return null
        to = next.key
        return { ...cur, ...acqMoveStamps(p, next.key, now), updated_at: now }
      }) as (c: ProspectRow | null) => ProspectRow | null)

      if (!result.claimed) {
        const cur = result.current as (ProspectRow & Prospect) | null
        if (!cur) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
        if (action === 'back') return NextResponse.json({ error: 'This is the first stage' }, { status: 400 })
        return NextResponse.json({ error: acqMoveRefusal(cur) ?? 'This is the last stage' }, { status: 400 })
      }

      const row = result.row as ProspectRow & Prospect
      const who = user.name || user.email
      if (action === 'not_now') await logAcqEvent({ prospectId: id, kind: 'stage', by: user.id, detail: `Parked as “not now” by ${who} — re-opens in 90 days` })
      else if (action === 'dormant') await logAcqEvent({ prospectId: id, kind: 'stage', by: user.id, detail: `Marked dormant by ${who} — recycle in 90 days` })
      else if (action === 'reopen') await logAcqEvent({ prospectId: id, kind: 'stage', by: user.id, detail: `Brought back by ${who}` })
      else if (to) {
        const moved: AcqStageKey = to
        await logAcqEvent({ prospectId: id, kind: action === 'back' ? 'stage' : eventForMove(moved), by: user.id, detail: `${action === 'back' ? 'Moved back' : 'Moved'} to ${acqStageByKey(moved).label} by ${who}` })
        // the next person's turn (§12) — best effort: a failed email never undoes a move
        try {
          if (action === 'move' && moved === 'content') await onReadyForContent(user, row)
          if (action === 'move' && moved === 'outreach') await onOutreachSent(user, row)
        } catch (e) { console.error('[acquisition] the move’s prompts failed:', e) }
      }
      return NextResponse.json({ prospect: row })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** the client a signed prospect becomes — the existing one when the name or the email already is one */
async function makeClient(p: ProspectRow & Prospect): Promise<{ id: string } | { error: string; status: number }> {
  const name = String(p.business ?? '').trim()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const existing = (await table<Client>('clients').list({ where: c => c.slug === slug || (!!p.email && c.email === p.email), limit: 1 }))[0]
  if (existing) return { id: existing.id }
  try {
    const client = await table<Client>('clients').insert({
      name, slug, contact_name: p.contact_name ?? null, email: p.email ?? null, phone: p.phone ?? null,
      website: p.website ?? null, industry: p.industry ?? null, status: 'active', source: 'acquisition',
      notes: [p.audit_angle && `Audit angle: ${p.audit_angle}`, p.deal_value && `First deal: $${p.deal_value}`, 'Handed off from the acquisition pipeline'].filter(Boolean).join('\n'),
      share_token: randomUUID(),
    } as never)
    return { id: client.id }
  } catch (e) {
    const dup = e instanceof DbError && e.code === 'unique'
    return { error: dup ? 'A client with this name already exists — link it on the prospect first' : (e as Error).message, status: dup ? 409 : 500 }
  }
}
