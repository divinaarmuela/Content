import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { table, withRequestCache } from '@/lib/db'
import type { ClientContact } from '@/lib/db-types'
import { guard } from '@/app/lib/authz'
import { personPortalPath } from '@/app/lib/portal-owner-core'

/**
 * A PERSON'S OWN PORTAL LINK (the owner, 15 Sep 2026: "then yea, it's a
 * separate portal too"). Minted the first time it is asked for and kept
 * after — the same link months later — so a person's portal address never
 * changes under them. The token is the person's; it opens only what was
 * made for them (app/lib/portal-owner.ts).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('account_manager')
    if (denied) return denied
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { contactId?: unknown }
    const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : ''
    if (!contactId) return NextResponse.json({ error: 'Say which person' }, { status: 400 })

    const contact = await table<ClientContact>('client_contacts').get(contactId).catch(() => null)
    if (!contact || contact.client_id !== id) {
      return NextResponse.json({ error: 'That person is not on this client' }, { status: 404 })
    }
    // one winner when two people ask at once: the row's own token stands
    const saved = await table<ClientContact>('client_contacts').claim(contactId, cur => {
      if (!cur) return null
      const held = (cur as { share_token?: string | null }).share_token
      return held ? cur : { ...cur, share_token: randomUUID() }
    })
    const row = saved.claimed ? saved.row : saved.current
    const token = (row as { share_token?: string | null } | null)?.share_token ?? null
    if (!token) return NextResponse.json({ error: 'Could not make the link just now' }, { status: 500 })
    const base = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    return NextResponse.json({ ok: true, url: `${base}${personPortalPath(token)}`, contactId })
  })
}
