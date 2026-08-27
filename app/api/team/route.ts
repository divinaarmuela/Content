import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
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
  try {
    const user = await requireRole('scheduler')   // any team role

    if (user.role !== 'super_admin') {
      const { userMaySeePage } = await import('../../lib/page-access')
      if (!(await userMaySeePage(user, '/dashboard/team'))) {
        throw new AuthzError('Not found', 404)
      }
      const { data, error } = await supabase
        .from('team_users')
        .select('id, name, email, role, employment_type, timezone, active_status')
        .eq('active_status', true)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return NextResponse.json({
        members: data ?? [],
        invites: [],          // pending invites are an admin concern
        assignments: [],      // as is who runs which client
        can_manage: false,
      })
    }

    const [membersRes, invitesRes, assignmentsRes] = await Promise.all([
      supabase.from('team_users').select('*').order('created_at', { ascending: true }),
      supabase.from('team_invites').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('team_user_clients').select('team_user_id, client_id, clients(name)'),
    ])
    if (membersRes.error) throw new Error(membersRes.error.message)
    if (invitesRes.error) throw new Error(invitesRes.error.message)

    return NextResponse.json({
      members: membersRes.data,
      invites: invitesRes.data,
      assignments: assignmentsRes.data ?? [],
      can_manage: true,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Invite a person. super_admin only.
 *  Race-safe: the partial unique index on team_invites (one pending invite per
 *  email) makes concurrent duplicate invites collide at the database. */
export async function POST(req: Request) {
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

    const { data: existingUser } = await supabase
      .from('team_users').select('id, clerk_user_id').ilike('email', email).maybeSingle()
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

    // claim the pending-invite slot FIRST (unique index = race guard),
    // then send through Clerk; roll the row back if Clerk refuses.
    const { data: invite, error: invErr } = await supabase
      .from('team_invites')
      .insert({
        email,
        role,
        employment_type: body.employment_type === 'contractor' ? 'contractor' : 'employee',
        timezone: body.timezone || 'Australia/Melbourne',
        client_id: body.client_id ?? null,
        assigned_client_ids: Array.isArray(body.assigned_client_ids) ? body.assigned_client_ids : [],
        invited_by: inviter.id,
      })
      .select()
      .single()
    if (invErr) {
      const dup = invErr.message.includes('team_invites_pending_email_uidx')
      return NextResponse.json(
        { error: dup ? 'A pending invite already exists for this email' : invErr.message },
        { status: dup ? 409 : 500 }
      )
    }

    // The person exists NOW, before they ever sign in: a row with no
    // clerk_user_id yet, which first sign-in adopts. Without this there is
    // nothing to attach page access or client assignments to until they
    // happen to log in, which is the wrong way round — the admin is setting
    // them up precisely because they have not arrived yet.
    await supabase.from('team_users').upsert({
      email,
      name: String(body.name ?? '').trim() || email,
      role,
      employment_type: body.employment_type === 'contractor' ? 'contractor' : 'employee',
      timezone: body.timezone || 'Australia/Melbourne',
      client_id: role === 'client' ? (body.client_id ?? null) : null,
      active_status: true,
    }, { onConflict: 'email', ignoreDuplicates: true })

    const { data: person } = await supabase
      .from('team_users').select('id').ilike('email', email).maybeSingle()
    if (person && Array.isArray(body.assigned_client_ids) && body.assigned_client_ids.length > 0) {
      await supabase.from('team_user_clients').upsert(
        body.assigned_client_ids.map((client_id: string) => ({ team_user_id: person.id, client_id })),
        { onConflict: 'team_user_id,client_id', ignoreDuplicates: true },
      )
    }

    try {
      const clerk = await clerkClient()

      // someone who was on the team before still has their login — Clerk
      // refuses to "invite" an existing account, so adopt it instead: link
      // the row and tell the admin they can sign straight in
      const { data: existing } = await clerk.users.getUserList({ emailAddress: [email] })
      if (existing.length > 0) {
        await supabase.from('team_users')
          .update({ clerk_user_id: existing[0].id })
          .ilike('email', email)
        await supabase.from('team_invites')
          .update({ status: 'accepted' })
          .eq('id', invite.id)
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
      await supabase.from('team_invites')
        .update({ clerk_invitation_id: clerkInvite.id })
        .eq('id', invite.id)
    } catch (e) {
      await supabase.from('team_invites').delete().eq('id', invite.id)
      // roll back the person row too — but only if this invite created it
      // (no sign-in yet); leaving it made every re-invite 409 as "already
      // on the team" for someone who was never actually invited
      await supabase.from('team_users').delete().ilike('email', email).is('clerk_user_id', null)
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
}
