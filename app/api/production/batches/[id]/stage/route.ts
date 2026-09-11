import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { ensureShootCard } from '../../../../../lib/plan-cards'
import { onShootDateChanged } from '../../../../../lib/gdrive-hooks'
import { notifyBatchTransition } from '../../../../../lib/workflow'
import { notifyBriefShared, notifyGoOverride, notifyShootReminder } from '../../../../../lib/shoot-sop-notify'
import { fillFootageFolder, handOverAtGo, handOverCards, notifyFootageIn } from '../../../../../lib/shoot-handover'
import {
  SHOOT_STAGES, shootStage, stageMove, type ShootStage,
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
 * the editor is told. Both halves are idempotent (one fixed card id per shoot; only
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
    const overrideReason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : null
    const move = stageMove(batch, to, { role: user.role, today, checklist: { itemCount }, overrideReason }, now, user.id)
    // NO BRIEF, NO SHOOT: a plan shared late is refused; the sentence says a
    // super admin can go ahead with a reason, and this is the request that
    // was missing one — a 400, not a rule they can never satisfy
    if (!move.ok) return NextResponse.json({ error: move.reason, needsOverride: move.needsOverride === true }, { status: move.needsOverride ? 400 : 422 })

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
    // shoot gets its one card, the team is told, the Drive folder is named
    // by the month. Best-effort, as they are on the transition route.
    if (to === 'confirmed' && batch.status === 'brief' && updated.status === 'locked') {
      await logActivity({
        actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
        action: 'status_change', oldValue: 'brief', newValue: 'locked', detail: 'Book the shoot (with go)',
      })
      try { await ensureShootCard(user, updated) } catch (e) { console.error('plan cards after go:', e) }
      notifyBatchTransition(user, updated, 'brief', 'locked')
      onShootDateChanged(updated)
    }
    if (to === 'confirmed' && updated.go_override_reason && updated.go_override_by === user.id) {
      await logActivity({
        actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
        action: 'sop_go_override', detail: String(updated.go_override_reason),
      })
      await notifyGoOverride(user, updated).catch(e => console.error('go override notify:', e))
    }
    let handed: { total: number } | null = null
    // GO IS THE HANDOVER (11 Sep 2026): the card is the editor's from the
    // moment the shoot is confirmed — the footage follows the shoot, and the
    // morning after it the sweep says so. No drag, no press.
    if (to === 'confirmed') {
      handed = await handOverAtGo(user, updated)
    }
    if (to === 'shared') {
      await notifyBriefShared(user, updated).catch(e => console.error('brief shared notify:', e))
    }
    if (to === 'reminder_sent') {
      await notifyShootReminder(user, updated).catch(e => console.error('reminder notify:', e))
    }
    if (to === 'footage_handed') {
      handed = await handOverCards(user, updated, 'footage from')
      await fillFootageFolder(updated).catch(e => console.error('footage folder fill:', e))
      await notifyFootageIn(user, updated, handed, false).catch(e => console.error('footage notify:', e))
    }
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: updated.status ?? 'brief', kind: 'updated' })
    return NextResponse.json({ ...updated, stage: to, moved: move.label, handed })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
