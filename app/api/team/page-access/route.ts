import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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

export async function GET() {
  try {
    const user = await requireRole('scheduler')   // any team role

    const { data: mineRows } = await supabase
      .from('user_page_access').select('href, hidden').eq('team_user_id', user.id)
    const mine = (mineRows ?? []).filter(r => !r.hidden).map(r => r.href as string)
    const hidden = (mineRows ?? []).filter(r => r.hidden).map(r => r.href as string)

    if (user.role !== 'super_admin') return NextResponse.json({ mine, hidden })

    const [{ data: grants }, { data: members }] = await Promise.all([
      supabase.from('user_page_access').select('team_user_id, href, hidden'),
      supabase.from('team_users')
        .select('id, name, email, role, active_status, clerk_user_id')
        .eq('active_status', true)
        .neq('role', 'client')
        .order('name'),
    ])

    const byUser: Record<string, string[]> = {}
    const hiddenByUser: Record<string, string[]> = {}
    for (const g of grants ?? []) {
      const map = g.hidden ? hiddenByUser : byUser
      map[g.team_user_id] = [...(map[g.team_user_id] ?? []), g.href]
    }

    return NextResponse.json({ mine, hidden, grants: byUser, hiddenByUser, members: members ?? [] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Replace one person's granted pages (super admin), or replace YOUR OWN
 *  hidden pages (any team role — `self_hidden` in the body). */
export async function PATCH(req: NextRequest) {
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
      await supabase.from('user_page_access')
        .delete().eq('team_user_id', user.id).eq('hidden', true)
      if (hrefs.length > 0) {
        const { error } = await supabase.from('user_page_access').insert(
          hrefs.map(href => ({ team_user_id: user.id, href, hidden: true, granted_by: user.email })),
        )
        if (error) throw new Error(error.message)
      }
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
      await supabase.from('user_page_access')
        .delete().eq('team_user_id', teamUserId).eq('hidden', true)
      if (hrefs.length > 0) {
        const { error } = await supabase.from('user_page_access').insert(
          hrefs.map(href => ({ team_user_id: teamUserId, href, hidden: true, granted_by: admin.email })),
        )
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ hidden: hrefs })
    }

    // the person's own role decides which grants are meaningful, so it is read
    // here rather than trusted from the browser
    const { data: target } = await supabase
      .from('team_users').select('id, role').eq('id', teamUserId).maybeSingle()
    if (!target) return NextResponse.json({ error: 'No such team member' }, { status: 404 })
    if (target.role === 'client') {
      return NextResponse.json({ error: 'Client accounts have no dashboard pages' }, { status: 400 })
    }

    const hrefs = normaliseGrantedPages(body?.hrefs, target.role as Role)

    // replace wholesale — but only the GRANT rows; a person's own hides are
    // their preference and survive an admin's grant edit
    await supabase.from('user_page_access')
      .delete().eq('team_user_id', teamUserId).eq('hidden', false)
    if (hrefs.length > 0) {
      const { error } = await supabase.from('user_page_access').insert(
        hrefs.map(href => ({ team_user_id: teamUserId, href, granted_by: admin.email })),
      )
      if (error) throw new Error(error.message)
    }

    const { data: grants } = await supabase.from('user_page_access').select('team_user_id, href, hidden')
    const byUser: Record<string, string[]> = {}
    for (const g of grants ?? []) {
      if (g.hidden) continue
      byUser[g.team_user_id] = [...(byUser[g.team_user_id] ?? []), g.href]
    }
    return NextResponse.json({ grants: byUser })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
