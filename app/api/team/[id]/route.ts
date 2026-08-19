import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse, type Role } from '../../../lib/authz'

const ROLES: Role[] = ['super_admin', 'account_manager', 'editor', 'scheduler', 'client']

/** Update a member (role, employment type, timezone, workday, active status,
 *  client assignments). super_admin only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole('super_admin')
    const { id } = await params
    const body = await req.json()

    // guardrail: no one deactivates or demotes themselves — prevents locking
    // the last admin out of the system
    if (id === actor.id && (body.active_status === false || (body.role && body.role !== 'super_admin'))) {
      return NextResponse.json({ error: "You can't demote or deactivate your own account" }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (body.role) {
      if (!ROLES.includes(body.role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      patch.role = body.role
    }
    if (body.employment_type) patch.employment_type = body.employment_type === 'contractor' ? 'contractor' : 'employee'
    if (body.timezone) patch.timezone = body.timezone
    if (body.workday_start) patch.workday_start = body.workday_start
    if (body.workday_end) patch.workday_end = body.workday_end
    if (typeof body.active_status === 'boolean') patch.active_status = body.active_status
    if ('name' in body) patch.name = String(body.name ?? '')

    const { data, error } = await supabase
      .from('team_users')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // replace client assignments atomically-enough: composite PK dedupes,
    // delete-then-upsert keeps the set exactly as sent
    if (Array.isArray(body.assigned_client_ids)) {
      await supabase.from('team_user_clients').delete().eq('team_user_id', id)
      if (body.assigned_client_ids.length > 0) {
        await supabase.from('team_user_clients').upsert(
          body.assigned_client_ids.map((client_id: string) => ({
            team_user_id: id,
            client_id,
            assigned_by: actor.id,
          })),
          { onConflict: 'team_user_id,client_id', ignoreDuplicates: true }
        )
      }
    }

    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Revoke a pending invite (id = invite id), or with ?kind=member delete a
 *  team member outright. super_admin only. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole('super_admin')
    const { id } = await params

    if (new URL(req.url).searchParams.get('kind') === 'member') {
      if (id === actor.id) {
        return NextResponse.json({ error: 'You cannot delete yourself' }, { status: 400 })
      }
      const { data: member } = await supabase.from('team_users').select('id, role, email').eq('id', id).maybeSingle()
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      if (member.role === 'super_admin') {
        // allowlisted supers re-create themselves on next sign-in — deleting
        // one is confusion, not removal
        return NextResponse.json({ error: 'Super admins cannot be deleted — deactivate instead' }, { status: 400 })
      }
      // detach everything that points at them, keep their authored history
      await supabase.from('team_user_clients').delete().eq('team_user_id', id)
      await supabase.from('user_page_access').delete().eq('team_user_id', id)
      await supabase.from('content_items').update({ owner_id: null }).eq('owner_id', id)
      const { error: delErr } = await supabase.from('team_users').delete().eq('id', id)
      if (delErr) {
        // an FK we don't know about (comments, approvals…) — keep the record
        return NextResponse.json(
          { error: 'This person has work history attached. Deactivate them instead.' },
          { status: 409 },
        )
      }
      return NextResponse.json({ ok: true })
    }
    const { data, error } = await supabase
      .from('team_invites')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Pending invite not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
