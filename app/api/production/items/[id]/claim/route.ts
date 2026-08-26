import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { claimDecision, type ClaimHat } from '../../../../../lib/claim-core'
import { SHOOT_BRIEF_SLUG } from '../../../../../lib/brief-task-core'
import { schedulerIdsOf, type ItemStatus } from '../../../../../lib/workflow-core'

/** Name a team member for a 409 message. Best-effort — a name we can't
 *  resolve is never worth failing the response over. */
async function nameOf(id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const { data } = await supabase.from('team_users').select('name, email').eq('id', id).maybeSingle()
  return data ? (data.name || data.email || null) : null
}

/**
 * "I'll take this one."
 *
 * The open pool made explicit: an item nobody holds can be picked up, and
 * picking it up is what grants the hat. Two people clicking at the same
 * moment is the normal case, not the edge case — so the seat is taken by an
 * UPDATE whose WHERE clause requires it to still be empty. Zero rows means
 * somebody else got there first, and we say who. Never check-then-write.
 *
 * Self-assignment sends no email: you already know.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') {
      return NextResponse.json({ error: 'Client accounts cannot pick up work' }, { status: 403 })
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
      .from('content_items').select('work_kinds(slug)').eq('id', id).maybeSingle()
    const isBrief = ((kindRow?.work_kinds as { slug?: string } | null)?.slug ?? null) === SHOOT_BRIEF_SLUG

    const decision = claimDecision(
      { status: item.status as ItemStatus, is_brief: isBrief },
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
        .select('id, owner_id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!won) {
        const { data: current } = await supabase
          .from('content_items').select('owner_id').eq('id', id).maybeSingle()
        const taken = await nameOf(current?.owner_id)
        return NextResponse.json(
          { error: taken ? `${taken} took this a moment ago` : 'Someone already has this one', taken_by: taken ?? 'Someone' },
          { status: 409 },
        )
      }
    } else {
      const { data: won, error } = await supabase
        .from('content_items')
        .update({ scheduler_ids: [user.id] })
        .eq('id', id)
        .eq('scheduler_ids', '[]') // still nobody's — jsonb equality on the empty array
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!won) {
        const { data: current } = await supabase
          .from('content_items').select('scheduler_ids').eq('id', id).maybeSingle()
        const taken = await nameOf(schedulerIdsOf(current ?? {})[0])
        return NextResponse.json(
          { error: taken ? `${taken} took this a moment ago` : 'Someone already has this one', taken_by: taken ?? 'Someone' },
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
