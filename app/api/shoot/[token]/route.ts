import { NextRequest, NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { commentOnShoot, respondToShoot } from '../../../lib/shoots'
import { proposalComments } from '../../../lib/shoot-core'

/**
 * PUBLIC — the client's Yes/No, POSTed by the buttons on /shoot/[token].
 * The unguessable token is the credential, same trust model as the intake
 * form. Deliberately a POST: a GET answer could be fired by an email
 * scanner prefetching links.
 */
export const dynamic = 'force-dynamic'

/** Current status, so a pre-opened tab can catch up after a co-recipient
 *  answers first. Returns nothing but the status — the token grants a vote,
 *  not a data feed. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
 return withRequestCache(async () => {
  const { token } = await params
  const { getShootByToken } = await import('../../../lib/shoots')
  const proposal = await getShootByToken(token)
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // and what the client side has said on it (30 Oct 2026), so a second tab sees a comment from the first
  return NextResponse.json({ status: proposal.status, comments: proposalComments(proposal.comments) })
 })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
 return withRequestCache(async () => {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  // A COMMENT, not an answer (the owner, 30 Oct 2026: "leave comments") — the same token is the credential
  if ('comment' in body) {
    const said = await commentOnShoot(token, body.comment)
    if (!said) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!said.ok) return NextResponse.json({ error: said.error }, { status: said.status })
    return NextResponse.json({ comments: said.comments })
  }
  const answer = body.answer === 'yes' ? 'yes' : body.answer === 'no' ? 'no' : null
  if (!answer) return NextResponse.json({ error: 'Answer must be yes or no' }, { status: 400 })

  const result = await respondToShoot(token, answer)
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // applied=false: someone answered first (or the team cancelled) — the page
  // shows the standing answer instead of pretending this click counted
  return NextResponse.json({ status: result.proposal.status, applied: result.applied })
 })
}
