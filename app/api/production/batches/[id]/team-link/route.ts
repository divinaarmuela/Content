import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { table } from '@/lib/db'
import type { Batch } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { DASHBOARD_URL } from '../../../../../lib/app-url'
import { isShootShareToken, shootSharePath } from '../../../../../lib/shoot-share-core'

/**
 * THE SHOOT'S LINK FOR THE TEAM (shoot-share-core). POST mints it, once; a second press returns the same link. DELETE
 * switches it off and the page goes dark. Whoever may open the shoot page may do either: its managers, and every
 * editor and scheduler (the same people the shoot page itself opens for since 5 Nov 2026).
 */
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function shootFor(id: string) {
  const user = await requireRole('scheduler')
  const batch = await table<Batch>('batches').get(id)
  if (!batch) return { response: NextResponse.json({ error: 'Shoot not found' }, { status: 404 }) }
  const may = user.role === 'editor' || user.role === 'scheduler' || (await canOpenBatch(user, batch as never))
  if (!may) return { response: NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 }) }
  return { user, batch }
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const g = await shootFor(id)
    if ('response' in g) return g.response
    let token = String((g.batch as { team_share_token?: unknown }).team_share_token ?? '')
    if (!isShootShareToken(token)) {
      const fresh = randomBytes(16).toString('hex')
      // one winner: two people pressing at once get the same link, never two
      const made = await table<Batch>('batches').claim(id, cur => {
        if (!cur) return null
        if (isShootShareToken((cur as { team_share_token?: unknown }).team_share_token)) return null
        return { ...cur, team_share_token: fresh } as never
      })
      token = made.claimed ? fresh : String((made.current as { team_share_token?: unknown } | null)?.team_share_token ?? '')
      if (!isShootShareToken(token)) return NextResponse.json({ error: 'The link could not be made. Try again.' }, { status: 409 })
      if (made.claimed) await logActivity({ entityType: 'batch', entityId: id, action: 'team_link_made', actor: g.user, detail: 'a link to the shoot plan, the board and the comments, with no sign-in' }).catch(() => {})
    }
    return NextResponse.json({ url: `${DASHBOARD_URL}${shootSharePath(token)}` })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const g = await shootFor(id)
    if ('response' in g) return g.response
    await table<Batch>('batches').update(id, { team_share_token: null } as never)
    await logActivity({ entityType: 'batch', entityId: id, action: 'team_link_stopped', actor: g.user, detail: 'the link with no sign-in was switched off' }).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
