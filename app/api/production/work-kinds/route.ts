import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse, AuthzError } from '../../../lib/authz'
import { logActivity } from '../../../lib/workflow'
import { validateKindInput } from '../../../lib/work-kinds-core'

/** The team's work types (edit, graphics, copy…) — data, not code. */
export async function GET(req: Request) {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') throw new AuthzError('Not available to client accounts', 403)
    const activeOnly = new URL(req.url).searchParams.get('active') === '1'
    let q = supabase.from('work_kinds').select('*').order('sort_order').order('name')
    if (activeOnly) q = q.eq('active', true)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ kinds: data ?? [] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Add a work type. AM+ — this shapes how the whole team's work is filed. */
export async function POST(req: Request) {
  try {
    const user = await requireRole('account_manager')
    const body = await req.json()
    const check = validateKindInput(body)
    if (!check.ok) return NextResponse.json({ error: check.errors.join('; ') }, { status: 422 })

    const { count } = await supabase.from('work_kinds').select('id', { count: 'exact', head: true })
    const { data, error } = await supabase
      .from('work_kinds')
      .insert({ ...check.value, sort_order: (count ?? 0) })
      .select()
      .single()
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return NextResponse.json({ error: 'A work type with that name already exists' }, { status: 409 })
      }
      throw new Error(error.message)
    }
    await logActivity({
      actor: user, entityType: 'work_kind', entityId: data.id,
      action: 'created', newValue: data.name,
    })
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
