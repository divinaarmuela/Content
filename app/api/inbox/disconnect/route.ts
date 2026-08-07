import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { disconnectInbox } from '../../../lib/inbox-connect'

/**
 * Forget a mailbox's stored token.
 *
 * super_admin only, and deliberately separate from the enabled/disabled
 * toggle: switching a mailbox off pauses it, disconnecting throws the grant
 * away and requires its owner to consent again.
 *
 * This does NOT revoke the grant at Google — only the account holder can do
 * that, in their own Google security settings. The response says so rather
 * than implying an access we cannot actually take away.
 */
export async function POST(req: Request) {
  try {
    await requireRole('super_admin')
    const body = await req.json().catch(() => ({}))
    const email = String(body?.email ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

    await disconnectInbox(email)
    return NextResponse.json({
      ok: true,
      note: 'To revoke access at Google as well, remove it in that account’s security settings.',
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
