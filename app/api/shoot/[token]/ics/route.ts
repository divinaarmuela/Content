import { NextRequest, NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { shootIcs } from '../../../../lib/shoot-core'

/**
 * PUBLIC — "Add to my calendar" on an accepted shoot date (the owner, 2 Oct 2026: the calendar invite, "lets make
 * it in the portal"). The client is never emailed, so the calendar file the "Locked in" email used to carry is
 * downloaded from the page instead. Same token, same trust as the Yes/No: it grants this one event, nothing else,
 * and only once the date is accepted.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
 return withRequestCache(async () => {
  const { token } = await params
  const { getShootByToken } = await import('../../../../lib/shoots')
  const proposal = await getShootByToken(token)
  if (!proposal || proposal.status !== 'accepted') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ics = shootIcs({
    uid: proposal.id,
    title: `${proposal.title} — MD Media`,
    startsAt: proposal.starts_at,
    endsAt: proposal.ends_at,
    location: proposal.location,
    note: proposal.note,
    organizerEmail: 'hello@mdmmarketing.com.au',
    attendeeEmail: String(proposal.send_to ?? '').split(/[,;\s]+/).filter(Boolean)[0] ?? 'hello@mdmmarketing.com.au',
  })
  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="shoot.ics"',
      'Cache-Control': 'no-store',
    },
  })
 })
}
