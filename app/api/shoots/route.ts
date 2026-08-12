import { NextRequest, NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { createShootProposal, listShootProposals } from '../../lib/shoots'

export const dynamic = 'force-dynamic'

/** Proposals overlapping [from, to) — the Availability week overlay. */
export async function GET(req: NextRequest) {
  try {
    await requireRole('editor')
    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')
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
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole('editor')
    const body = await req.json()

    const client_id = String(body.client_id ?? '').trim()
    const title = String(body.title ?? '').trim().slice(0, 200)
    const starts_at = String(body.starts_at ?? '')
    const ends_at = String(body.ends_at ?? '')
    const send_to = String(body.send_to ?? '').trim().toLowerCase()

    if (!client_id) return NextResponse.json({ error: 'Pick a client' }, { status: 400 })
    if (!title) return NextResponse.json({ error: 'Give the shoot a title' }, { status: 400 })
    if (isNaN(Date.parse(starts_at)) || isNaN(Date.parse(ends_at))) {
      return NextResponse.json({ error: 'Invalid start or end time' }, { status: 400 })
    }
    if (Date.parse(ends_at) <= Date.parse(starts_at)) {
      return NextResponse.json({ error: 'The shoot must end after it starts' }, { status: 400 })
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(send_to)) {
      return NextResponse.json({ error: 'Enter a valid email to send the proposal to' }, { status: 400 })
    }

    const proposal = await createShootProposal({
      client_id, title,
      starts_at: new Date(starts_at).toISOString(),
      ends_at: new Date(ends_at).toISOString(),
      location: String(body.location ?? '').trim().slice(0, 200) || null,
      note: String(body.note ?? '').trim().slice(0, 1000) || null,
      send_to,
      created_by: user.email,
    })
    return NextResponse.json({ proposal })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
