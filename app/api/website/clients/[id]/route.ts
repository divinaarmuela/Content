import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { guard, requireRole, roleSatisfies, authzErrorResponse } from '@/app/lib/authz'
import { normaliseWebsite } from '@/app/lib/website-url'
import { isValidZone } from '@/app/lib/timezone-core'

/**
 * One client, for the detail page.
 *
 * READING is open to anyone who may see the Clients page — the list already
 * is, and a page that lists clients but refuses every one of them is a wall
 * with a menu on it. Editing stays account_manager, as it always was.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  let mayShare = false
  try {
    const user = await requireRole('scheduler')
    mayShare = roleSatisfies(user.role, 'account_manager')
  } catch (e) {
    const { error: msg, status } = authzErrorResponse(e)
    return NextResponse.json({ error: msg }, { status })
  }
  const { id } = await params
  const data = await table<Client>('clients').get(id)
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  // the portal link stays with the client's managers
  return NextResponse.json({ ...data, share_token: mayShare ? data.share_token : null })
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  const body = await req.json()
  // `instagram_locations` is deliberately NOT here: it is a LIST, and a PATCH
  // that carries the whole list is a read-modify-write — two managers editing
  // a client's places at once and one edit silently disappearing. It has its
  // own route (`/api/clients/[id]/instagram-locations`) that takes one place
  // at a time and applies it under a claim.
  const allowed = ['name', 'slug', 'industry', 'contact_name', 'email', 'phone', 'website', 'status', 'notes', 'clerk_user_id', 'timezone'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) patch[key] = body[key]
  if ('website' in patch) patch.website = normaliseWebsite(patch.website)
  // A bad zone is not a cosmetic error: it becomes UTC on every screen that
  // prints a posting time, silently. The browser checks it too — this is the
  // check that counts, because the browser's is presentation.
  if ('timezone' in patch) {
    const tz = String(patch.timezone ?? '').trim()
    if (!isValidZone(tz)) {
      return NextResponse.json(
        { error: `“${tz}” is not a time zone. Use an IANA name such as Australia/Melbourne or Asia/Manila.` },
        { status: 400 },
      )
    }
    patch.timezone = tz
  }
  try {
    const data = await table('clients').update(id, patch)
    if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  try {
    await table<Client>('clients').remove(id)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
  })
}
