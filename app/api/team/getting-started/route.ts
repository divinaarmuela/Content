import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TeamUser } from '@/lib/db-types'
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
 * own: those go into `getting_started_dismissed_pages` as "role:page" keys.
 *
 * A failed write is not an error here. The panel is help, not a feature — if
 * the database refuses it the panel simply keeps appearing (and the browser
 * remembers the dismissal instead), which is a far better failure than a red
 * toast on every page load.
 */

export const dynamic = 'force-dynamic'

const PAGES: GettingStartedPage[] = ['overview', 'editor', 'scheduler', 'production', 'item']

export async function GET() {
  return withRequestCache(async () => {
  try {
    const me = await resolveTeamUser()
    // somebody who has never dismissed anything simply has no such fields
    const data = await table<TeamUser>('team_users').get(me.id)

    const pages = data?.getting_started_dismissed_pages
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
  })
}

/** Dismiss it — for the Overview, the role the person holds right now; for a
 *  work page, that page in that role. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const me = await resolveTeamUser()
    const body = await req.json().catch(() => ({})) as { page?: unknown }
    const page = PAGES.includes(body.page as GettingStartedPage) ? body.page as GettingStartedPage : 'overview'

    if (page === 'overview') {
      try {
        await table('team_users').update(me.id, {
          getting_started_dismissed_at: new Date().toISOString(),
          getting_started_dismissed_role: me.role,
        })
      } catch (e) {
        console.error('[getting-started] could not save dismissal', (e as Error).message)
        return NextResponse.json({ ok: false })
      }
      return NextResponse.json({ ok: true })
    }

    const data = await table<TeamUser>('team_users').get(me.id)
    const have = Array.isArray(data?.getting_started_dismissed_pages)
      ? (data.getting_started_dismissed_pages as unknown[]).filter((p): p is string => typeof p === 'string')
      : []
    const next = [...new Set([...have, dismissKey(page, me.role)])]
    try {
      await table('team_users').update(me.id, { getting_started_dismissed_pages: next })
    } catch (e) {
      // The panel hides locally either way; failing loudly here would put a
      // database message in front of somebody who pressed "Got it".
      console.error('[getting-started] could not save page dismissal', (e as Error).message)
      return NextResponse.json({ ok: false })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
