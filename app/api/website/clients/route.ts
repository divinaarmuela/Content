import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Client, TeamUserClient } from '@/lib/db-types'
import { guard, requireRole, roleSatisfies, authzErrorResponse } from '@/app/lib/authz'
import { normaliseWebsite } from '@/app/lib/website-url'
import { visibleClientIds } from '@/app/lib/production-access'

/** Master client registry — dashboard only (Clerk-gated in middleware).
 *
 *  `?scope=mine` narrows it to the clients this person actually works for:
 *  their client team PLUS the clients of every shoot and item assignment they
 *  hold. That is the list the "New work" dialog must offer — the registry is
 *  an admin surface, and a picker built from it either offers clients whose
 *  create call 403s or (before `visibleClientIds`) omitted the very client
 *  someone was handed a job on. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  let mayShare = false
  let scoped: string[] | null = null
  try {
    const user = await requireRole('scheduler')
    mayShare = roleSatisfies(user.role, 'account_manager')
    if (new URL(req.url).searchParams.get('scope') === 'mine') {
      scoped = await visibleClientIds(user)
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  if (scoped !== null && scoped.length === 0) return NextResponse.json([])
  const data = await table<Client>('clients').list({
    where: scoped === null ? undefined : c => scoped.includes(c.id),
    orderBy: [['created_at', 'desc']],
  })

  // Who runs each client, attached here rather than fetched per row: the list
  // is the page where "who owns this?" is actually asked, and N requests for
  // N clients would be the slowest possible way to answer it.
  const links = await table<TeamUserClient>('team_user_clients').list()
  const assignments = await attachOne(links, 'team_user_id', 'team_users',
    ['id', 'name', 'email', 'role', 'active_status'])

  const byClient = new Map<string, { id: string; name: string; email: string }[]>()
  for (const row of assignments) {
    const u = row.team_users as unknown as
      { id: string; name: string; email: string; role: string; active_status: boolean } | null
    if (!u || !u.active_status) continue
    if (!['account_manager', 'super_admin'].includes(u.role)) continue
    const list = byClient.get(row.client_id) ?? []
    list.push({ id: u.id, name: u.name, email: u.email })
    byClient.set(row.client_id, list)
  }

  return NextResponse.json(
    data.map(c => ({
      ...c,
      // the portal link is the client's front door — only their managers may
      // hand it out, so lower roles never even receive the token
      share_token: mayShare ? c.share_token : null,
      managers: byClient.get(c.id) ?? [],
    })),
  )
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
  const denied = await guard('account_manager')
  if (denied) return denied

  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  try {
    const data = await table('clients').insert({
      name: body.name,
      slug,
      industry: body.industry ?? null,
      contact_name: body.contact_name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      website: normaliseWebsite(body.website),
      status: body.status ?? 'active',
      notes: body.notes ?? null,
      // the portal link IS this token; a client opened without one has a
      // front door that 404s
      share_token: randomUUID(),
    })
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  })
}
