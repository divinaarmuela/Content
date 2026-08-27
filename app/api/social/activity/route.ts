import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { inboxActivity } from '@/app/lib/zernio-events'

export const dynamic = 'force-dynamic'

/**
 * "Has anything landed in the inbox since I loaded this page?"
 *
 * The Inbox reads its conversations LIVE from Zernio, so there is no local
 * message store for a `message.received` webhook to be written into — and
 * polling the provider on a timer to find out would put every open Inbox tab
 * on their rate limit for the sake of a message that usually is not there.
 *
 * So the webhook's own delivery log answers instead. One indexed query against
 * our own database, cheap enough to ask every thirty seconds, and it tells the
 * page exactly when it is worth spending a real round trip to the provider.
 * That is the difference between an Inbox that updates in seconds and one that
 * updates when somebody thinks to reload it.
 *
 * Scheduler-gated like every other social read.
 */
export async function GET(req: Request) {
  try {
    await requireRole('scheduler')
    const since = new URL(req.url).searchParams.get('since')
    return NextResponse.json(await inboxActivity(since))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
