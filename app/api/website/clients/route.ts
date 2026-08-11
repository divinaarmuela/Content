import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'
import { normaliseWebsite } from '@/app/lib/website-url'

/** Master client registry — dashboard only (Clerk-gated in middleware). */
export async function GET() {
  const denied = await guard('scheduler')
  if (denied) return denied

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const { data, error } = await supabase
    .from('clients')
    .insert({
      name: body.name,
      slug,
      industry: body.industry ?? null,
      contact_name: body.contact_name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      website: normaliseWebsite(body.website),
      status: body.status ?? 'active',
      notes: body.notes ?? null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
