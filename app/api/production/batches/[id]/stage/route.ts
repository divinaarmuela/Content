import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange, announceItemChange } from '../../../../../lib/production-live'
import { ensurePlanCards } from '../../../../../lib/plan-cards'
import { onShootDateChanged } from '../../../../../lib/gdrive-hooks'
import { notifyBatchTransition } from '../../../../../lib/workflow'
import { notifyBriefShared, notifyFootageHanded, notifyShootReminder } from '../../../../../lib/shoot-sop-notify'
import {
  SHOOT_STAGES, handoverPlan, shootStage, stageMove, type ShootStage,
} from '../../../../../lib/shoot-sop-core'

const melbourneToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

/**
 * Move a shoot along the Shoot Brief SOP — the drag on the Shoot brief
 * boards page, and the buttons on the shoot page (Share, Go, Reminder sent,
 * Footage handed over).
 *
 * The column is never written: the STAMP the column means is, and only if
 * the SOP allows it (`stageMove`). The write is a claim that re-reads the
 * shoot and checks it is still in the column the mover saw, so two people
 * dragging at once produce one move and one plain refusal.
 *
 * Handing the footage over is the bridge to the Editor page: every line of
 * the plan without a card gets one, the shoot's cards are given to the
 * editor with the deadline and the priorities where those are empty, and
 * the editor is told. Both halves are idempotent (a fixed id per line; only
 * empty fields filled), so a second drag creates and changes nothing.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const to = String(body.to ?? '') as ShootStage
    if (!SHOOT_STAGES.some(s => s.key === to)) {
      return NextResponse.json({ error: 'Pick a column' }, { status: 400 })
    }

    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!(await canOpenBatch(user, batch))) {
      return NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 })
    }

    const today = melbourneToday()
    const now = new Date().toISOString()
    const itemCount = await table<ContentItem>('content_items').count({ by: { batch_id: id } })
    const move = stageMove(batch, to, { role: user.role, today, checklist: { itemCount } }, now, user.id)
    if (!move.ok) return NextResponse.json({ error: move.reason }, { status: 422 })

    const from = shootStage(batch, today)
    const moved = await batches.claim(id, cur => {
      if (!cur) return null
      // the mover saw the shoot in `from`; a shoot that has moved since is
      // somebody else's move, and this one stands down
      if (shootStage(cur, today) !== from) return null
      return { ...cur, ...(move.patch as Partial<Batch>) }
    })
    if (!moved.claimed) {
      return NextResponse.json({ error: 'Someone else moved this shoot — refresh and try again' }, { status: 409 })
    }
    const updated = moved.row

    await logActivity({
      actor: user, clientId: batch.client_id,
      entityType: 'batch', entityId: id,
      action: 'sop_stage', oldValue: from, newValue: to, detail: move.label,
    })

    // the people are told before the answer comes back: the mail is the
    // handover ("read the brief", "footage is in"), and a failure to tell
    // somebody is logged, never allowed to undo the move
    // go booked the shoot: the same after-effects "Book the shoot" has — the
    // plan's lines become cards, the team is told, the Drive folder is named
    // by the month. Best-effort, as they are on the transition route.
    if (to === 'confirmed' && batch.status === 'brief' && updated.status === 'locked') {
      await logActivity({
        actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
        action: 'status_change', oldValue: 'brief', newValue: 'locked', detail: 'Book the shoot (with go)',
      })
      try { await ensurePlanCards(user, updated) } catch (e) { console.error('plan cards after go:', e) }
      notifyBatchTransition(user, updated, 'brief', 'locked')
      onShootDateChanged(updated)
    }
    let handed: { total: number } | null = null
    if (to === 'shared') {
      await notifyBriefShared(user, updated).catch(e => console.error('brief shared notify:', e))
    }
    if (to === 'reminder_sent') {
      await notifyShootReminder(user, updated).catch(e => console.error('reminder notify:', e))
    }
    if (to === 'footage_handed') {
      handed = await handOver(user, updated)
      await notifyFootageHanded(user, updated, handed).catch(e => console.error('footage notify:', e))
    }
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: updated.status ?? 'brief', kind: 'updated' })
    return NextResponse.json({ ...updated, stage: to, moved: move.label, handed })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/**
 * Production → Editor. Cards for the plan's lines are claimed by their fixed
 * id (a line already carded stands down), then every card on the shoot has
 * its EMPTY owner, due date and brief filled from the shoot — never
 * overwritten. Each fill is a claim on the card that re-checks the field is
 * still empty, so a card somebody assigned meanwhile keeps their choice.
 */
async function handOver(actor: Parameters<typeof ensurePlanCards>[0], batch: Batch): Promise<{ total: number }> {
  try {
    await ensurePlanCards(actor, batch)
  } catch (e) {
    console.error('handover: plan cards', e)
  }
  const items = table<ContentItem>('content_items')
  const rows = await attachOne(
    await items.list({ by: { batch_id: batch.id }, limit: 200 }),
    'work_kind_id', 'work_kinds', ['slug'],
  )
  const plan = handoverPlan(batch, rows as unknown as Parameters<typeof handoverPlan>[1])
  for (const f of plan.fill) {
    const done = await items.claim(f.id, cur => {
      if (!cur) return null
      const next: Partial<ContentItem> = {}
      if (f.patch.owner_id && !cur.owner_id) { next.owner_id = f.patch.owner_id; next.assigned_by = actor.id }
      if (f.patch.due_date && !cur.due_date) next.due_date = f.patch.due_date
      if (f.patch.brief && !String(cur.brief ?? '').trim()) next.brief = f.patch.brief
      return Object.keys(next).length > 0 ? { ...cur, ...next, updated_at: new Date().toISOString() } : null
    })
    if (done.claimed) {
      await logActivity({
        actor, clientId: batch.client_id,
        entityType: 'content_item', entityId: f.id,
        action: 'handed_from_shoot', detail: `footage handed over from ${batch.title}`,
        ...(f.patch.owner_id ? { newValue: f.patch.owner_id } : {}),
      })
      announceItemChange({ item_id: f.id, client_id: batch.client_id, status: done.row.status, kind: 'updated' })
    }
  }
  return { total: plan.total }
}
