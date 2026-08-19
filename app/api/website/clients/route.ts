import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard, requireRole, roleSatisfies, authzErrorResponse } from '@/app/lib/authz'
import { normaliseWebsite } from '@/app/lib/website-url'

/** Master client registry — dashboard only (Clerk-gated in middleware). */
export async function GET() {
  let mayShare = false
  try {
    const user = await requireRole('scheduler')
    mayShare = roleSatisfies(user.role, 'account_manager')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Who runs each client, attached here rather than fetched per row: the list
  // is the page where "who owns this?" is actually asked, and N requests for
  // N clients would be the slowest possible way to answer it.
  const { data: assignments } = await supabase
    .from('team_user_clients')
    .select('client_id, team_users!team_user_clients_team_user_id_fkey(id, name, email, role, active_status)')

  const byClient = new Map<string, { id: string; name: string; email: string }[]>()
  for (const row of assignments ?? []) {
    const u = row.team_users as unknown as
      { id: string; name: string; email: string; role: string; active_status: boolean } | null
    if (!u || !u.active_status) continue
    if (!['account_manager', 'super_admin'].includes(u.role)) continue
    const list = byClient.get(row.client_id) ?? []
    list.push({ id: u.id, name: u.name, email: u.email })
    byClient.set(row.client_id, list)
  }

  return NextResponse.json(
    (data ?? []).map(c => ({
      ...c,
      // the portal link is the client's front door — only their managers may
      // hand it out, so lower roles never even receive the token
      share_token: mayShare ? c.share_token : null,
      managers: byClient.get(c.id) ?? [],
    })),
  )
}

export async function POST(req: Request) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const { data, error } = await supabase
    .from('clients')
    .insert({
      name: body.name,
      slug,
      industry: body.industry ?? null,
      contact_name: body.contact_name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      website: normaliseWebsite(body.website),
      status: body.status ?? 'active',
      notes: body.notes ?? null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
