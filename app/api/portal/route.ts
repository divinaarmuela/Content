import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { accessibleClientIds } from '../../lib/production-access'
import { getPortalData } from '../../lib/portal-data'

/** Portal payload for the signed-in viewer. Clients get their own workspace;
 *  AMs/admins may preview any client they can access via ?client_id=. */
export async function GET(req: Request) {
  try {
    const user = await requireRole('client')
    const url = new URL(req.url)
    const requested = url.searchParams.get('client_id')

    let clientId: string | null = null
    if (user.role === 'client') {
      clientId = user.client_id
    } else {
      clientId = requested
      const clientIds = await accessibleClientIds(user)
      if (clientId && clientIds !== null && !clientIds.includes(clientId)) {
        return NextResponse.json({ error: 'Not your client' }, { status: 403 })
      }
    }
    if (!clientId) return NextResponse.json({ error: 'No client workspace linked to this account' }, { status: 400 })

    const data = await getPortalData(clientId)
    if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    return NextResponse.json({ ...data, viewer_role: user.role })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
