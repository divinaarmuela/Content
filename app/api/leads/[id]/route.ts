import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

/** Update a lead. Clerk-protected via middleware (/api/leads(.*)). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const allowed = ['fname', 'lname', 'email', 'phone', 'biz', 'model', 'need', 'budget', 'timeline'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) patch[key] = body[key]
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields in request' }, { status: 400 })
  }
  if ('email' in patch && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(patch.email))) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** Delete a lead. Clerk-protected via middleware (/api/leads(.*)). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('leads')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
