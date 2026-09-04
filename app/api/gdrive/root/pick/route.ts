import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { choosePickedRoot } from '../../../../lib/gdrive-root'

/**
 * "This folder is the filing cabinet."
 *
 * The browser sends only the id the Picker returned. The name and the owner
 * are read back from Drive with the server's own token rather than trusted
 * from the request — which doubles as the check that the Picker's grant
 * actually reached this app.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const user = await requireRole('super_admin')
    const body = await req.json().catch(() => ({})) as { id?: string; name?: string }
    const result = await choosePickedRoot({
      id: String(body.id ?? ''), name: body.name ?? null, by: user.email,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
