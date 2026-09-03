import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ClientContact } from '@/lib/db-types'
import { guard } from '@/app/lib/authz'
import { takeClaimLock, releaseClaimLock, primaryContactLockKey } from '@/app/lib/claim-lock'

/**
 * One primary contact per client.
 *
 * Postgres held this as a partial unique index; a JSON tree cannot express
 * one, and "does another row have it?" spans rows, so it cannot be a
 * compare-and-set on the contact either. It is a lock row per client instead,
 * taken atomically — two people promoting two different contacts at the same
 * moment produce one primary and one 409, where a read-then-write left both
 * rows flagged. The lock heals itself if the contact holding it is deleted or
 * demoted behind its back. The refusal keeps the words the index's
 * translation used to produce.
 */
async function takePrimary(clientId: string, contactId: string): Promise<boolean> {
  // the read first, because it is the only thing that knows about a primary
  // set before this lock existed — but it is not the guarantee
  const rows = await table<ClientContact>('client_contacts').list({ by: { client_id: clientId } })
  if (rows.some(c => c.is_primary === true && c.id !== contactId)) return false
  const taken = await takeClaimLock(primaryContactLockKey(clientId), contactId, async holder => {
    const held = await table<ClientContact>('client_contacts').get(holder)
    return !!held && held.is_primary === true
  })
  return taken.ok
}
const releasePrimary = (clientId: string, contactId: string) =>
  releaseClaimLock(primaryContactLockKey(clientId), contactId).catch(() => {})

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
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
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

  const contactId = crypto.randomUUID()
  if (body.is_primary && !await takePrimary(id, contactId)) {
    return NextResponse.json(
      { error: 'This client already has a primary contact. Unset it first.' },
      { status: 409 },
    )
  }

  try {
    const data = await table('client_contacts').insert({
      id: contactId,
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
    if (body.is_primary) await releasePrimary(id, contactId)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
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
  if (patch.is_primary === true && !await takePrimary(current.client_id, current.id)) {
    return NextResponse.json(
      { error: 'This client already has a primary contact. Unset it first.' },
      { status: 409 },
    )
  }

  try {
    const data = await table('client_contacts').update(String(body.id), patch)
    // demoting hands the seat back, so somebody else can be promoted
    if (patch.is_primary === false) await releasePrimary(current.client_id, current.id)
    return NextResponse.json(data)
  } catch (e) {
    if (patch.is_primary === true) await releasePrimary(current.client_id, current.id)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
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
    const going = await table<ClientContact>('client_contacts').get(contactId)
    await table<ClientContact>('client_contacts').remove(contactId)
    // a deleted primary stops holding the seat
    if (going?.is_primary) await releasePrimary(going.client_id, contactId)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
  })
}
