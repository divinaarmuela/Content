import { NextRequest, NextResponse } from 'next/server'
import { table, withRequestCache, encodeKey } from '@/lib/db'
import type { TeamUser, UserPageAccess } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { normaliseGrantedPages, isGrantablePage } from '../../../lib/page-access-core'
import type { Role } from '../../../lib/identity-core'

/**
 * Per-person page visibility, two directions:
 *  - GRANTS (hidden=false): a super admin opens extra pages to a person.
 *  - HIDES  (hidden=true): a person mutes pages for THEMSELVES — a
 *    preference, not a permission change. A super admin who hides Leads
 *    still holds super-admin API access; the dashboard just stops showing
 *    the page and its data surfaces.
 *
 * Everyone gets `mine` + `hidden`; a super admin additionally gets the whole
 * grants map to administer it. Granting is super_admin; hiding is self-serve.
 */
export const dynamic = 'force-dynamic'

const access = () => table<UserPageAccess & { hidden?: boolean }>('user_page_access')

/**
 * Replace one person's GRANT rows or their HIDE rows, never both.
 *
 * The row id is (team_user_id, href), so a hide and a grant for the SAME page
 * would be the same row. Postgres had one row per (person, href) too, and the
 * two sets were kept apart by writing one at a time — so a page the person has
 * muted for themselves is skipped when grants are replaced, and vice versa.
 * Silently flipping their hide into a grant is the bug that would look like
 * "Settings keeps un-hiding Leads for me".
 */
async function replaceRows(teamUserId: string, hidden: boolean, hrefs: string[], by: string) {
  const mine = await access().list({ by: { team_user_id: teamUserId }, fresh: true })
  const otherSet = new Set(mine.filter(r => Boolean(r.hidden) !== hidden).map(r => r.href))
  await access().removeWhere(r => r.team_user_id === teamUserId && Boolean(r.hidden) === hidden)
  for (const href of hrefs) {
    if (otherSet.has(href)) continue
    await table('user_page_access').upsert({
      id: `${teamUserId}__${encodeKey(href)}`,
      team_user_id: teamUserId, href, hidden, granted_by: by,
      granted_at: new Date().toISOString(),
    })
  }
}

export async function GET() {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')   // any team role

    const mineRows = await access().list({ by: { team_user_id: user.id } })
    const mine = mineRows.filter(r => !r.hidden).map(r => r.href)
    const hidden = mineRows.filter(r => r.hidden).map(r => r.href)

    if (user.role !== 'super_admin') return NextResponse.json({ mine, hidden })

    const [grants, memberRows] = await Promise.all([
      access().list(),
      table<TeamUser>('team_users').list({
        by: { active_status: true },
        where: r => r.role !== 'client',
        orderBy: [['name', 'asc']],
      }),
    ])
    // the projection the old select named
    const members = memberRows.map(r => ({
      id: r.id, name: r.name, email: r.email, role: r.role,
      active_status: r.active_status, clerk_user_id: r.clerk_user_id,
    }))

    const byUser: Record<string, string[]> = {}
    const hiddenByUser: Record<string, string[]> = {}
    for (const g of grants) {
      const map = g.hidden ? hiddenByUser : byUser
      map[g.team_user_id] = [...(map[g.team_user_id] ?? []), g.href]
    }

    return NextResponse.json({ mine, hidden, grants: byUser, hiddenByUser, members })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Replace one person's granted pages (super admin), or replace YOUR OWN
 *  hidden pages (any team role — `self_hidden` in the body). */
export async function PATCH(req: NextRequest) {
  return withRequestCache(async () => {
  try {
    const body = await req.json().catch(() => ({}))

    // ── self-serve: hide pages from myself ──
    if (Array.isArray(body?.self_hidden)) {
      const user = await requireRole('scheduler')
      const hrefs = [...new Set(
        (body.self_hidden as unknown[])
          .filter((h): h is string => typeof h === 'string')
          // the Overview stays: a dashboard with no landing page is a trap
          .filter(h => h !== '/dashboard' && isGrantablePage(h))
      )]
      await replaceRows(user.id, true, hrefs, user.email)
      return NextResponse.json({ hidden: hrefs })
    }

    // ── admin: replace a person's grants ──
    const admin = await requireRole('super_admin')
    const teamUserId = String(body?.team_user_id ?? '').trim()
    if (!teamUserId) return NextResponse.json({ error: 'Missing team_user_id' }, { status: 400 })

    // an admin may also set ANOTHER person's hides — how a super admin's view
    // gets tailored (Yusuf's "no leads for me") by whoever runs the workspace
    if (Array.isArray(body?.hidden_hrefs)) {
      const hrefs = [...new Set(
        (body.hidden_hrefs as unknown[])
          .filter((h): h is string => typeof h === 'string')
          .filter(h => h !== '/dashboard' && isGrantablePage(h))
      )]
      await replaceRows(teamUserId, true, hrefs, admin.email)
      return NextResponse.json({ hidden: hrefs })
    }

    // the person's own role decides which grants are meaningful, so it is read
    // here rather than trusted from the browser
    const target = await table<TeamUser>('team_users').get(teamUserId)
    if (!target) return NextResponse.json({ error: 'No such team member' }, { status: 404 })
    if (target.role === 'client') {
      return NextResponse.json({ error: 'Client accounts have no dashboard pages' }, { status: 400 })
    }

    const hrefs = normaliseGrantedPages(body?.hrefs, target.role as Role)

    // replace wholesale — but only the GRANT rows; a person's own hides are
    // their preference and survive an admin's grant edit
    await replaceRows(teamUserId, false, hrefs, admin.email)

    const grants = await access().list()
    const byUser: Record<string, string[]> = {}
    for (const g of grants) {
      if (g.hidden) continue
      byUser[g.team_user_id] = [...(byUser[g.team_user_id] ?? []), g.href]
    }
    return NextResponse.json({ grants: byUser })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
