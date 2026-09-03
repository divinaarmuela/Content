import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, Client, ContentItem, ShootProposal, TeamUser } from '@/lib/db-types'
import { requireRole, roleSatisfies, authzErrorResponse } from '../../../../lib/authz'
import { canOpenBatch } from '../../../../lib/production-access'
import { logActivity } from '../../../../lib/workflow'
import { announceBatchChange } from '../../../../lib/production-live'
import { onShootDateChanged } from '../../../../lib/gdrive-hooks'
import {
  applyCanvasOp, sanitisePlannedDeliverables, sanitiseReferenceMedia, sanitiseShotList,
} from '../../../../lib/batch-brief-core'

/** Load a brief the caller may touch, or answer with the right refusal. */
async function loadBatch(user: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const found = await table<Batch>('batches').get(id)
  if (!found) return { response: NextResponse.json({ error: 'Shoot not found' }, { status: 404 }) }
  const batch = (await attachOne([found], 'client_id', 'clients', ['name']))[0]
  // client membership, having created the shoot, or holding a job on it
  // (the brief task handed to someone off the client team) all open the plan
  if (!(await canOpenBatch(user, batch))) {
    return { response: NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 }) }
  }
  return { batch }
}

/** One brief, with its items — the working surface's data. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response

    // ONE read of the people table serves both names below; the other three
    // reads are of three different tables, so the whole page costs four.
    const [itemRows, people, proposal] = await Promise.all([
      table<ContentItem>('content_items').list({
        by: { batch_id: id }, orderBy: [['created_at', 'asc']], limit: 100,
      }),
      table<TeamUser>('team_users').list(),
      loaded.batch.proposal_id
        ? table<ShootProposal>('shoot_proposals').get(loaded.batch.proposal_id)
        : Promise.resolve(null),
    ])
    const items = await attachOne(itemRows, 'work_kind_id', 'work_kinds', ['slug'])
    const personById = new Map(people.map(u => [u.id, u]))
    const lockedBy = loaded.batch.locked_by ? personById.get(loaded.batch.locked_by) ?? null : null
    const editedBy = loaded.batch.last_edited_by ? personById.get(loaded.batch.last_edited_by) ?? null : null
    // the client's portal link, for the "Copy portal link" button — an AM
    // shares it deliberately; the token never reaches editor/scheduler payloads
    const tokenRow = roleSatisfies(user.role, 'account_manager')
      ? await table<Client>('clients').get(loaded.batch.client_id)
      : null

    return NextResponse.json({
      batch: loaded.batch,
      portal_token: tokenRow?.share_token ?? null,
      items,
      locked_by_name: lockedBy?.name || lockedBy?.email || null,
      last_edited_by_name: editedBy?.name || editedBy?.email || null,
      last_edited_at: loaded.batch.last_edited_at ?? null,
      proposal: proposal ?? null,
      viewer_role: user.role,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Field-level edits — the browser sends ONLY the field that changed, so two
 *  people editing different parts of a brief cannot clobber each other's
 *  jsonb wholesale. Status never moves here; that is the transition route. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response
    const batch = loaded.batch
    const body = await req.json()

    // an AM changing a LOCKED date is its own audited act, with a reason
    if (body.action === 'change_date') {
      if (!roleSatisfies(user.role, 'account_manager')) {
        return NextResponse.json({ error: 'Only an account manager can change a booked date' }, { status: 403 })
      }
      const reason = String(body.reason ?? '').trim()
      const newDate = String(body.shoot_date ?? '').trim()
      if (!reason) return NextResponse.json({ error: 'Say why the date is moving — the team sees this' }, { status: 422 })
      if (!newDate || Number.isNaN(new Date(newDate).getTime())) {
        return NextResponse.json({ error: 'Pick a valid date' }, { status: 422 })
      }
      const d = new Date(newDate)
      const data = await table('batches')
        .update(id, { shoot_date: newDate, month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }) as unknown as Batch
      await logActivity({
        actor: user, clientId: batch.client_id,
        entityType: 'batch', entityId: id, action: 'date_changed',
        oldValue: batch.shoot_date ?? '', newValue: newDate, detail: reason,
      })
      announceBatchChange({ batch_id: id, client_id: batch.client_id, status: data.status ?? 'brief', kind: 'updated' })
      // the folder leads with the month; the month just changed
      onShootDateChanged(data)
      return NextResponse.json(data)
    }

    const patch: Record<string, unknown> = {}
    // board edits arrive as per-card ops and merge server-side, so two people
    // moving different cards both win. Per-card last-write-wins; the small
    // read-modify-write window is accepted for v1 (realtime reload keeps
    // collisions rare; a jsonb-merge SQL function is the future tightening).
    if (body.canvas_op && typeof body.canvas_op === 'object') {
      patch.canvas_cards = applyCanvasOp(batch.canvas_cards, {
        upsert: (body.canvas_op as { upsert?: unknown }).upsert,
        remove: (body.canvas_op as { remove?: unknown }).remove,
      })
    }
    if ('title' in body) {
      const t = String(body.title ?? '').trim().slice(0, 120)
      if (!t) return NextResponse.json({ error: 'A shoot needs a title' }, { status: 422 })
      patch.title = t
    }
    if ('description' in body) patch.description = String(body.description ?? '').slice(0, 2000) || null
    if ('concept' in body) patch.concept = String(body.concept ?? '').slice(0, 8000) || null
    if ('location' in body) patch.location = String(body.location ?? '').slice(0, 300) || null
    if ('shot_list' in body) patch.shot_list = sanitiseShotList(body.shot_list)
    if ('planned_deliverables' in body) patch.planned_deliverables = sanitisePlannedDeliverables(body.planned_deliverables)
    if ('reference_media' in body) patch.reference_media = sanitiseReferenceMedia(body.reference_media)
    if ('owner_id' in body) {
      if (!roleSatisfies(user.role, 'account_manager')) {
        return NextResponse.json({ error: 'Only an account manager can change the owner' }, { status: 403 })
      }
      patch.owner_id = body.owner_id || null
    }
    if ('shared_with_client' in body) {
      // showing a shoot plan on the client portal is an AM call
      if (!roleSatisfies(user.role, 'account_manager')) {
        return NextResponse.json({ error: 'Only an account manager can share a shoot with the client' }, { status: 403 })
      }
      patch.shared_with_client = body.shared_with_client === true
    }
    if ('share_board' in body) {
      // the working board is shared separately from the brief — an AM call too
      if (!roleSatisfies(user.role, 'account_manager')) {
        return NextResponse.json({ error: 'Only an account manager can share the board with the client' }, { status: 403 })
      }
      patch.share_board = body.share_board === true
    }
    if ('board_name' in body) {
      patch.board_name = String(body.board_name ?? '').trim().slice(0, 80) || null
    }
    if ('shoot_date' in body) {
      // freely editable while still a plan; once locked, the date is a
      // commitment and moves only through change_date above
      if (batch.status !== 'brief') {
        return NextResponse.json({ error: 'The shoot is booked — use "Change date" (account managers)' }, { status: 409 })
      }
      const d = body.shoot_date ? String(body.shoot_date) : ''
      if (d) {
        // a bad or out-of-range date reaches the year check-constraint and 500s
        // when locking; validate it here where we can give a real message
        const t = new Date(`${d}T00:00:00`)
        const yr = t.getUTCFullYear()
        if (Number.isNaN(t.getTime()) || yr < 2024 || yr > 2100) {
          return NextResponse.json({ error: 'Enter a valid shoot date' }, { status: 422 })
        }
      }
      patch.shoot_date = d || null
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    }

    const data = await table('batches').update(id, patch) as unknown as Batch
    // stamp who last edited — best-effort, so a failure here never loses the
    // edit the user just made
    try {
      await table('batches').update(id, { last_edited_by: user.id, last_edited_at: new Date().toISOString() })
    } catch { /* the edit itself already landed */ }
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: data.status ?? 'brief', kind: 'updated' })
    // a shoot folder is named by its MONTH, and a plan with no date yet was
    // filed under the month it was raised in — put it right the moment the
    // date exists
    if ('shoot_date' in patch) onShootDateChanged(data)
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Delete a brief that never became anything: still in planning, no items. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response

    // a shoot that produced NO items can always be deleted (nothing to orphan);
    // one that produced work must be wrapped instead. Read
    // the error too: a failed count must NOT be treated as "zero items" and
    // silently orphan every item to batch_id = null
    const count = await table<ContentItem>('content_items').count({ by: { batch_id: id } })
    if (count > 0) {
      return NextResponse.json({ error: 'This shoot has content items — wrap it instead of deleting' }, { status: 409 })
    }
    await table('batches').remove(id)
    await logActivity({
      actor: user, clientId: loaded.batch.client_id,
      entityType: 'batch', entityId: id, action: 'deleted', oldValue: loaded.batch.title,
    })
    announceBatchChange({ batch_id: id, client_id: loaded.batch.client_id, status: 'brief', kind: 'deleted' })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
