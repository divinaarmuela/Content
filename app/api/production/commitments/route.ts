import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'

/** List monthly commitments (role-scoped). Filters: client_id, year. */
export async function GET(req: Request) {
  try {
    const user = await requireRole('client')
    const url = new URL(req.url)
    let q = supabase
      .from('monthly_commitments')
      .select('*, clients(name)')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(60)

    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null) {
      if (clientIds.length === 0) return NextResponse.json([])
      q = q.in('client_id', clientIds)
    }
    const clientFilter = url.searchParams.get('client_id')
    if (clientFilter) q = q.eq('client_id', clientFilter)
    const yearFilter = url.searchParams.get('year')
    if (yearFilter) q = q.eq('year', Number(yearFilter))

    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Upsert a commitment for a client-month. AM+. The unique(client, month, year)
 *  constraint makes concurrent upserts collapse to one row. */
export async function POST(req: Request) {
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
    const { data, error } = await supabase
      .from('monthly_commitments')
      .upsert(
        {
          client_id: body.client_id,
          month: Number(body.month),
          year: Number(body.year),
          reel_quota: Number(body.reel_quota ?? 0),
          carousel_quota: Number(body.carousel_quota ?? 0),
          story_quota: Number(body.story_quota ?? 0),
          static_quota: Number(body.static_quota ?? 0),
          other_quota: Number(body.other_quota ?? 0),
          notes: body.notes ?? null,
        },
        { onConflict: 'client_id,month,year' }
      )
      .select()
      .single()
    if (error) throw new Error(error.message)
    void user
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
