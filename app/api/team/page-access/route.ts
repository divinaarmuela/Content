import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { normaliseGrantRoles } from '../../../lib/page-access-core'

/**
 * Which dashboard pages a super admin has opened to extra roles.
 *
 * Reading is open to any signed-in team member: the sidebar needs it to know
 * what to render, and it reveals nothing beyond "this page exists". Writing
 * is super_admin only.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole('scheduler')     // any team role
    const { data, error } = await supabase.from('page_access').select('href, roles')
    if (error) throw new Error(error.message)
    const access: Record<string, string[]> = {}
    for (const row of data ?? []) access[row.href] = row.roles ?? []
    return NextResponse.json({ access })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireRole('super_admin')
    const body = await req.json().catch(() => ({}))
    const href = String(body?.href ?? '').trim()
    if (!href.startsWith('/dashboard')) {
      return NextResponse.json({ error: 'That is not a dashboard page' }, { status: 400 })
    }
    const roles = normaliseGrantRoles(body?.roles)

    const { error } = await supabase.from('page_access').upsert({
      href, roles, updated_at: new Date().toISOString(), updated_by: admin.email,
    })
    if (error) throw new Error(error.message)

    const { data } = await supabase.from('page_access').select('href, roles')
    const access: Record<string, string[]> = {}
    for (const row of data ?? []) access[row.href] = row.roles ?? []
    return NextResponse.json({ access })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
