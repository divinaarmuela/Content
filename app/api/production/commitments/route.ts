import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { MonthlyCommitment } from '@/lib/db-types'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'

/** List monthly commitments (role-scoped). Filters: client_id, year. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    const url = new URL(req.url)

    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null && clientIds.length === 0) return NextResponse.json([])
    const clientFilter = url.searchParams.get('client_id')
    const yearFilter = url.searchParams.get('year')

    const rows = await table<MonthlyCommitment>('monthly_commitments').list({
      by: clientFilter ? { client_id: clientFilter } : undefined,
      where: r => {
        if (clientIds !== null && !clientIds.includes(r.client_id)) return false
        if (yearFilter && r.year !== Number(yearFilter)) return false
        return true
      },
      orderBy: [['year', 'desc'], ['month', 'desc']],
      limit: 60,
    })
    return NextResponse.json(await attachOne(rows, 'client_id', 'clients', ['name']))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Upsert a commitment for a client-month. AM+. There is one row per
 *  client-month: an existing one is updated in place, so pressing save twice
 *  never leaves two competing quotas behind. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const body = await req.json()
    if (!body.client_id || !body.month || !body.year) {
      return NextResponse.json({ error: 'client_id, month, and year are required' }, { status: 400 })
    }
    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null && !clientIds.includes(body.client_id)) {
      return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
    }
    const row = {
      client_id: String(body.client_id),
      month: Number(body.month),
      year: Number(body.year),
      reel_quota: Number(body.reel_quota ?? 0),
      carousel_quota: Number(body.carousel_quota ?? 0),
      story_quota: Number(body.story_quota ?? 0),
      static_quota: Number(body.static_quota ?? 0),
      video_quota: Number(body.video_quota ?? 0),
      other_quota: Number(body.other_quota ?? 0),
      notes: body.notes ?? null,
    }
    // (client, month, year) is the row's identity, and it spans three
    // columns — so find the month's row and write over it, else start one.
    const commitments = table<MonthlyCommitment>('monthly_commitments')
    const existing = (await commitments.list({
      by: { client_id: row.client_id },
      where: r => r.month === row.month && r.year === row.year,
      limit: 1,
    }))[0]
    const data = existing
      ? await commitments.update(existing.id, row)
      : await table('monthly_commitments').insert(row)
    void user
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
