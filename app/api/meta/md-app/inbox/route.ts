import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { MdAppError } from '@/app/lib/md-app'
import { commentAction, inboxComments, inboxPosts, inboxThreads, sendMessage } from '@/app/lib/md-app-inbox'
import { cleanText, isGraphId } from '@/app/lib/md-app-inbox-core'
import { accessibleClientIds } from '@/app/lib/production-access'

/**
 * /api/meta/md-app/inbox (9 Nov 2026) — the Meta card's Inbox tab. Account manager+ on THEIR client (Meta's reviewer
 * signs in as one, fenced to the test client). Everything goes through the client's own MD App connection.
 * GET  ?clientId=&view=posts
 * GET  ?clientId=&view=comments&platform=instagram|facebook&postId=
 * GET  ?clientId=&view=threads&platform=instagram|facebook
 * POST ?clientId=  { action: 'reply'|'hide'|'unhide'|'delete', platform, commentId, text? }
 * POST ?clientId=  { action: 'message', platform, to, text }
 */
export const dynamic = 'force-dynamic'

async function gate(clientId: string) {
  const me = await requireRole('account_manager')
  const ids = await accessibleClientIds(me)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}
const fail = (e: unknown) => {
  if (e instanceof MdAppError) return NextResponse.json({ error: e.detail?.userMessage ?? e.message }, { status: e.status === 409 ? 409 : 502 })
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}
const platformOf = (v: unknown) => (v === 'instagram' || v === 'facebook' ? v : null)

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const clientId = q.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try {
    await gate(clientId)
    const view = q.get('view')
    if (view === 'posts') return NextResponse.json(await inboxPosts(clientId))
    const platform = platformOf(q.get('platform'))
    if (!platform) return NextResponse.json({ error: 'platform is required' }, { status: 400 })
    if (view === 'comments') {
      const postId = q.get('postId')
      if (!isGraphId(postId)) return NextResponse.json({ error: 'postId is required' }, { status: 400 })
      return NextResponse.json({ comments: await inboxComments(clientId, platform, postId) })
    }
    if (view === 'threads') return NextResponse.json({ threads: await inboxThreads(clientId, platform) })
    return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
  } catch (e) { return fail(e) }
}

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  try {
    await gate(clientId)
    const platform = platformOf(body?.platform)
    if (!platform) return NextResponse.json({ error: 'platform is required' }, { status: 400 })
    const action = body?.action
    if (action === 'message') {
      const text = cleanText(body?.text)
      if (!isGraphId(body?.to) || !text) return NextResponse.json({ error: 'Write a message first' }, { status: 400 })
      await sendMessage(clientId, platform, body.to as string, text)
      return NextResponse.json({ ok: true })
    }
    if (action === 'reply' || action === 'hide' || action === 'unhide' || action === 'delete') {
      if (!isGraphId(body?.commentId)) return NextResponse.json({ error: 'commentId is required' }, { status: 400 })
      const text = action === 'reply' ? cleanText(body?.text) : undefined
      if (action === 'reply' && !text) return NextResponse.json({ error: 'Write a reply first' }, { status: 400 })
      await commentAction(clientId, platform, action, body.commentId as string, text ?? undefined)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) { return fail(e) }
}
