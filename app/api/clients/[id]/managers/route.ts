import { NextResponse } from 'next/server'
import { table, withRequestCache, DbError } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { TeamUser, TeamUserClient } from '@/lib/db-types'
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
  const [links, eligible, counts] = await Promise.all([
    table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } }),
    table<TeamUser>('team_users').list({
      by: { active_status: true },
      where: r => MANAGING_ROLES.includes(r.role),
      orderBy: [['name', 'asc']],
    }),
    table<TeamUserClient>('team_user_clients').list(),
  ])
  const assignments = await attachOne(links, 'team_user_id', 'team_users',
    ['id', 'name', 'email', 'role', 'active_status'])

  const managers = assignments
    .map(a => {
      const u = a.team_users as unknown as
        { id: string; name: string; email: string; role: string; active_status: boolean } | null
      return u && MANAGING_ROLES.includes(u.role) && u.active_status
        ? { team_user_id: u.id, name: u.name, email: u.email, role: u.role, assigned_at: a.assigned_at }
        : null
    })
    .filter(Boolean)

  // how loaded each eligible manager already is, so assigning can balance
  const load = new Map<string, number>()
  for (const c of counts) load.set(c.team_user_id, (load.get(c.team_user_id) ?? 0) + 1)

  return {
    managers,
    eligible: eligible.map(u => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      client_count: load.get(u.id) ?? 0,
    })),
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const state = await loadState(id)
    return NextResponse.json({ ...state, can_manage: roleSatisfies(user.role, 'super_admin') })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const admin = await requireRole('super_admin')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const teamUserId = String(body?.team_user_id ?? '')

    const target = await table<TeamUser>('team_users').get(teamUserId)
    if (!target || !target.active_status || !MANAGING_ROLES.includes(target.role)) {
      return NextResponse.json({ error: 'That person cannot manage clients' }, { status: 400 })
    }

    // The row's id IS (team_user_id, client_id), so the insert is the guard:
    // a natural-key table refuses a second row for the same pair. A
    // double-click loses that race and leaves the original assignment date
    // alone, which is exactly the old behaviour — without a read that another
    // click can slip past.
    try {
      await table('team_user_clients').insert({
        team_user_id: teamUserId, client_id: id, assigned_by: admin.id,
        assigned_at: new Date().toISOString(),
      })
    } catch (e) {
      if (!(e instanceof DbError && e.code === 'unique')) throw e
    }

    return NextResponse.json(await loadState(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const teamUserId = new URL(req.url).searchParams.get('team_user_id') ?? ''
    await table<TeamUserClient>('team_user_clients')
      .removeWhere(r => r.client_id === id && r.team_user_id === teamUserId)
    return NextResponse.json(await loadState(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
