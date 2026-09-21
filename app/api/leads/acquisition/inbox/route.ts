import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { listMailboxEntries } from '../../../../lib/scan-settings'
import { allowedMailDomain } from '../../../../lib/clerk-gmail'

/**
 * WHICH INBOXES THE AGENT READS, AND IS MINE ONE OF THEM (the owner, 21 Sep
 * 2026: "can the partnerships email be prompted to log in when visiting this
 * page"). The acquisition agent only sees mail in a connected inbox, so a
 * prospect's reply to Joy at partnerships@ is invisible until that inbox is
 * connected. Answers for the signed-in person only: their own work address,
 * whether it is read, and the addresses that are. Any team role — this is the
 * acquisition page's own question, not the scanner's settings.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler') // any team role; excludes `client`
      const entries = await listMailboxEntries()
      const read = entries.filter(e => e.enabled).map(e => e.email.toLowerCase())
      const mine = String(user.email ?? '').toLowerCase()
      const workAddress = mine.endsWith(`@${allowedMailDomain()}`)
      return NextResponse.json({
        read,
        mine: { email: mine || null, work_address: workAddress, connected: read.includes(mine), switched_off: entries.some(e => e.email.toLowerCase() === mine && !e.enabled) },
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
