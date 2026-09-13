import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, TeamUser as TeamUserRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { isQualityReviewer } from '../../../../../lib/identity-core'
import { STAND_IN_MARK } from '../../../../../lib/card-history-core'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { notifyPlanReviewed } from '../../../../../lib/shoot-sop-notify'
import { planReviewPatch, planSendBackPatch } from '../../../../../lib/shoot-sop-core'

/**
 * THE QUALITY CHECKER'S ANSWER ON A PLAN (the owner, 13 Sep 2026: "shoot
 * briefs … must go through quality review too … not for super admins").
 * `{ pass: true }` stamps the plan as passed; `{ pass: false, note }` clears
 * any pass, writes the note as a shoot comment tagged to whoever asked, and
 * emails them. Only a quality checker (the role or the flag) or a super
 * admin may answer; a super admin without the hat is written into the
 * history as a stand-in, the same words the content check uses.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    if (!isQualityReviewer(user) && user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Passing a plan is for the quality checker' }, { status: 403 })
    }
    const { id } = await params
    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })

    const body = await req.json().catch(() => ({})) as { pass?: unknown; note?: unknown }
    const pass = body.pass === true
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    if (!pass && !note) return NextResponse.json({ error: 'Say what to change — one line is enough' }, { status: 400 })

    const now = new Date().toISOString()
    // a send-back closes the ask too, so the shoot leaves the Quality review column
    const patch = pass ? planReviewPatch(now, user.id, true) : planSendBackPatch(now, user.id, note)
    const done = await batches.claim(id, cur => (cur ? { ...cur, ...(patch as Partial<Batch>) } : null))
    if (!done.claimed) return NextResponse.json({ error: 'Could not save — try again' }, { status: 409 })

    const standIn = user.role === 'super_admin' && !isQualityReviewer(user)
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'sop_plan_reviewed',
      detail: `${pass ? 'Passed quality review' : `Sent back: ${note}`}${standIn ? ` · ${STAND_IN_MARK}` : ''}`,
    })

    // who is told: whoever asked, and the plan's owner and creator
    const toIds = [...new Set([batch.review_asked_by, batch.owner_id, batch.created_by].filter((x): x is string => !!x))]
    let commentId: string | null = null
    if (!pass) {
      try {
        const row = await table('batch_comments').insert({
          batch_id: id, author_id: user.id, body: `Plan sent back: ${note}`,
          assigned_to: batch.review_asked_by ?? batch.owner_id ?? batch.created_by ?? null,
          resolved: false, card_id: null,
        })
        commentId = String((row as { id?: string }).id ?? '') || null
      } catch (e) {
        console.error('plan review comment:', e)
      }
    }
    const told = await notifyPlanReviewed(user, done.row, pass, note || null, toIds).catch(e => { console.error('plan review notify:', e); return 0 })
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
    // the people rows are read only to name the stand-in in the answer
    void table<TeamUserRow>('team_users')
    return NextResponse.json({ ...done.row, passed: pass, told, comment_id: commentId, stand_in: standIn })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
