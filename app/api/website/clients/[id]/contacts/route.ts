import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ClientContact } from '@/lib/db-types'
import { guard } from '@/app/lib/authz'
import { explainDbError } from '@/app/lib/db-errors'

/**
 * One primary contact per client.
 *
 * Postgres held this as a partial unique index; a JSON tree cannot express
 * one, so the rule is checked here, immediately before the write, and the
 * refusal keeps the words the index's translation used to produce.
 */
async function primaryTaken(clientId: string, exceptId?: string): Promise<boolean> {
  const rows = await table<ClientContact>('client_contacts').list({ by: { client_id: clientId } })
  return rows.some(c => c.is_primary === true && c.id !== exceptId)
}

/** Contacts for one client. A client is an organisation, and organisations
 *  have an owner, a marketing lead, a bookkeeper — not one email address. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  const denied = await guard('scheduler')
  if (denied) return denied

  const { id } = await params
  try {
    const data = await table<ClientContact>('client_contacts').list({
      by: { client_id: id },
      orderBy: [['is_primary', 'desc'], ['created_at', 'asc']],
    })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: explainDbError((e as Error).message, 'client_records.sql') }, { status: 500 })
  }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  const body = await req.json()
  if (!String(body.name ?? '').trim()) {
    return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  }

  if (body.is_primary && await primaryTaken(id)) {
    return NextResponse.json(
      { error: 'This client already has a primary contact. Unset it first.' },
      { status: 409 },
    )
  }

  try {
    const data = await table('client_contacts').insert({
      client_id: id,
      name: body.name,
      role: body.role ?? '',
      email: body.email ?? '',
      phone: body.phone ?? '',
      is_primary: !!body.is_primary,
      notes: body.notes ?? '',
    })
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: explainDbError((e as Error).message, 'client_records.sql') }, { status: 500 })
  }
  })
}

export async function PATCH(req: Request) {
  return withRequestCache(async () => {
  const denied = await guard('account_manager')
  if (denied) return denied

  const body = await req.json()
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'role', 'email', 'phone', 'is_primary', 'notes']) {
    if (k in body) patch[k] = body[k]
  }

  const contacts = table<ClientContact>('client_contacts')
  const current = await contacts.get(String(body.id))
  if (!current) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (patch.is_primary && await primaryTaken(current.client_id, current.id)) {
    return NextResponse.json(
      { error: 'This client already has a primary contact. Unset it first.' },
      { status: 409 },
    )
  }

  try {
    const data = await table('client_contacts').update(String(body.id), patch)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: explainDbError((e as Error).message, 'client_records.sql') }, { status: 500 })
  }
  })
}

export async function DELETE(req: Request) {
  return withRequestCache(async () => {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const contactId = searchParams.get('contactId')
  if (!contactId) return NextResponse.json({ error: 'contactId is required' }, { status: 400 })

  try {
    await table<ClientContact>('client_contacts').remove(contactId)
  } catch (e) {
    return NextResponse.json({ error: explainDbError((e as Error).message, 'client_records.sql') }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
  })
}
