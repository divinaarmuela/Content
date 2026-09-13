import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { shootManager } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { canManageShoot, peopleOnShoot, withAck, withoutAck } from '../../../../../lib/shoot-sop-core'
import { ackSecret, verifyAckToken } from '../../../../../lib/shoot-ack-token'
import { escapeHtml } from '../../../../../lib/mailer'

/**
 * "I'VE READ THE PLAN" — without the shoot page (13 Sep 2026).
 *
 *   POST    the editor, from their card on the Editor page
 *   GET     a crew member, from the one-press link in their email (a signed
 *           per-person token; nothing to log in to)
 *   DELETE  a manager takes one back
 *
 * Idempotent every way — the list is rewritten inside a claim, so two
 * presses or a press during a crew change cannot lose anybody else's
 * acknowledgement. Both presses are logged as the shoot's acknowledgement,
 * so "3 of 5 read it" counts them together.
 */
async function record(batchId: string, userId: string, actor: TeamUser | null, how: string) {
  const batches = table<Batch>('batches')
  const batch = await batches.get(batchId)
  if (!batch) return { status: 404 as const, error: 'Shoot not found' }
  if (!peopleOnShoot(batch).includes(userId)) {
    return { status: 403 as const, error: 'You are not on this shoot — the account manager adds the people who need to read the plan' }
  }
  const now = new Date().toISOString()
  const done = await batches.claim(batchId, cur => (cur ? { ...cur, acknowledgements: withAck(cur, userId, now) } : null))
  if (!done.claimed) return { status: 409 as const, error: 'Could not save — try again' }
  await logActivity({
    actor: actor as never, clientId: batch.client_id, entityType: 'batch', entityId: batchId,
    action: 'brief_acknowledged', detail: how, newValue: userId,
  })
  announceBatchChange({ batch_id: batchId, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
  return { status: 200 as const, row: done.row }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const r = await record(id, user.id, user as unknown as TeamUser, 'read the plan on their card')
    if (r.status !== 200) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json(r.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

const page = (title: string, body: string, status = 200) => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>` +
  '<style>body{margin:0;background:#f6f3ec;font:16px/1.5 system-ui,sans-serif;color:#1c1b19}main{max-width:520px;margin:12vh auto;padding:0 24px}h1{font-size:26px;margin:0 0 12px}p{margin:0 0 8px}</style></head>' +
  `<body><main><h1>${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
)

/** The crew member's one press: the signed link from their email. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const { id } = await params
    const token = new URL(req.url).searchParams.get('token') ?? ''
    const check = verifyAckToken(token, ackSecret())
    if (!check.ok || check.shootId !== id) {
      return page(
        check.ok ? 'This link is for another shoot' : check.reason === 'expired' ? 'This link has expired' : 'This link does not work',
        'Ask the account manager to share the plan again and you will get a fresh link.', 400,
      )
    }
    const person = await table<TeamUser>('team_users').get(check.userId)
    if (!person || person.active_status !== true) return page('This link does not work', 'Ask the account manager to share the plan again.', 400)
    const r = await record(id, person.id, person, 'read the plan from the email link')
    if (r.status !== 200) return page('Could not record it', escapeHtml(r.error), r.status)
    return page('Thanks — you’ve read the plan', `${escapeHtml(person.name || person.email)}, you are marked as having read the plan for <strong>${escapeHtml(r.row.title)}</strong>. Nothing else to do.`)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return page('Could not record it', escapeHtml(error), status)
  }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const who = String(body.user_id ?? '')
    if (!who) return NextResponse.json({ error: 'Say whose acknowledgement to take back' }, { status: 400 })
    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!canManageShoot(await shootManager(user), batch)) {
      return NextResponse.json({ error: 'Only the account manager on this shoot can take an acknowledgement back' }, { status: 403 })
    }
    const done = await batches.claim(id, cur => (cur ? { ...cur, acknowledgements: withoutAck(cur, who) } : null))
    if (!done.claimed) return NextResponse.json({ error: 'Could not save — try again' }, { status: 409 })
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'brief_acknowledgement_undone', newValue: who,
    })
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
    return NextResponse.json(done.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
