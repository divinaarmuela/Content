import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TeamUser, TeamInvite, TeamUserClient, UserPageAccess, ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse, type Role } from '../../../lib/authz'
import { onTeamChanged } from '../../../lib/gdrive-members'

const ROLES: Role[] = ['super_admin', 'account_manager', 'editor', 'scheduler', 'client']

/** Update a member (role, employment type, timezone, workday, active status,
 *  client assignments). super_admin only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
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
        // a client-role user with no client is attached to nothing — the invite
        // path enforces this pairing, so the role-change path must too
        if (body.role === 'client' && !body.client_id) {
          return NextResponse.json({ error: 'A client user must be linked to a client' }, { status: 400 })
        }
        patch.role = body.role
        if (body.role === 'client') patch.client_id = body.client_id
      }
      if (body.employment_type) patch.employment_type = body.employment_type === 'contractor' ? 'contractor' : 'employee'
      if (body.timezone) patch.timezone = body.timezone
      if (body.workday_start) patch.workday_start = body.workday_start
      if (body.workday_end) patch.workday_end = body.workday_end
      if (typeof body.active_status === 'boolean') patch.active_status = body.active_status
      if ('name' in body) patch.name = String(body.name ?? '')

      const data = await table('team_users').update(id, patch)
      if (!data) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

      // replace client assignments: the derived (team_user_id, client_id) key
      // dedupes, delete-then-upsert keeps the set exactly as sent
      if (Array.isArray(body.assigned_client_ids)) {
        await table<TeamUserClient>('team_user_clients').removeWhere(r => r.team_user_id === id)
        if (body.assigned_client_ids.length > 0) {
          await Promise.all(body.assigned_client_ids.map((client_id: string) =>
            table<TeamUserClient>('team_user_clients').upsert({
              team_user_id: id,
              client_id,
              assigned_by: actor.id,
              assigned_at: new Date().toISOString(),
            })))
        }
      }

      // a deactivation, or a move to or from the client role, changes who
      // should be able to open the Drive tree
      onTeamChanged('member update')
      return NextResponse.json(data)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** Revoke a pending invite (id = invite id), or with ?kind=member delete a
 *  team member outright. super_admin only. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const actor = await requireRole('super_admin')
      const { id } = await params

      if (new URL(req.url).searchParams.get('kind') === 'member') {
        if (id === actor.id) {
          return NextResponse.json({ error: 'You cannot delete yourself' }, { status: 400 })
        }
        const member = await table<TeamUser>('team_users').get(id)
        if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
        if (member.role === 'super_admin') {
          // allowlisted supers re-create themselves on next sign-in — deleting
          // one is confusion, not removal
          return NextResponse.json({ error: 'Super admins cannot be deleted — deactivate instead' }, { status: 400 })
        }
        // detach everything that points at them, keep their authored history
        await table<TeamUserClient>('team_user_clients').removeWhere(r => r.team_user_id === id)
        await table<UserPageAccess>('user_page_access').removeWhere(r => r.team_user_id === id)
        const owned = await table<ContentItem>('content_items').list({ by: { owner_id: id } })
        for (const item of owned) await table('content_items').update(item.id, { owner_id: null })
        // scheduling handoffs too — an item must not stay assigned to a ghost
        const handed = await table<ContentItem>('content_items').list({
          where: r => Array.isArray(r.scheduler_ids) && (r.scheduler_ids as string[]).includes(id),
        })
        for (const item of handed) {
          const remaining = (Array.isArray(item.scheduler_ids) ? item.scheduler_ids as string[] : []).filter(x => x !== id)
          await table('content_items').update(item.id, { scheduler_ids: remaining })
        }
        try {
          await table<TeamUser>('team_users').remove(id)
        } catch {
          // something we don't know about still points at them (comments,
          // approvals…) — keep the record
          return NextResponse.json(
            { error: 'This person has work history attached. Deactivate them instead.' },
            { status: 409 },
          )
        }
        // they are gone; so is their access to the footage
        onTeamChanged('member removed')
        return NextResponse.json({ ok: true })
      }
      const invite = await table<TeamInvite>('team_invites').get(id)
      if (!invite || invite.status !== 'pending') {
        return NextResponse.json({ error: 'Pending invite not found' }, { status: 404 })
      }
      await table<TeamInvite>('team_invites').update(id, { status: 'revoked' })
      return NextResponse.json({ ok: true })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
