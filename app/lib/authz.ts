import 'server-only'
import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { parseAllowlist, isAllowlistedSuperAdmin, roleSatisfies, type Role } from './identity-core'

export { TEAM_ROLES, parseAllowlist, isAllowlistedSuperAdmin, roleSatisfies } from './identity-core'
export type { Role } from './identity-core'

export type TeamUser = {
  id: string
  clerk_user_id: string | null
  email: string
  name: string
  role: Role
  employment_type: 'employee' | 'contractor'
  timezone: string
  client_id: string | null
  active_status: boolean
}

export class AuthzError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Resolve the signed-in Clerk identity to a team_users row.
 *
 * Idempotent by construction: the upsert races are absorbed by the unique
 * constraints on clerk_user_id / email, so two concurrent first-requests can
 * never mint duplicate rows. Allowlisted emails are promoted to super_admin
 * on every resolve (covers allowlist edits after first sign-in). Users who
 * arrive via an invite get the invite's role/assignments stamped exactly once
 * (the invite row flips to accepted atomically via a conditional update).
 */
export async function resolveTeamUser(): Promise<TeamUser> {
  const { userId } = await auth()
  if (!userId) throw new AuthzError('Not signed in', 401)

  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase()
  if (!email) throw new AuthzError('No email on account', 403)

  const allowlist = parseAllowlist(process.env.SUPER_ADMIN_EMAILS)
  const isSuper = isAllowlistedSuperAdmin(email, allowlist)

  // fast path — known identity
  const { data: existing } = await supabase
    .from('team_users')
    .select('*')
    .eq('clerk_user_id', userId)
    .maybeSingle()

  if (existing) {
    if (isSuper && existing.role !== 'super_admin') {
      const { data: promoted } = await supabase
        .from('team_users')
        .update({ role: 'super_admin' })
        .eq('id', existing.id)
        .select()
        .single()
      return (promoted ?? existing) as TeamUser
    }
    return existing as TeamUser
  }

  // first sign-in: consume a pending invite if one exists (atomic claim —
  // the conditional update means exactly one request can flip it)
  let role: Role = isSuper ? 'super_admin' : 'editor'
  let invite: {
    id: string; role: Role; employment_type: string; timezone: string
    client_id: string | null; assigned_client_ids: string[]
  } | null = null

  if (!isSuper) {
    const { data: claimed } = await supabase
      .from('team_invites')
      .update({ status: 'accepted' })
      .eq('status', 'pending')
      .ilike('email', email)
      .select()
      .maybeSingle()
    if (claimed) {
      invite = claimed
      role = claimed.role as Role
    } else {
      // no invite and not allowlisted → no access. Do not create a row.
      throw new AuthzError('No invitation found for this account. Ask an admin to invite you.', 403)
    }
  }

  const { data: created, error } = await supabase
    .from('team_users')
    .upsert(
      {
        clerk_user_id: userId,
        email,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email,
        role,
        employment_type: invite?.employment_type ?? 'employee',
        timezone: invite?.timezone ?? 'Australia/Melbourne',
        client_id: invite?.client_id ?? null,
      },
      { onConflict: 'email' }
    )
    .select()
    .single()
  if (error || !created) throw new AuthzError(error?.message ?? 'Could not create user', 500)

  // stamp m2m client assignments from the invite (composite PK absorbs re-runs)
  if (invite && invite.assigned_client_ids.length > 0) {
    await supabase.from('team_user_clients').upsert(
      invite.assigned_client_ids.map(client_id => ({ team_user_id: created.id, client_id })),
      { onConflict: 'team_user_id,client_id', ignoreDuplicates: true }
    )
  }

  return created as TeamUser
}

/** Route guard: resolve + require a minimum role. */
export async function requireRole(required: Role): Promise<TeamUser> {
  const tu = await resolveTeamUser()
  if (!tu.active_status) throw new AuthzError('Account deactivated', 403)
  if (!roleSatisfies(tu.role, required)) throw new AuthzError('Insufficient permissions', 403)
  return tu
}

/** Wrap an API handler body with authz error → HTTP response mapping. */
export function authzErrorResponse(e: unknown): { error: string; status: number } {
  if (e instanceof AuthzError) return { error: e.message, status: e.status }
  return { error: e instanceof Error ? e.message : 'Internal error', status: 500 }
}

/**
 * Route guard as a one-liner: returns a Response to send back, or null to
 * continue.
 *
 *     const denied = await guard('account_manager')
 *     if (denied) return denied
 *
 * Middleware only proves someone is signed in, and clients sign in too, so
 * every route that touches agency data needs a role check of its own.
 */
export async function guard(required: Role): Promise<NextResponse | null> {
  try {
    await requireRole(required)
    return null
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
