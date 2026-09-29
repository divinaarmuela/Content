import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { authzErrorResponse, requireSignedIn } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { mayCreatePost } from '@/app/lib/overview-links-core'
import { clientChoices } from '@/app/lib/client-pick-core'

/**
 * GET /api/clients/for-posting — "Who is this post for?" in ONE request.
 *
 * Answers `{ clients: [{ id, name }] }`: the clients this person may post for,
 * never archived, by name. Nothing else about a client leaves the server.
 *
 * Why it exists (29 Sep 2026): New post on Post approval took ~13 s to list
 * the clients, because the browser subscribed to the whole `clients` table
 * (every column, brand_profile included) and the whole `team_user_clients`
 * table just to draw names. See app/lib/client-pick-core.ts.
 *
 * Authorization is here: a person who does not make posts gets 403, and the
 * list is `accessibleClientIds` — the server's own rule for whose work a
 * person may touch. A client-scoped person's clients are read one row each
 * (a handful); only an unrestricted person reads the table, server-side.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      if (user.role === 'client' || !mayCreatePost(user.role)) {
        return NextResponse.json({ error: 'You do not make posts.' }, { status: 403 })
      }
      const allowed = await accessibleClientIds(user)
      const clients = table<Client>('clients')
      const rows = allowed === null
        ? await clients.list()
        : (await Promise.all(allowed.map(id => clients.get(id).catch(() => null)))).filter((r): r is Client => !!r)
      return NextResponse.json({ clients: clientChoices(rows, allowed) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
