import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { MetaIgError, metaIgReady } from '@/app/lib/meta-ig'
import { act, commentsFor, type DirectAccount, conversationsFor, directAccountFor, insightsFor, postInsightsFor, postsFor } from '@/app/lib/meta-ig-inbox'
import { INBOX_VIEWS, readGraphId, readInboxRequest, type InboxView } from '@/app/lib/meta-ig-inbox-core'

/**
 * /api/meta/instagram/inbox — a client's Instagram comments, direct messages
 * and numbers, through OUR OWN Meta app (5 Oct 2026). For a client with a
 * direct connection only; everyone else is still on Zernio.
 *
 * GET  ?clientId=&view=posts                       the account's recent posts
 * GET  ?clientId=&view=comments&mediaId=           one post's comments and replies, and its numbers
 * GET  ?clientId=&view=messages                    the conversations with their latest messages
 * GET  ?clientId=&view=insights[&days=7|28]        the profile and the account's numbers
 * POST { clientId, action, commentId?, recipientId?, text? }
 *      reply · hide · unhide · delete · private_reply · message
 *
 * An account manager, on a client they work on (a super admin on any) — the
 * same rule as the connect. Every POST is one person's one press: nothing
 * here runs on a schedule or answers by itself.
 */
export const dynamic = 'force-dynamic'

/** the client must be one this person works on — the same rule as the Schedule's, without its mailer */
async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

async function accountOr(clientId: string): Promise<{ ok: true; account: DirectAccount } | { ok: false; res: NextResponse }> {
  const me = await requireRole('account_manager')
  await assertMine(me, clientId)
  const ready = metaIgReady()
  if (!ready.ok) return { ok: false, res: NextResponse.json({ error: ready.reason }, { status: 503 }) }
  const found = await directAccountFor(clientId)
  if (!found.ok) return { ok: false, res: NextResponse.json({ error: found.reason }, { status: 409 }) }
  return { ok: true, account: found.account }
}

/** Instagram's refusal, in its own words, as a 502 — never a 500 that says nothing. */
function failure(e: unknown): NextResponse {
  if (e instanceof MetaIgError) {
    return NextResponse.json({ error: e.detail?.userMessage ?? e.message, instagram: true }, { status: 502 })
  }
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const clientId = q.get('clientId')?.trim()
  const view = q.get('view') as InboxView
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  if (!INBOX_VIEWS.includes(view)) return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
  try {
    const got = await accountOr(clientId)
    if (!got.ok) return got.res
    const a = got.account
    const now = Date.now()
    if (view === 'posts') return NextResponse.json({ username: a.username, posts: await postsFor(a) })
    if (view === 'comments') {
      const mediaId = readGraphId(q.get('mediaId'))
      if (!mediaId) return NextResponse.json({ error: 'Choose a post first' }, { status: 400 })
      const [comments, insights] = await Promise.all([
        commentsFor(a, mediaId),
        // a post's numbers failing must not hide its comments
        postInsightsFor(a, mediaId).catch(() => []),
      ])
      return NextResponse.json({ username: a.username, comments, insights })
    }
    if (view === 'messages') return NextResponse.json({ username: a.username, conversations: await conversationsFor(a, now) })
    return NextResponse.json({ username: a.username, ...(await insightsFor(a, Number(q.get('days') ?? 7), now)) })
  } catch (e) {
    return failure(e)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { clientId?: unknown } | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const parsed = readInboxRequest(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const got = await accountOr(clientId)
    if (!got.ok) return got.res
    const done = await act(got.account, parsed.value)
    return NextResponse.json({ ok: true, action: parsed.value.action, id: done.id })
  } catch (e) {
    return failure(e)
  }
}
