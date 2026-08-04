import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'

/** Contacts for one client. A client is an organisation, and organisations
 *  have an owner, a marketing lead, a bookkeeper — not one email address. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  const { data, error } = await supabase
    .from('client_contacts')
    .select('*')
    .eq('client_id', id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  const body = await req.json()
  if (!String(body.name ?? '').trim()) {
    return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('client_contacts')
    .insert({
      client_id: id,
      name: body.name,
      role: body.role ?? '',
      email: body.email ?? '',
      phone: body.phone ?? '',
      is_primary: !!body.is_primary,
      notes: body.notes ?? '',
    })
    .select()
    .single()

  if (error) {
    // the partial unique index names itself, which means nothing to the person
    // who just ticked a box
    if (error.message.includes('client_contacts_one_primary')) {
      return NextResponse.json(
        { error: 'This client already has a primary contact. Unset it first.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: Request) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const body = await req.json()
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'role', 'email', 'phone', 'is_primary', 'notes']) {
    if (k in body) patch[k] = body[k]
  }

  const { data, error } = await supabase
    .from('client_contacts').update(patch).eq('id', body.id).select().single()

  if (error) {
    if (error.message.includes('client_contacts_one_primary')) {
      return NextResponse.json(
        { error: 'This client already has a primary contact. Unset it first.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function DELETE(req: Request) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const contactId = searchParams.get('contactId')
  if (!contactId) return NextResponse.json({ error: 'contactId is required' }, { status: 400 })

  const { error } = await supabase.from('client_contacts').delete().eq('id', contactId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
