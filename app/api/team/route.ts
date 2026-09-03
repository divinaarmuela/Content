import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { table, withRequestCache, DbError } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { TeamUser, TeamInvite, TeamUserClient } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError, type Role } from '../../lib/authz'
import { onTeamChanged } from '../../lib/gdrive-members'

const INVITABLE_ROLES: Role[] = ['super_admin', 'account_manager', 'editor', 'scheduler', 'client']

/**
 * The team.
 *
 * A super admin gets everything: full member records, pending invites, client
 * assignments, and the controls that go with them. Anyone else gets a
 * DIRECTORY — who is on the team, their role and whether they are staff or a
 * contractor — and only if a super admin has opened the Team page to their
 * role in Settings. Hiding the link without gating the data would have been
 * decoration; opening the page without opening the data would have been a
 * link to an error.
 */
export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')   // any team role

      if (user.role !== 'super_admin') {
        const { userMaySeePage } = await import('../../lib/page-access')
        if (!(await userMaySeePage(user, '/dashboard/team'))) {
          throw new AuthzError('Not found', 404)
        }
        const rows = await table<TeamUser>('team_users').list({
          by: { active_status: true },
          orderBy: [['created_at', 'asc']],
        })
        // the directory is a deliberate projection: a non-admin sees who is
        // on the team, not their notification settings or their Clerk id
        return NextResponse.json({
          members: rows.map(r => ({
            id: r.id, name: r.name, email: r.email, role: r.role,
            employment_type: r.employment_type, timezone: r.timezone,
            active_status: r.active_status,
          })),
          invites: [],          // pending invites are an admin concern
          assignments: [],      // as is who runs which client
          can_manage: false,
        })
      }

      const [members, invites, links] = await Promise.all([
        table<TeamUser>('team_users').list({ orderBy: [['created_at', 'asc']] }),
        table<TeamInvite>('team_invites').list({ by: { status: 'pending' }, orderBy: [['created_at', 'desc']] }),
        table<TeamUserClient>('team_user_clients').list(),
      ])
      const assignments = (await attachOne(links, 'client_id', 'clients', ['name']))
        .map(l => ({ team_user_id: l.team_user_id, client_id: l.client_id, clients: l.clients }))

      return NextResponse.json({ members, invites, assignments, can_manage: true })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** Invite a person. super_admin only.
 *  One pending invite per email: Postgres enforced that with a partial unique
 *  index, which a JSON tree cannot express, so the check lives here — read the
 *  pending invites for the address first and refuse a second one. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const inviter = await requireRole('super_admin')
      const body = await req.json()

      const email = String(body.email ?? '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
      }
      const role = body.role as Role
      if (!INVITABLE_ROLES.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }
      if (role === 'client' && !body.client_id) {
        return NextResponse.json({ error: 'Client users must be linked to a client' }, { status: 400 })
      }

      const users = table<TeamUser>('team_users')
      const invitesTable = table<TeamInvite>('team_invites')

      const existingUser = (await users.list({
        where: r => (r.email ?? '').toLowerCase() === email, limit: 1,
      }))[0] ?? null
      if (existingUser) {
        return NextResponse.json(
          {
            error: existingUser.clerk_user_id
              ? 'This email already has an account'
              : 'This person is already on the team, waiting for their first sign-in',
          },
          { status: 409 },
        )
      }

      const pending = (await invitesTable.list({
        by: { status: 'pending' },
        where: r => (r.email ?? '').toLowerCase() === email,
        limit: 1,
        fresh: true,
      }))[0]
      if (pending) {
        return NextResponse.json({ error: 'A pending invite already exists for this email' }, { status: 409 })
      }

      // take the pending-invite slot FIRST, then send through Clerk; roll the
      // row back if Clerk refuses.
      let invite: TeamInvite
      try {
        invite = await table('team_invites').insert({
          email,
          role,
          employment_type: body.employment_type === 'contractor' ? 'contractor' : 'employee',
          timezone: body.timezone || 'Australia/Melbourne',
          client_id: body.client_id ?? null,
          assigned_client_ids: Array.isArray(body.assigned_client_ids) ? body.assigned_client_ids : [],
          invited_by: inviter.id,
          status: 'pending',
        }) as unknown as TeamInvite
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Invite failed'
        return NextResponse.json({ error: msg }, { status: 500 })
      }

      // The person exists NOW, before they ever sign in: a row with no
      // clerk_user_id yet, which first sign-in adopts. Without this there is
      // nothing to attach page access or client assignments to until they
      // happen to log in, which is the wrong way round — the admin is setting
      // them up precisely because they have not arrived yet.
      //
      // INSERT, not upsert: an address that is already on the team belongs to
      // somebody, and writing the invite's name/role/timezone over their row
      // would quietly demote or rename a colleague. `team_users.email` is a
      // unique key, so a second insert loses — which is the answer we want.
      try {
        await table('team_users').insert({
          email,
          name: String(body.name ?? '').trim() || email,
          role,
          employment_type: body.employment_type === 'contractor' ? 'contractor' : 'employee',
          timezone: body.timezone || 'Australia/Melbourne',
          client_id: role === 'client' ? (body.client_id ?? null) : null,
          active_status: true,
        })
      } catch (e) {
        // somebody claimed the address between the check above and this write
        if (e instanceof DbError && e.code === 'unique') {
          await invitesTable.remove(invite.id)
          return NextResponse.json(
            { error: 'This person is already on the team, waiting for their first sign-in' },
            { status: 409 },
          )
        }
        throw e
      }

      const person = (await users.list({ where: r => (r.email ?? '').toLowerCase() === email, limit: 1 }))[0] ?? null
      if (person && Array.isArray(body.assigned_client_ids) && body.assigned_client_ids.length > 0) {
        await Promise.all(body.assigned_client_ids.map((client_id: string) =>
          table<TeamUserClient>('team_user_clients').upsert({
            team_user_id: person.id, client_id, assigned_at: new Date().toISOString(),
          })))
      }

      try {
        const clerk = await clerkClient()

        // someone who was on the team before still has their login — Clerk
        // refuses to "invite" an existing account, so adopt it instead: link
        // the row and tell the admin they can sign straight in
        const { data: existing } = await clerk.users.getUserList({ emailAddress: [email] })
        if (existing.length > 0) {
          const linked = await users.list({ where: r => (r.email ?? '').toLowerCase() === email })
          await Promise.all(linked.map(u => users.update(u.id, { clerk_user_id: existing[0].id })))
          await invitesTable.update(invite.id, { status: 'accepted' })
          onTeamChanged('invite (existing account)')
          return NextResponse.json(
            { ...invite, status: 'accepted', already_has_account: true },
            { status: 201 },
          )
        }

        const clerkInvite = await clerk.invitations.createInvitation({
          emailAddress: email,
          publicMetadata: { role },
          notify: true,
        })
        await invitesTable.update(invite.id, { clerk_invitation_id: clerkInvite.id })
      } catch (e) {
        await invitesTable.remove(invite.id)
        // roll back the person row too — but only if this invite created it
        // (no sign-in yet); leaving it made every re-invite 409 as "already
        // on the team" for someone who was never actually invited
        await users.removeWhere(r => (r.email ?? '').toLowerCase() === email && r.clerk_user_id == null)
        const msg = e instanceof Error ? e.message : 'Clerk invitation failed'
        return NextResponse.json({ error: `Invitation email failed: ${msg}` }, { status: 502 })
      }

      // a new person needs the folder tree; if their address is not on the
      // agency's domain, that means a permission of their own
      onTeamChanged('invite')
      return NextResponse.json(invite, { status: 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
