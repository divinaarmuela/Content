import { NextResponse } from 'next/server'
import { DbError, table, withRequestCache } from '@/lib/db'
import type { WorkKind as WorkKindRow } from '@/lib/db-types'
import { requireSignedIn, requireRole, authzErrorResponse, AuthzError } from '../../../lib/authz'
import { logActivity } from '../../../lib/workflow'
import { validateKindInput } from '../../../lib/work-kinds-core'

/** The team's work types (edit, graphics, copy…) — data, not code. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') throw new AuthzError('Not available to client accounts', 403)
    const activeOnly = new URL(req.url).searchParams.get('active') === '1'
    const kinds = await table<WorkKindRow>('work_kinds').list({
      where: activeOnly ? r => r.active === true : undefined,
      orderBy: [['sort_order', 'asc'], ['name', 'asc']],
    })
    return NextResponse.json({ kinds })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Add a work type. AM+ — this shapes how the whole team's work is filed. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const body = await req.json()
    const check = validateKindInput(body)
    if (!check.ok) return NextResponse.json({ error: check.errors.join('; ') }, { status: 422 })

    const count = await table<WorkKindRow>('work_kinds').count()
    let data
    try {
      // `active` and `sort_order` were column defaults in Postgres; a work
      // kind that reads back without `active` is never offered anywhere.
      data = await table('work_kinds').insert({ ...check.value, active: true, sort_order: count })
    } catch (e) {
      if (e instanceof DbError && e.code === 'unique') {
        return NextResponse.json({ error: 'A work type with that name already exists' }, { status: 409 })
      }
      throw e
    }
    await logActivity({
      actor: user, entityType: 'work_kind', entityId: data.id,
      action: 'created', newValue: String(data.name),
    })
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
