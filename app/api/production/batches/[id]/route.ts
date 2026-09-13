import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, Client, ContentItem, ShootProposal, TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { canOpenBatch, shootManager } from '../../../../lib/production-access'
import { logActivity } from '../../../../lib/workflow'
import { announceBatchChange } from '../../../../lib/production-live'
import { onShootDateChanged } from '../../../../lib/gdrive-hooks'
import { ensureShootCard } from '../../../../lib/plan-cards'
import { fillFootageFolder, handOverAtGo } from '../../../../lib/shoot-handover'
import { linkKindOf } from '../../../../lib/card-link-core'
import {
  applyCanvasOp, sanitisePlannedDeliverables, sanitiseReferenceMedia, sanitiseShotList,
  shootDeletion,
} from '../../../../lib/batch-brief-core'
import { NOT_YOUR_PAGE, acksOf, canManageShoot, peopleOnShoot } from '../../../../lib/shoot-sop-core'

/**
 * Load a shoot the caller may WORK — the shoot page and every button on it
 * are the manager's (the AM on the client, the shoot's creator, a super
 * admin, a general user). Anyone else, including the editor and the crew,
 * is refused with where to go instead (the owner, 12 Sep 2026: "editors
 * shouldn't be seeing that page on the dashboard").
 */
async function loadBatch(user: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const found = await table<Batch>('batches').get(id)
  if (!found) return { response: NextResponse.json({ error: 'Shoot not found' }, { status: 404 }) }
  const batch = (await attachOne([found], 'client_id', 'clients', ['name']))[0]
  const me = await shootManager(user)
  if (!canManageShoot(me, batch)) {
    // somebody on the shoot is sent to their card; a stranger is simply refused
    const onIt = (await canOpenBatch(user, batch)) || peopleOnShoot(batch).includes(user.id)
    return { response: NextResponse.json(onIt ? NOT_YOUR_PAGE : { error: 'You are not on this client or this shoot' }, { status: 403 }) }
  }
  return { batch }
}

/** One shoot, with its cards and its people — the shoot page's data. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response
    const b = loaded.batch

    // ONE read of the people table serves every name below; the other reads
    // are of different tables, so the whole page costs five.
    const [itemRows, people, proposal, clientRow] = await Promise.all([
      table<ContentItem>('content_items').list({
        by: { batch_id: id }, orderBy: [['created_at', 'asc']], limit: 100,
      }),
      table<TeamUser>('team_users').list(),
      b.proposal_id ? table<ShootProposal>('shoot_proposals').get(b.proposal_id) : Promise.resolve(null),
      table<Client>('clients').get(b.client_id),
    ])
    const items = await attachOne(itemRows, 'work_kind_id', 'work_kinds', ['slug'])
    const personById = new Map(people.map(u => [u.id, u]))
    const nameOf = (uid: string | null | undefined) => {
      const p = uid ? personById.get(uid) : null
      return p ? (p.name || p.email) : null
    }
    // THE PEOPLE ON THE SHOOT: the crew and the editor, each with whether
    // and when they read the plan
    const acked = new Map(acksOf(b).map(a => [a.user_id, a.at]))
    const crew = peopleOnShoot(b).map(uid => ({
      id: uid, name: nameOf(uid) ?? 'Someone', role: personById.get(uid)?.role ?? null,
      acknowledged_at: acked.get(uid) ?? null,
    }))
    const team = people.filter(p => p.active_status === true && p.role !== 'client')
      .map(p => ({ id: p.id, name: p.name || p.email, role: p.role }))
    // every stamp's person, by name — "by the team" where the row predates
    // the column (the page reads the null)
    const names: Record<string, string | null> = {}
    for (const col of ['created_by', 'owner_id', 'brief_shared_by', 'aligned_by', 'client_confirmed_by', 'client_shared_by', 'go_by', 'reminder_sent_by', 'footage_handed_by', 'editor_id', 'last_edited_by', 'go_override_by'] as const) {
      names[col] = nameOf(b[col])
    }
    for (const uid of peopleOnShoot(b)) names[uid] = nameOf(uid)

    return NextResponse.json({
      batch: b,
      portal_token: clientRow?.share_token ?? null,
      client_email: clientRow?.email ?? null,
      items,
      last_edited_by_name: names.last_edited_by,
      last_edited_at: b.last_edited_at ?? null,
      proposal: proposal ?? null,
      viewer_role: user.role,
      viewer_id: user.id,
      crew,
      team,
      names,
      editor_name: names.editor_id,
      go_by_name: names.go_by,
      brief_shared_by_name: names.brief_shared_by,
      footage_handed_by_name: names.footage_handed_by,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Field-level edits — the browser sends ONLY the field that changed, so two
 *  people editing different parts of a plan cannot clobber each other's
 *  jsonb wholesale. Stages never move here; that is the stage route. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response
    const batch = loaded.batch
    const body = await req.json()
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

    // a manager changing a BOOKED date is its own audited act, with a reason
    if (body.action === 'change_date') {
      const reason = String(body.reason ?? '').trim()
      const newDate = String(body.shoot_date ?? '').trim()
      if (!reason) return NextResponse.json({ error: 'Say why the date is moving — the team sees this' }, { status: 422 })
      if (!newDate || Number.isNaN(new Date(newDate).getTime())) {
        return NextResponse.json({ error: 'Pick a valid date' }, { status: 422 })
      }
      const d = new Date(newDate)
      const data = await table('batches')
        .update(id, { shoot_date: newDate, month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }) as unknown as Batch | null
      if (!data) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
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

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = {}
    // canvas edits arrive as per-card ops and merge server-side, so two people
    // moving different cards both win. Per-card last-write-wins; the small
    // read-modify-write window is accepted for v1.
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
    if ('owner_id' in body) patch.owner_id = body.owner_id || null
    // ── the Shoot Brief SOP's nine parts ──
    for (const [field, max] of [
      ['objective', 2000], ['script', 8000], ['call_time', 60], ['talent', 1000],
      ['props_wardrobe', 2000], ['client_availability', 1000], ['editor_priorities', 2000],
    ] as const) {
      if (field in body) patch[field] = String(body[field] ?? '').trim().slice(0, max) || null
    }
    if ('footage_url' in body) {
      const raw = String(body.footage_url ?? '').trim()
      if (raw) {
        const check = linkKindOf(raw)
        if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 422 })
        patch.footage_url = check.url
      } else {
        patch.footage_url = null
      }
    }
    if ('edit_deadline' in body) {
      const d = body.edit_deadline ? String(body.edit_deadline).slice(0, 10) : ''
      if (d && Number.isNaN(new Date(`${d}T00:00:00`).getTime())) {
        return NextResponse.json({ error: 'Enter a valid editor deadline' }, { status: 422 })
      }
      patch.edit_deadline = d || null
    }
    // ── the people on the shoot ──
    if ('editor_id' in body || 'crew_ids' in body) {
      const team = await table<TeamUser>('team_users').list({ where: u => u.active_status === true && u.role !== 'client' })
      const byId = new Map(team.map(u => [u.id, u]))
      if ('editor_id' in body) {
        const eid = body.editor_id ? String(body.editor_id) : ''
        if (eid && byId.get(eid)?.role !== 'editor') {
          return NextResponse.json({ error: 'The editor on a shoot has to be one of the editors' }, { status: 422 })
        }
        patch.editor_id = eid || null
      }
      if ('crew_ids' in body) {
        const raw: string[] = Array.isArray(body.crew_ids) ? body.crew_ids.map(String) : []
        patch.crew_ids = [...new Set(raw.filter(uid => byId.has(uid)))]
      }
    }
    // ── the two ticks on the way to "go" — with who ticked them ──
    for (const [flag, col, who] of [['aligned', 'aligned_at', 'aligned_by'], ['client_confirmed', 'client_confirmed_at', 'client_confirmed_by']] as const) {
      if (flag in body) {
        const on = body[flag] === true
        patch[col] = on ? now : null
        patch[who] = on ? user.id : null
      }
    }
    if ('shared_with_client' in body) {
      // the switch turns the portal off; turning it ON is "Share the plan
      // with the client", which emails them (the share-client route)
      patch.shared_with_client = body.shared_with_client === true
      if (body.shared_with_client === true && !batch.client_shared_at) { patch.client_shared_at = now; patch.client_shared_by = user.id }
    }
    if ('share_board' in body) patch.share_board = body.share_board === true
    if ('board_name' in body) patch.board_name = String(body.board_name ?? '').trim().slice(0, 80) || null
    if ('shoot_date' in body) {
      // freely editable while still a plan; once booked, the date is a
      // commitment and moves only through change_date above
      if (batch.status !== 'brief') {
        return NextResponse.json({ error: 'The shoot is booked — use “Change date”' }, { status: 409 })
      }
      const d = body.shoot_date ? String(body.shoot_date) : ''
      if (d) {
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

    const data = await table('batches').update(id, patch) as unknown as Batch | null
    if (!data) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    // stamp who last edited — best-effort, so a failure here never loses the
    // edit the user just made
    try {
      await table('batches').update(id, { last_edited_by: user.id, last_edited_at: now })
    } catch { /* the edit itself already landed */ }
    for (const [flag, col] of [['aligned', 'aligned_at'], ['client_confirmed', 'client_confirmed_at']] as const) {
      if (flag in body) {
        await logActivity({
          actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
          action: patch[col] ? `sop_${flag}` : `sop_${flag}_undone`,
        })
      }
    }
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: data.status ?? 'brief', kind: 'updated' })
    // the plan of a shoot that is already booked is work now: a shoot with
    // no card yet gets its one card straight away
    if ('planned_deliverables' in patch && data.status !== 'brief') {
      try {
        await ensureShootCard(user, data)
      } catch (e) {
        console.error('plan cards after edit:', e)
      }
    }
    // a shoot folder is named by its MONTH, and a plan with no date yet was
    // filed under the month it was raised in — put it right the moment the
    // date exists
    if ('shoot_date' in patch) onShootDateChanged(data)
    // THE EDITOR NAMED AFTER SHARING OR GO gets the card the moment they are
    // named — the same handover go does, so nothing waits for a press
    if ('editor_id' in patch && patch.editor_id && (data.go_at || data.brief_shared_at || data.status !== 'brief')) {
      try { await handOverAtGo(user, data) } catch (e) { console.error('handover after naming the editor:', e) }
    }
    // a footage folder pasted AFTER the handover reaches the cards now
    if ('footage_url' in patch && patch.footage_url && data.footage_handed_at) {
      try { await fillFootageFolder(data) } catch (e) { console.error('footage folder after handover:', e) }
    }
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/**
 * Delete a shoot, keeping whatever was made under it: the pieces are
 * detached first (they become plain cards), then the shoot goes.
 * `shootDeletion` holds the rule and the sentence, so the dialog warns with
 * the words the server enforces.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response

    // Read the whole list, not a count: a failed read must NOT be treated as
    // "no items" and silently orphan every one of them to batch_id = null.
    const items = await table<ContentItem>('content_items').list({ by: { batch_id: id } })

    const verdict = shootDeletion(items)
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason }, { status: 409 })
    }

    // detach BEFORE deleting the parent — the pieces become plain cards
    if (verdict.detaching > 0) {
      await Promise.all(items.map(i => table<ContentItem>('content_items').update(i.id, { batch_id: null })))
    }

    await table('batches').remove(id)
    await logActivity({
      actor: user, clientId: loaded.batch.client_id,
      entityType: 'batch', entityId: id, action: 'deleted',
      oldValue: loaded.batch.title,
      ...(verdict.detaching > 0 ? { detail: `${verdict.detaching} piece(s) kept` } : {}),
    })
    announceBatchChange({ batch_id: id, client_id: loaded.batch.client_id, status: 'brief', kind: 'deleted' })
    return NextResponse.json({ ok: true, detached: verdict.detaching })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
