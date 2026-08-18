import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'
import { normaliseWebsite } from '@/app/lib/website-url'

/**
 * One client, for the detail page.
 *
 * READING is open to anyone who may see the Clients page — the list already
 * is, and a page that lists clients but refuses every one of them is a wall
 * with a menu on it. Editing stays account_manager, as it always was.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard('scheduler')
  if (denied) return denied

  const { id } = await params
  const { data, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  const body = await req.json()
  const allowed = ['name', 'slug', 'industry', 'contact_name', 'email', 'phone', 'website', 'status', 'notes', 'clerk_user_id'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) patch[key] = body[key]
  if ('website' in patch) patch.website = normaliseWebsite(patch.website)
  const { data, error } = await supabase.from('clients').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
