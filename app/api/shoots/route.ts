import { NextRequest, NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { normaliseRecipients } from '../../lib/intake-core'
import { createShootProposal, listShootProposals, listAllShootProposals } from '../../lib/shoots'

export const dynamic = 'force-dynamic'

/** With from/to: proposals overlapping that window (the Availability week).
 *  Without: every proposal, newest first (the Proposals register). */
export async function GET(req: NextRequest) {
 return withRequestCache(async () => {
  try {
    // scheduler+ may READ proposals (they live on Availability/Proposals);
    // creating and cancelling stays editor+.
    await requireRole('scheduler')
    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')
    if (!from && !to) {
      return NextResponse.json({ proposals: await listAllShootProposals() })
    }
    if (!from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
      return NextResponse.json({ error: 'Missing or invalid from/to' }, { status: 400 })
    }
    return NextResponse.json({
      proposals: await listShootProposals(new Date(from).toISOString(), new Date(to).toISOString()),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}

export async function POST(req: NextRequest) {
 return withRequestCache(async () => {
  try {
    // Booking a shoot is work like the rest of it. This asked for `editor`,
    // which left a scheduler able to SEE every shoot (the GET above is
    // 'scheduler') and unable to make one — and whose shoot it then is gets
    // answered by assignment on the boards, not by the create gate.
    const user = await requireRole('scheduler')
    const body = await req.json()

    const client_id = String(body.client_id ?? '').trim()
    const title = String(body.title ?? '').trim().slice(0, 200)
    const starts_at = String(body.starts_at ?? '')
    const ends_at = String(body.ends_at ?? '')
    // one address or several — a string still works for older callers
    const send_to = (Array.isArray(body.send_to) ? body.send_to : [body.send_to])
      .map((e: unknown) => String(e ?? '').trim().toLowerCase()).filter(Boolean)

    if (!client_id) return NextResponse.json({ error: 'Pick a client' }, { status: 400 })
    if (!title) return NextResponse.json({ error: 'Give the shoot a title' }, { status: 400 })
    if (isNaN(Date.parse(starts_at)) || isNaN(Date.parse(ends_at))) {
      return NextResponse.json({ error: 'Invalid start or end time' }, { status: 400 })
    }
    if (Date.parse(ends_at) <= Date.parse(starts_at)) {
      return NextResponse.json({ error: 'The shoot must end after it starts' }, { status: 400 })
    }
    if (send_to.length === 0) {
      return NextResponse.json({ error: 'Pick at least one recipient' }, { status: 400 })
    }
    const bad = send_to.find((e: string) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    if (bad) {
      return NextResponse.json({ error: `"${bad}" is not a valid email address` }, { status: 400 })
    }

    const proposal = await createShootProposal({
      client_id, title,
      starts_at: new Date(starts_at).toISOString(),
      ends_at: new Date(ends_at).toISOString(),
      location: String(body.location ?? '').trim().slice(0, 200) || null,
      note: String(body.note ?? '').trim().slice(0, 1000) || null,
      send_to,
      // cleaned like the intake lists: lowercased, deduped, implausible dropped
      notify_emails: normaliseRecipients(body.notify_emails),
      created_by: user.email,
      created_by_name: user.name,
      created_by_clerk_id: user.clerk_user_id,
    })
    return NextResponse.json({ proposal })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}
