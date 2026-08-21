import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { logActivity } from '../../../../lib/workflow'
import { ASSIGNABLE_ROLES, KIND_COLORS } from '../../../../lib/work-kinds-core'

/** Edit or archive a work type. Slug is immutable; kinds are archived
 *  (active=false), never deleted — old items keep their label. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json()

    const patch: Record<string, unknown> = {}
    if ('name' in body) {
      const name = String(body.name ?? '').trim()
      if (!name || name.length > 80) return NextResponse.json({ error: 'Name must be 1–80 characters' }, { status: 422 })
      patch.name = name
    }
    if ('default_roles' in body) {
      const roles = Array.isArray(body.default_roles) ? body.default_roles.map((x: unknown) => String(x)) : []
      if (roles.some((r: string) => !(ASSIGNABLE_ROLES as readonly string[]).includes(r))) {
        return NextResponse.json({ error: 'Unknown role in suggestions' }, { status: 422 })
      }
      patch.default_roles = [...new Set(roles)]
    }
    if ('uses_media' in body) patch.uses_media = body.uses_media !== false
    if ('color' in body) {
      if (!(KIND_COLORS as readonly string[]).includes(String(body.color))) {
        return NextResponse.json({ error: 'Pick a colour from the list' }, { status: 422 })
      }
      patch.color = body.color
    }
    if ('active' in body) patch.active = body.active !== false
    if ('sort_order' in body && Number.isInteger(body.sort_order)) patch.sort_order = body.sort_order
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    }

    const { data, error } = await supabase.from('work_kinds').update(patch).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    await logActivity({
      actor: user, entityType: 'work_kind', entityId: id,
      action: 'updated', detail: Object.keys(patch).join(', '),
    })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
