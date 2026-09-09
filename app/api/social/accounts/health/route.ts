import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { assertClientAccess } from '../../../../lib/social-schedule'
import { refreshClientAccountsHealth } from '../../../../lib/account-health'

/**
 * Re-read one client's accounts' health from the provider NOW.
 *
 * The morning check writes the verdict once a day; a rule change (or a
 * reconnect the provider has already taken) should not stand until 7 am
 * tomorrow on the Schedule page's icons. Schedulers and above, on a client
 * they hold — the same gate as reconnecting. No emails: that is the
 * morning's job.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { clientId } = await req.json().catch(() => ({})) as { clientId?: unknown }
    if (typeof clientId !== 'string' || !clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }
    await assertClientAccess(user, clientId)
    const tally = await refreshClientAccountsHealth(clientId)
    return NextResponse.json(tally)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
