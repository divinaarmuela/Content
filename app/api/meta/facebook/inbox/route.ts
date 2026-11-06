import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { MetaFbError, activePageFor, fbAct, fbCommentsFor, fbConversationsFor, fbInsightsFor, fbPostInsightsFor, fbPostsFor, type PageAuth } from '@/app/lib/meta-fb'
import { FB_INBOX_VIEWS, isGraphId, readFbInboxRequest, type FbInboxView } from '@/app/lib/meta-fb-core'

/**
 * /api/meta/facebook/inbox — a client's picked Facebook Page, through OUR OWN Meta app (6 Nov 2026).
 *
 * GET  ?clientId=&view=posts                 the Page's recent posts
 * GET  ?clientId=&view=comments&postId=      one post's comments with replies, and its numbers
 * GET  ?clientId=&view=insights[&days=7|28]  the Page's numbers
 * GET  ?clientId=&view=messages              Messenger conversations with their latest messages
 * POST { clientId, action: reply|hide|unhide|delete, commentId, text? }
 * POST { clientId, action: message, recipientId (PSID), text }  — inside the 24-hour window only
 *
 * Account manager on a client of theirs (super admin any). Every POST is one person's one press.
 */
export const dynamic = 'force-dynamic'

async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

async function pageOr(clientId: string): Promise<{ ok: true; page: PageAuth } | { ok: false; res: NextResponse }> {
  const me = await requireRole('account_manager')
  await assertMine(me, clientId)
  const found = await activePageFor(clientId)
  if (!found.ok) return { ok: false, res: NextResponse.json({ error: found.reason }, { status: 409 }) }
  return { ok: true, page: found.page }
}

function failure(e: unknown): NextResponse {
  if (e instanceof MetaFbError) return NextResponse.json({ error: e.detail?.userMessage ?? e.message, facebook: true }, { status: 502 })
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const clientId = q.get('clientId')?.trim()
  const view = q.get('view') as FbInboxView
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  if (!FB_INBOX_VIEWS.includes(view)) return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
  try {
    const got = await pageOr(clientId)
    if (!got.ok) return got.res
    const p = got.page
    if (view === 'posts') return NextResponse.json({ name: p.name, posts: await fbPostsFor(p) })
    if (view === 'comments') {
      const postId = q.get('postId')?.trim() ?? ''
      if (!isGraphId(postId)) return NextResponse.json({ error: 'Choose a post first' }, { status: 400 })
      const [comments, insights] = await Promise.all([fbCommentsFor(p, postId), fbPostInsightsFor(p, postId).catch(() => [])])
      return NextResponse.json({ name: p.name, comments, insights })
    }
    if (view === 'messages') return NextResponse.json({ name: p.name, conversations: await fbConversationsFor(p, Date.now()) })
    return NextResponse.json(await fbInsightsFor(p, Number(q.get('days') ?? 7), Date.now()))
  } catch (e) { return failure(e) }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { clientId?: unknown } | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const parsed = readFbInboxRequest(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const got = await pageOr(clientId)
    if (!got.ok) return got.res
    const done = await fbAct(got.page, parsed.value)
    return NextResponse.json({ ok: true, action: parsed.value.action, id: done.id })
  } catch (e) { return failure(e) }
}
