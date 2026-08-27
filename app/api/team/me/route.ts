import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { resolveTeamUser, authzErrorResponse } from '@/app/lib/authz'
import { isValidZone } from '@/app/lib/timezone-core'

/**
 * The signed-in user's resolved identity.
 *
 * This exists because the dashboard shell previously read the role from Clerk
 * `publicMetadata` and fell back to 'admin' when it was absent — so anyone
 * whose metadata had not been stamped rendered the full admin navigation,
 * including a client. The server's source of truth is the `team_users` row,
 * and this is how the browser gets it.
 *
 * It is still only presentation input. Every route enforces its own role
 * check; hiding a control is a courtesy, never the control itself.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const me = await resolveTeamUser()
    const { data } = await supabase
      .from('team_users')
      .select('workday_start, workday_end, notification_prefs')
      .eq('id', me.id)
      .maybeSingle()

    return NextResponse.json({
      id: me.id,
      email: me.email,
      name: me.name,
      role: me.role,
      employment_type: me.employment_type,
      timezone: me.timezone,
      active: me.active_status,
      workday_start: data?.workday_start ?? '09:00',
      workday_end: data?.workday_end ?? '17:00',
      notification_prefs: data?.notification_prefs ?? { email: true },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/**
 * Update your own profile.
 *
 * The whitelist is the point. Role, email, employment type and active status
 * are deliberately absent: they are how the system decides what you may do and
 * whether you may sign in, so letting the account holder set them would make
 * every other permission check decorative. Those are changed by a super admin
 * in Team. Email comes from Clerk in any case.
 *
 * The row is chosen by the session, never by an id in the body — otherwise
 * this becomes "edit anyone's profile".
 */
export async function PATCH(req: Request) {
  try {
    const me = await resolveTeamUser()
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    // the browser syncs this on sign-in, so it arrives unattended — a zone
    // the platform cannot format would silently become UTC in the overdue
    // rollups that read it
    if (typeof body.timezone === 'string' && isValidZone(body.timezone)) {
      patch.timezone = body.timezone.trim()
    }
    for (const k of ['workday_start', 'workday_end'] as const) {
      if (typeof body[k] === 'string' && body[k]) patch[k] = body[k]
    }
    if (body.notification_prefs && typeof body.notification_prefs === 'object') {
      patch.notification_prefs = body.notification_prefs
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('team_users')
      .update(patch)
      .eq('id', me.id)
      .select('id,email,name,role,employment_type,timezone,active_status,workday_start,workday_end,notification_prefs')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ...data, active: data.active_status })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
