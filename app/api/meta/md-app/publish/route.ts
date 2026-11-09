import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { MdAppError } from '@/app/lib/md-app'
import { deletePagePost, editPagePost, publishNow } from '@/app/lib/md-app-publish'
import { cleanText, isGraphId } from '@/app/lib/md-app-inbox-core'
import { accessibleClientIds } from '@/app/lib/production-access'

/**
 * /api/meta/md-app/publish?clientId= (9 Nov 2026) — the Meta card's Publish tab. Account manager+ on THEIR client.
 * POST { action: 'publish', platform, imageUrl?, text?, key }   key: one per press, so a double press is one post
 * POST { action: 'edit', postId, text }                          Facebook Page posts only
 * POST { action: 'delete', postId }                              Facebook Page posts only
 */
export const dynamic = 'force-dynamic'

const fail = (e: unknown) => {
  if (e instanceof MdAppError) return NextResponse.json({ error: e.detail?.userMessage ?? e.message }, { status: e.status === 409 ? 409 : 502 })
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}
const isHttpsUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^\s]{1,2000}$/.test(v)

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  try {
    const me = await requireRole('account_manager')
    const ids = await accessibleClientIds(me)
    if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
    switch (body?.action) {
      case 'publish': {
        const platform = body.platform === 'instagram' || body.platform === 'facebook' ? body.platform : null
        if (!platform) return NextResponse.json({ error: 'platform is required' }, { status: 400 })
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2200) : ''
        const imageUrl = body.imageUrl == null || body.imageUrl === '' ? null : isHttpsUrl(body.imageUrl) ? body.imageUrl : undefined
        if (imageUrl === undefined) return NextResponse.json({ error: 'That photo link is not usable' }, { status: 400 })
        const key = typeof body.key === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.key) ? body.key : null
        if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })
        return NextResponse.json(await publishNow(clientId, { platform, imageUrl, text, key }))
      }
      case 'edit': {
        const text = cleanText(body.text)
        if (!isGraphId(body.postId) || !text) return NextResponse.json({ error: 'Write the new text first' }, { status: 400 })
        await editPagePost(clientId, body.postId as string, text)
        return NextResponse.json({ ok: true })
      }
      case 'delete': {
        if (!isGraphId(body.postId)) return NextResponse.json({ error: 'postId is required' }, { status: 400 })
        await deletePagePost(clientId, body.postId as string)
        return NextResponse.json({ ok: true })
      }
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) { return fail(e) }
}
