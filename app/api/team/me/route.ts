import { NextResponse } from 'next/server'
import { resolveTeamUser, authzErrorResponse } from '@/app/lib/authz'

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
    return NextResponse.json({
      id: me.id,
      email: me.email,
      name: me.name,
      role: me.role,
      employment_type: me.employment_type,
      timezone: me.timezone,
      active: me.active_status,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
