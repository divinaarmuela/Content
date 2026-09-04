import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { applyRootPlan, type ApplyRow } from '../../../../lib/gdrive-root'

/**
 * Save the matches, and make the folders that were ticked.
 *
 * Nothing is created anywhere until this route runs: the review screen up to
 * this point is entirely reads. What arrives is the plan AS A PERSON LEFT IT,
 * row by row, so an override they made is what is saved rather than what the
 * matcher first guessed.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    await requireRole('super_admin')
    const body = await req.json().catch(() => ({})) as { rows?: ApplyRow[] }
    const rows = Array.isArray(body.rows) ? body.rows : []
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nothing was selected' }, { status: 400 })
    }
    const result = await applyRootPlan(rows)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result.result)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
