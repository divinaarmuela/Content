import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'

/** Convert a lead into a client, carrying every field across. Clerk-protected
 *  via middleware. Duplicate-safe: if a client with the same slug or email
 *  already exists, returns 409 with that client instead of creating a twin. */
export async function POST(req: Request) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const body = await req.json()
  if (!body.lead_id) return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })

  const { data: lead, error: leadErr } = await supabase
    .from('leads').select('*').eq('id', body.lead_id).maybeSingle()
  if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const name = (lead.biz || `${lead.fname} ${lead.lname}`).trim()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  // dedupe: same slug OR same contact email → point at the existing client
  const { data: existing } = await supabase
    .from('clients')
    .select('id, name')
    .or(`slug.eq.${slug},email.eq.${lead.email}`)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: `Already exists as client “${existing.name}”`, client_id: existing.id },
      { status: 409 }
    )
  }

  const enquiry = [
    lead.model && `Service interest: ${lead.model}`,
    lead.need && `Needs: ${lead.need}`,
    lead.budget && `Budget: ${lead.budget}`,
    lead.timeline && `Timeline: ${lead.timeline}`,
    `Converted from lead received ${new Date(lead.created_at).toLocaleDateString('en-AU')}`,
  ].filter(Boolean).join('\n')

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      name,
      slug,
      contact_name: `${lead.fname} ${lead.lname}`.trim(),
      email: lead.email,
      phone: lead.phone,
      status: 'active',
      source: 'lead_convert',
      notes: enquiry,
    })
    .select()
    .single()
  if (error) {
    const dup = error.message.includes('duplicate key')
    return NextResponse.json(
      { error: dup ? 'A client with this name already exists' : error.message },
      { status: dup ? 409 : 500 }
    )
  }
  return NextResponse.json(client, { status: 201 })
}
