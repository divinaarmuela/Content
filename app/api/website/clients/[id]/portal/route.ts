import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { guard } from '@/app/lib/authz'

/**
 * MAKE A CLIENT'S PORTAL (the owner, 20 Oct 2026: a board's "Share with client" refused a client with no portal —
 * "make it on the client" — "make the button do it … some client we will have scheduling etc"). Gives a client their
 * portal link the first time it is asked for, the one-link portal every client is on now (Shoot brief, Editing,
 * Designing, Scheduling, Boards, Forms); a client who already has one keeps it, exactly as it was. Nobody is emailed.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('account_manager')
    if (denied) return denied
    const { id } = await params
    // one winner when two people press at once: the row's own token stands
    const saved = await table<Client>('clients').claim(id, cur => {
      if (!cur) return null
      const held = typeof cur.share_token === 'string' && cur.share_token.trim()
      return held ? cur : { ...cur, share_token: randomUUID(), portal_one: true }
    })
    const row = (saved.claimed ? saved.row : saved.current) as Client | null
    if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    const token = typeof row.share_token === 'string' ? row.share_token.trim() : ''
    if (!token) return NextResponse.json({ error: 'Could not make the portal just now' }, { status: 500 })
    return NextResponse.json({ ok: true, token })
  })
}
