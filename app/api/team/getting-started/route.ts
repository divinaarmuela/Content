import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { resolveTeamUser, authzErrorResponse } from '@/app/lib/authz'

/**
 * "Got it" on the Getting started panel.
 *
 * The dismissal stores the ROLE it was pressed in, not just a flag: someone
 * promoted from editor to account manager is doing a different job and earns
 * that job's three steps once. shouldShowGettingStarted() in
 * getting-started-core.ts is the rule; this is only its storage.
 *
 * Missing column is not an error here. The panel is help, not a feature — if
 * supabase/getting_started.sql has not been run yet the panel simply keeps
 * appearing, which is a far better failure than a red toast on every page load.
 */

export const dynamic = 'force-dynamic'

/** Not-yet-migrated database: treat as "never dismissed", never as a fault. */
function isMissingColumn(message: string | undefined): boolean {
  return !!message && (
    message.includes('schema cache')
    || /column .* does not exist/i.test(message)
  )
}

export async function GET() {
  try {
    const me = await resolveTeamUser()
    const { data, error } = await supabase
      .from('team_users')
      .select('getting_started_dismissed_at, getting_started_dismissed_role')
      .eq('id', me.id)
      .maybeSingle()

    if (error && !isMissingColumn(error.message)) throw new Error(error.message)
    if (error) {
      console.error('[getting-started] column missing — run supabase/getting_started.sql', error.message)
      return NextResponse.json({ dismissedAt: null, dismissedRole: null, role: me.role })
    }

    return NextResponse.json({
      dismissedAt: data?.getting_started_dismissed_at ?? null,
      dismissedRole: data?.getting_started_dismissed_role ?? null,
      role: me.role,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Dismiss it for the role the person holds right now. */
export async function POST() {
  try {
    const me = await resolveTeamUser()
    const { error } = await supabase
      .from('team_users')
      .update({
        getting_started_dismissed_at: new Date().toISOString(),
        getting_started_dismissed_role: me.role,
      })
      .eq('id', me.id)

    if (error) {
      console.error('[getting-started] could not save dismissal', error.message)
      // The panel hides locally either way; failing loudly here would put a
      // database message in front of someone who pressed "Got it".
      return NextResponse.json({ ok: false })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
