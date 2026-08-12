import { NextRequest, NextResponse } from 'next/server'
import { respondToShoot } from '../../../lib/shoots'

/**
 * PUBLIC — the client's Yes/No, POSTed by the buttons on /shoot/[token].
 * The unguessable token is the credential, same trust model as the intake
 * form. Deliberately a POST: a GET answer could be fired by an email
 * scanner prefetching links.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  const answer = body.answer === 'yes' ? 'yes' : body.answer === 'no' ? 'no' : null
  if (!answer) return NextResponse.json({ error: 'Answer must be yes or no' }, { status: 400 })

  const proposal = await respondToShoot(token, answer)
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ status: proposal.status })
}
