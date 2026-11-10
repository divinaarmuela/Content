import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ClientContact } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { cleanEmail } from '@/app/lib/client-recipients-core'

/**
 * ADD SOMEONE TO SEND TO, RIGHT WHERE YOU ARE SENDING (10 Nov 2026, owner: "we should be able to add the email if
 * it's not found … and save it under contacts … it's in post approval, schedule, editor, designer, shoot brief").
 * Scheduler and up, on a client they can reach. Saved on the client's Contacts (not primary); an address already
 * there is not added twice. Answers the recipient the dialogs tick.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (user.role === 'client') return NextResponse.json({ error: 'Not for clients' }, { status: 403 })
      const { id } = await params
      await assertClientAccess(user, id)
      const body = await req.json().catch(() => ({}))
      const email = cleanEmail(body.email)
      if (!email) return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
      const name = String(body.name ?? '').trim().slice(0, 120) || email
      const contacts = table<ClientContact>('client_contacts')
      const existing = (await contacts.list({ by: { client_id: id }, fresh: true })).find(c => cleanEmail(c.email) === email)
      if (!existing) {
        await contacts.insert({ id: crypto.randomUUID(), client_id: id, name, role: '', email, phone: '', is_primary: false, notes: `Added while sending, by ${user.name ?? user.email}` } as ClientContact)
      }
      return NextResponse.json({ recipient: { email, name: existing?.name || name, label: existing?.role || 'Contact', primary: !!existing?.is_primary, business: false } })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
