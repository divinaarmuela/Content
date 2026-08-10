import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../../lib/authz'

/**
 * Account managers for one client — rows in team_user_clients whose team
 * user carries a managing role.
 *
 * Reading is editor+ like the rest of the client page. Assigning and removing
 * are super_admin, consistent with every other client-scoped write. The
 * eligible list is derived from roles, never sent by the browser.
 */

const MANAGING_ROLES = ['account_manager', 'super_admin']

async function loadState(clientId: string) {
  const [assignments, eligible] = await Promise.all([
    supabase.from('team_user_clients')
      .select('team_user_id, assigned_at, team_users!team_user_clients_team_user_id_fkey(id, name, email, role, active_status)')
      .eq('client_id', clientId),
    supabase.from('team_users')
      .select('id, name, email, role')
      .in('role', MANAGING_ROLES).eq('active_status', true).order('name'),
  ])

  const managers = (assignments.data ?? [])
    .map(a => {
      const u = a.team_users as unknown as
        { id: string; name: string; email: string; role: string; active_status: boolean } | null
      return u && MANAGING_ROLES.includes(u.role) && u.active_status
        ? { team_user_id: u.id, name: u.name, email: u.email, role: u.role, assigned_at: a.assigned_at }
        : null
    })
    .filter(Boolean)

  // how loaded each eligible manager already is, so assigning can balance
  const { data: counts } = await supabase.from('team_user_clients').select('team_user_id')
  const load = new Map<string, number>()
  for (const c of counts ?? []) load.set(c.team_user_id, (load.get(c.team_user_id) ?? 0) + 1)

  return {
    managers,
    eligible: (eligible.data ?? []).map(u => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      client_count: load.get(u.id) ?? 0,
    })),
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const state = await loadState(id)
    return NextResponse.json({ ...state, can_manage: roleSatisfies(user.role, 'super_admin') })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('super_admin')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const teamUserId = String(body?.team_user_id ?? '')

    const { data: target } = await supabase.from('team_users')
      .select('id, role, active_status').eq('id', teamUserId).maybeSingle()
    if (!target || !target.active_status || !MANAGING_ROLES.includes(target.role)) {
      return NextResponse.json({ error: 'That person cannot manage clients' }, { status: 400 })
    }

    // composite PK absorbs the double-click: second insert is a no-op conflict
    const { error } = await supabase.from('team_user_clients')
      .upsert({ team_user_id: teamUserId, client_id: id, assigned_by: admin.id },
        { onConflict: 'team_user_id,client_id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(await loadState(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const teamUserId = new URL(req.url).searchParams.get('team_user_id') ?? ''
    const { error } = await supabase.from('team_user_clients')
      .delete().eq('client_id', id).eq('team_user_id', teamUserId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(await loadState(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
