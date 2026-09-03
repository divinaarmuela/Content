import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { table, withRequestCache, DbError } from '@/lib/db'
import type { Client, Lead } from '@/lib/db-types'
import { guard } from '@/app/lib/authz'

/** Convert a lead into a client, carrying every field across. Clerk-protected
 *  via middleware. Duplicate-safe: if a client with the same slug or email
 *  already exists, returns 409 with that client instead of creating a twin. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  const denied = await guard('account_manager')
  if (denied) return denied

  const body = await req.json()
  if (!body.lead_id) return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })

  const lead = await table<Lead>('leads').get(String(body.lead_id))
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const name = (lead.biz || `${lead.fname} ${lead.lname}`).trim()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  // dedupe: same slug OR same contact email → point at the existing client.
  // A lead with no email must not match every client that has none either:
  // Postgres compared null to null as unknown, so the clause never fired.
  const existing = (await table<Client>('clients').list({
    where: c => c.slug === slug || (!!lead.email && c.email === lead.email), limit: 1,
  }))[0]
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
    `Converted from lead received ${new Date(lead.created_at).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne' })}`,
  ].filter(Boolean).join('\n')

  try {
    const client = await table('clients').insert({
      name,
      slug,
      contact_name: `${lead.fname} ${lead.lname}`.trim(),
      email: lead.email,
      phone: lead.phone,
      status: 'active',
      source: 'lead_convert',
      notes: enquiry,
      // the portal link IS this token; a client opened without one has a
      // front door that 404s
      share_token: randomUUID(),
    })
    return NextResponse.json(client, { status: 201 })
  } catch (e) {
    const dup = e instanceof DbError && e.code === 'unique'
    return NextResponse.json(
      { error: dup ? 'A client with this name already exists' : (e as Error).message },
      { status: dup ? 409 : 500 }
    )
  }
  })
}
