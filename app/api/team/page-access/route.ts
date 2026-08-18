import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { normaliseGrantedPages } from '../../../lib/page-access-core'
import type { Role } from '../../../lib/identity-core'

/**
 * Extra dashboard pages opened to individual people.
 *
 * Everyone gets `mine` — the pages granted to them — because the sidebar
 * cannot render without it and it tells the caller nothing about anybody
 * else. A super admin additionally gets the whole map, to administer it.
 * Writing is super_admin only.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireRole('scheduler')   // any team role

    const { data: mineRows } = await supabase
      .from('user_page_access').select('href').eq('team_user_id', user.id)
    const mine = (mineRows ?? []).map(r => r.href as string)

    if (user.role !== 'super_admin') return NextResponse.json({ mine })

    const [{ data: grants }, { data: members }] = await Promise.all([
      supabase.from('user_page_access').select('team_user_id, href'),
      supabase.from('team_users')
        .select('id, name, email, role, active_status')
        .eq('active_status', true)
        .neq('role', 'client')
        .order('name'),
    ])

    const byUser: Record<string, string[]> = {}
    for (const g of grants ?? []) {
      byUser[g.team_user_id] = [...(byUser[g.team_user_id] ?? []), g.href]
    }

    return NextResponse.json({ mine, grants: byUser, members: members ?? [] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Replace one person's granted pages. */
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireRole('super_admin')
    const body = await req.json().catch(() => ({}))
    const teamUserId = String(body?.team_user_id ?? '').trim()
    if (!teamUserId) return NextResponse.json({ error: 'Missing team_user_id' }, { status: 400 })

    // the person's own role decides which grants are meaningful, so it is read
    // here rather than trusted from the browser
    const { data: target } = await supabase
      .from('team_users').select('id, role').eq('id', teamUserId).maybeSingle()
    if (!target) return NextResponse.json({ error: 'No such team member' }, { status: 404 })
    if (target.role === 'client') {
      return NextResponse.json({ error: 'Client accounts have no dashboard pages' }, { status: 400 })
    }

    const hrefs = normaliseGrantedPages(body?.hrefs, target.role as Role)

    // replace wholesale: delete then insert, so a removed tick really goes
    await supabase.from('user_page_access').delete().eq('team_user_id', teamUserId)
    if (hrefs.length > 0) {
      const { error } = await supabase.from('user_page_access').insert(
        hrefs.map(href => ({ team_user_id: teamUserId, href, granted_by: admin.email })),
      )
      if (error) throw new Error(error.message)
    }

    const { data: grants } = await supabase.from('user_page_access').select('team_user_id, href')
    const byUser: Record<string, string[]> = {}
    for (const g of grants ?? []) {
      byUser[g.team_user_id] = [...(byUser[g.team_user_id] ?? []), g.href]
    }
    return NextResponse.json({ grants: byUser })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
