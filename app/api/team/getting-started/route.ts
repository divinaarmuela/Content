import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { resolveTeamUser, authzErrorResponse } from '@/app/lib/authz'
import { dismissKey, type GettingStartedPage } from '@/app/lib/getting-started-core'

/**
 * "Got it" on the Getting started panel.
 *
 * The dismissal stores the ROLE it was pressed in, not just a flag: someone
 * promoted from editor to account manager is doing a different job and earns
 * that job's three steps once. shouldShowGettingStarted() in
 * getting-started-core.ts is the rule; this is only its storage.
 *
 * Since wave 2 the panel is also on the work pages, each dismissed on its
 * own: those go into `getting_started_dismissed_pages` as "role:page" keys
 * (supabase/getting_started_pages.sql).
 *
 * Missing column is not an error here. The panel is help, not a feature — if
 * the SQL has not been run yet the panel simply keeps appearing (and the
 * browser remembers the dismissal instead), which is a far better failure
 * than a red toast on every page load.
 */

export const dynamic = 'force-dynamic'

const PAGES: GettingStartedPage[] = ['overview', 'editor', 'scheduler', 'production', 'item']

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
    let { data, error } = await supabase
      .from('team_users')
      .select('getting_started_dismissed_at, getting_started_dismissed_role, getting_started_dismissed_pages')
      .eq('id', me.id)
      .maybeSingle()

    // the pages column may be newer than the role column — fall back to the
    // wave-1 shape before giving up
    if (error && isMissingColumn(error.message)) {
      const again = await supabase
        .from('team_users')
        .select('getting_started_dismissed_at, getting_started_dismissed_role')
        .eq('id', me.id)
        .maybeSingle()
      data = again.data as typeof data
      error = again.error
    }
    if (error && !isMissingColumn(error.message)) throw new Error(error.message)
    if (error) {
      console.error('[getting-started] column missing — run supabase/getting_started.sql', error.message)
      return NextResponse.json({ dismissedAt: null, dismissedRole: null, dismissedPages: [], role: me.role })
    }

    const pages = (data as { getting_started_dismissed_pages?: unknown } | null)?.getting_started_dismissed_pages
    return NextResponse.json({
      dismissedAt: data?.getting_started_dismissed_at ?? null,
      dismissedRole: data?.getting_started_dismissed_role ?? null,
      dismissedPages: Array.isArray(pages) ? pages.filter(p => typeof p === 'string') : [],
      role: me.role,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Dismiss it — for the Overview, the role the person holds right now; for a
 *  work page, that page in that role. */
export async function POST(req: Request) {
  try {
    const me = await resolveTeamUser()
    const body = await req.json().catch(() => ({})) as { page?: unknown }
    const page = PAGES.includes(body.page as GettingStartedPage) ? body.page as GettingStartedPage : 'overview'

    if (page === 'overview') {
      const { error } = await supabase
        .from('team_users')
        .update({
          getting_started_dismissed_at: new Date().toISOString(),
          getting_started_dismissed_role: me.role,
        })
        .eq('id', me.id)
      if (error) {
        console.error('[getting-started] could not save dismissal', error.message)
        return NextResponse.json({ ok: false })
      }
      return NextResponse.json({ ok: true })
    }

    const { data } = await supabase
      .from('team_users').select('getting_started_dismissed_pages').eq('id', me.id).maybeSingle()
    const have = Array.isArray(data?.getting_started_dismissed_pages)
      ? (data!.getting_started_dismissed_pages as unknown[]).filter((p): p is string => typeof p === 'string')
      : []
    const next = [...new Set([...have, dismissKey(page, me.role)])]
    const { error } = await supabase
      .from('team_users')
      .update({ getting_started_dismissed_pages: next })
      .eq('id', me.id)
    if (error) {
      // The panel hides locally either way; failing loudly here would put a
      // database message in front of someone who pressed "Got it".
      console.error('[getting-started] could not save page dismissal — run supabase/getting_started_pages.sql', error.message)
      return NextResponse.json({ ok: false })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
