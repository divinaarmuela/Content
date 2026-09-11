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
/** who may be a client's default scheduler: the people who post */
const SCHEDULING_ROLES = ['scheduler', 'general']

async function loadState(clientId: string) {
  const [links, eligible, counts, client, schedulers] = await Promise.all([
    table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } }),
    table<TeamUser>('team_users').list({
      by: { active_status: true },
      where: r => MANAGING_ROLES.includes(r.role),
      orderBy: [['name', 'asc']],
    }),
    table<TeamUserClient>('team_user_clients').list(),
    table<{ id: string; default_scheduler_ids?: unknown; posts_own_content?: unknown }>('clients').get(clientId),
    table<TeamUser>('team_users').list({
      by: { active_status: true },
      where: r => SCHEDULING_ROLES.includes(r.role),
      orderBy: [['name', 'asc']],
    }),
  ])
  const defaultIds = (Array.isArray(client?.default_scheduler_ids) ? client!.default_scheduler_ids : []).map(String)
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
    // WHO SCHEDULES FOR THIS CLIENT (the Playbook: Joy assigns to Cath or
    // Raven) — a card that passes the quality check is handed to them
    default_schedulers: schedulers
      .filter(u => defaultIds.includes(u.id))
      .map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    schedulers: schedulers.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    // DELIVER ONLY: this client posts their own content (the playbook's Bond Street)
    posts_own_content: client?.posts_own_content === true,
  }
}

/** Set who schedules for this client by default. Managers of the client and
 *  super admins; scheduling roles only, and a stale id is dropped. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    if (!roleSatisfies(user.role, 'super_admin')) {
      const mine = await table<TeamUserClient>('team_user_clients')
        .list({ by: { team_user_id: user.id }, where: r => r.client_id === id, limit: 1 })
      if (mine.length === 0) return NextResponse.json({ error: 'This is not one of your clients' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const wanted = (Array.isArray(body?.default_scheduler_ids) ? body.default_scheduler_ids : []).map(String).slice(0, 20)
    const people = wanted.length
      ? await table<TeamUser>('team_users').list({ where: r => wanted.includes(r.id) && r.active_status && SCHEDULING_ROLES.includes(r.role) })
      : []
    const ids = wanted.filter((w: string) => people.some(p => p.id === w))
    const patchRow: Record<string, unknown> = {}
    if (Array.isArray(body?.default_scheduler_ids)) patchRow.default_scheduler_ids = ids
    if (typeof body?.posts_own_content === 'boolean') patchRow.posts_own_content = body.posts_own_content
    if (Object.keys(patchRow).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    const saved = await table('clients').update(id, patchRow)
    if (!saved) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    return NextResponse.json(await loadState(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const state = await loadState(id)
    // a super admin, or one of this client's own managers, picks its schedulers
    const mine = roleSatisfies(user.role, 'super_admin') ? true
      : user.role === 'account_manager'
        ? (await table<TeamUserClient>('team_user_clients').list({ by: { team_user_id: user.id }, where: r => r.client_id === id, limit: 1 })).length > 0
        : false
    return NextResponse.json({ ...state, can_manage: roleSatisfies(user.role, 'super_admin'), can_set_schedulers: mine })
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
