import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { clientSignsOffEveryPost } from '@/app/lib/social-schedule-core'

/**
 * DOES THIS CLIENT SIGN OFF EVERY POST THEMSELVES?
 *
 * `clients.client_approval_required` — the one exception to the 5 Sep 2026
 * ruling that an account manager posts without an approval step in the way.
 * On a client with this on, nobody takes the short cut: `performTransition`
 * refuses the media's own sign-off and the Schedule page's direct path 403s,
 * both in plain words.
 *
 * IT EXISTED IN THE SERVER BEFORE IT EXISTED IN THE PRODUCT. The column was
 * read by both gates and written by nothing, so the one carve-out the owner
 * ruled for could only be armed by hand-editing the database — which means a
 * client whose contract says they see every post first was, in practice, a
 * client anybody could post without. This route is the switch.
 *
 * GET  → { client_approval_required: boolean }
 * PUT  { on: boolean }
 *
 * AN ACCOUNT MANAGER OR A SUPER ADMIN, and only on a client they are on.
 * A scheduler may read it — the Schedule page's own words change with it —
 * and may not decide it: turning it off is deciding a client does not need
 * to see their own posts.
 *
 * The write is a claim (CLAUDE.md trap 11), not a read-then-write: two
 * managers on the client's page must not be able to write over each other's
 * other settings, and this row carries a great deal more than one boolean.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      await assertClientAccess(user, id)
      const row = await table<Client>('clients').get(id)
      if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      return NextResponse.json({ client_approval_required: clientSignsOffEveryPost(row) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const { id } = await params
      await assertClientAccess(user, id)
      const body = await req.json().catch(() => ({}))
      if (typeof body.on !== 'boolean') {
        return NextResponse.json({ error: 'Say whether it is on or off' }, { status: 400 })
      }
      const on = body.on

      const done = await table<Client>('clients').claim(id, cur =>
        cur ? ({ ...cur, client_approval_required: on } as Client) : null)
      if (!done.claimed) {
        return done.current
          ? NextResponse.json(
            { error: 'Somebody else was changing this client at the same time. Try again.' },
            { status: 409 })
          : NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }
      return NextResponse.json({ client_approval_required: clientSignsOffEveryPost(done.row) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
