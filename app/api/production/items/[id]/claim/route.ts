import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { AuthzError, requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import {
  claimDecision, CLAIMABLE_SCHEDULING_STATUSES, EDITING_CLOSED_STATUSES, type ClaimHat,
} from '../../../../../lib/claim-core'
import { SHOOT_BRIEF_SLUG } from '../../../../../lib/brief-task-core'
import { isInternalKind } from '../../../../../lib/task-kind-core'
import { schedulerIdsOf, type ItemStatus } from '../../../../../lib/workflow-core'

/** Name a team member for a 409 message. Never their email — a colleague's
 *  address is not ours to hand out to explain a lost race. */
async function nameOf(id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const { data } = await supabase.from('team_users').select('name').eq('id', id).maybeSingle()
  return data?.name?.trim() || null
}

/** A lost race, said plainly. */
function lost(name: string | null) {
  return NextResponse.json(
    {
      error: name ? `${name} took this a moment ago` : 'Someone already has this one',
      taken_by: name ?? 'Someone',
    },
    { status: 409 },
  )
}

/**
 * "I'll take this one."
 *
 * The open pool made explicit: an item nobody holds can be picked up, and
 * picking it up is what grants the hat. Two people clicking at the same
 * moment is the normal case, not the edge case — so the seat is taken by an
 * UPDATE whose WHERE clause requires both that the seat is still empty AND
 * that the item is still at a status where the seat exists. Nothing that was
 * merely READ is trusted at the moment of the write. Zero rows means somebody
 * else got there first, and we say who.
 *
 * Self-assignment sends no email: you already know.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') {
      return NextResponse.json({ error: 'Client accounts cannot take on work' }, { status: 403 })
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)

    const body = await req.json().catch(() => ({}))
    const hat = body?.hat as ClaimHat
    if (hat !== 'editor' && hat !== 'scheduler') {
      return NextResponse.json({ error: "hat must be 'editor' or 'scheduler'" }, { status: 400 })
    }

    // a shoot brief rides the item machine but is not open work
    const { data: kindRow } = await supabase
      .from('content_items').select('work_kinds(slug, uses_media)').eq('id', id).maybeSingle()
    const kind = kindRow?.work_kinds as { slug?: string; uses_media?: boolean } | null
    const isBrief = (kind?.slug ?? null) === SHOOT_BRIEF_SLUG

    const decision = claimDecision(
      { status: item.status as ItemStatus, is_brief: isBrief, is_internal: isInternalKind(kind) },
      { id: user.id, role: user.role },
      hat,
    )
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status })
    }

    if (hat === 'editor') {
      const { data: won, error } = await supabase
        .from('content_items')
        .update({ owner_id: user.id, assigned_by: user.id })
        .eq('id', id)
        .is('owner_id', null)
        // a transition landing between the read above and this write must not
        // hand the edit to someone on an item that has since been approved
        .not('status', 'in', `(${EDITING_CLOSED_STATUSES.join(',')})`)
        .select('id, owner_id')
        .maybeSingle()
      if (error) {
        console.error('claim (editor) failed:', error.message)
        throw new AuthzError('Could not pick this up — please try again', 500)
      }
      if (!won) {
        const { data: current } = await supabase
          .from('content_items').select('owner_id, status').eq('id', id).maybeSingle()
        // you already hold it — a second click, or two tabs. Not a conflict.
        if (current?.owner_id === user.id) return NextResponse.json({ ok: true, already: true })
        if (current?.owner_id) return lost(await nameOf(current.owner_id))
        return NextResponse.json(
          { error: 'This one moved on while you were looking — refresh and try again' },
          { status: 409 },
        )
      }
    } else {
      const { data: won, error } = await supabase
        .from('content_items')
        .update({ scheduler_ids: [user.id] })
        .eq('id', id)
        .eq('scheduler_ids', '[]') // still nobody's — jsonb equality on the empty array
        // …and still at a status where there is scheduling to do
        .in('status', CLAIMABLE_SCHEDULING_STATUSES as readonly string[] as string[])
        .select('id')
        .maybeSingle()
      if (error) {
        console.error('claim (scheduler) failed:', error.message)
        throw new AuthzError('Could not pick this up — please try again', 500)
      }
      if (!won) {
        const { data: current } = await supabase
          .from('content_items').select('scheduler_ids, status').eq('id', id).maybeSingle()
        const holders = schedulerIdsOf(current ?? {})
        if (holders.includes(user.id)) return NextResponse.json({ ok: true, already: true })
        if (holders.length > 0) return lost(await nameOf(holders[0]))
        return NextResponse.json(
          { error: 'This one moved on while you were looking — refresh and try again' },
          { status: 409 },
        )
      }
    }

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'claimed',
      detail: hat === 'editor' ? 'picked up the edit' : 'picked up the scheduling',
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
