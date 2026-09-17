import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { table } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { authzErrorResponse, requireSignedIn } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { DASHBOARD_URL } from '../../../../../lib/app-url'
import { maySharePublicly, sharePath } from '../../../../../lib/share-link-core'

/**
 * THE CARD'S PUBLIC SHARE LINK (share-link-core). POST mints it — once; a
 * second press returns the same link — and DELETE switches it off. Anyone on
 * the team who can see the card may do either, once the card is past the
 * client's approval.
 */
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const user = await requireSignedIn()
    const { id } = await ctx.params
    const item = await loadItemForUser(user, id)
    if (!maySharePublicly(item)) {
      return NextResponse.json({ error: 'The card is not accepted yet — the link is for the accepted version.' }, { status: 409 })
    }
    let token = String((item as { share_token?: unknown }).share_token ?? '')
    if (!/^[a-f0-9]{32}$/.test(token)) {
      token = randomBytes(16).toString('hex')
      await table<ContentItem>('content_items').update(id, { share_token: token } as never)
      await logActivity({ entityType: 'content_item', entityId: id, action: 'share_link_made', actor: user, detail: 'a public link to the accepted version' })
    }
    return NextResponse.json({ url: `${DASHBOARD_URL}${sharePath(token)}` })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireSignedIn()
    const { id } = await ctx.params
    await loadItemForUser(user, id)
    await table<ContentItem>('content_items').update(id, { share_token: null } as never)
    await logActivity({ entityType: 'content_item', entityId: id, action: 'share_link_stopped', actor: user, detail: 'the public link was switched off' })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
