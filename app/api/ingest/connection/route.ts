import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { guard } from '../../../lib/authz'
import { getConnectionStatus, listConnectedMailboxes } from '../../../lib/clerk-gmail'
import { getMailboxes } from '../../../lib/gmail'

/** Is the signed-in user's inbox connected for lead scanning, and which
 *  mailboxes are currently covered overall.
 *
 *  Gated at account_manager: `shared` and `connected` enumerate the agency's
 *  mailboxes, which is infrastructure rather than the caller's own data. A
 *  bare signed-in check exposed that list to clients, who sign in too. */
export async function GET() {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [mine, connected] = await Promise.all([
    getConnectionStatus(userId),
    listConnectedMailboxes(),
  ])
  const shared = getMailboxes().map(m => m.email)
  const seen = new Set(shared)

  return NextResponse.json({
    mine,
    shared,
    connected: connected.map(m => m.email).filter(e => !seen.has(e)),
  })
}
