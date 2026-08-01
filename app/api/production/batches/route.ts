import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'
import { logActivity } from '../../../lib/workflow'

/** List batches (role-scoped, with per-batch item counts). */
export async function GET() {
  try {
    const user = await requireRole('scheduler')
    let q = supabase
      .from('batches')
      .select('*, clients(name), content_items(count)')
      .order('created_at', { ascending: false })
      .limit(200)
    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null) {
      if (clientIds.length === 0) return NextResponse.json([])
      q = q.in('client_id', clientIds)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Create a batch (a shoot). editor+. */
export async function POST(req: Request) {
  try {
    const user = await requireRole('editor')
    const body = await req.json()
    if (!body.client_id || !body.title) {
      return NextResponse.json({ error: 'client_id and title are required' }, { status: 400 })
    }
    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null && !clientIds.includes(body.client_id)) {
      return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
    }
    const { data, error } = await supabase
      .from('batches')
      .insert({
        client_id: body.client_id,
        title: String(body.title),
        description: body.description ?? null,
        shoot_date: body.shoot_date ?? null,
        month: body.month ?? null,
        year: body.year ?? null,
        owner_id: user.id,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    await logActivity({
      actor: user, clientId: data.client_id,
      entityType: 'batch', entityId: data.id,
      action: 'created', newValue: data.title,
    })
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
