import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../lib/authz'
import { getInstructions, saveInstructions } from '../../../lib/assistant-chats'
import { MAX_INSTRUCTIONS } from '../../../lib/assistant-core'

/**
 * Assistant behaviour, per person.
 *
 * Everyone reads and writes their own standing instructions. A super admin
 * can additionally set behaviour for any team member by email — that is the
 * "per email/user" control — which is why the write resolves the target
 * through team_users rather than trusting an arbitrary id.
 */

async function resolveTarget(user: { role: string; clerk_user_id: string | null; email: string }, email: string | null) {
  if (!email) {
    return { id: user.clerk_user_id ?? user.email, email: user.email }
  }
  if (!roleSatisfies(user.role as never, 'super_admin')) return null
  const { data } = await supabase
    .from('team_users')
    .select('clerk_user_id, email')
    .eq('email', email.toLowerCase())
    .maybeSingle()
  if (!data) return null
  return { id: data.clerk_user_id ?? data.email, email: data.email }
}

export async function GET(req: Request) {
  try {
    const user = await requireRole('editor')
    const email = new URL(req.url).searchParams.get('user')
    const target = await resolveTarget(user, email)
    if (!target) return NextResponse.json({ error: 'No such team member' }, { status: 404 })

    const [instructions, team] = await Promise.all([
      getInstructions(target.id),
      roleSatisfies(user.role, 'super_admin')
        ? supabase.from('team_users').select('email, name').eq('active_status', true).order('name')
            .then(r => r.data ?? [])
        : Promise.resolve([]),
    ])
    return NextResponse.json({
      email: target.email,
      instructions,
      max_length: MAX_INSTRUCTIONS,
      can_manage_others: roleSatisfies(user.role, 'super_admin'),
      team,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireRole('editor')
    const body = await req.json().catch(() => ({}))
    const target = await resolveTarget(user, typeof body?.user === 'string' ? body.user : null)
    if (!target) return NextResponse.json({ error: 'No such team member' }, { status: 404 })

    const saved = await saveInstructions(target.id, target.email, body?.instructions, user.email)
    return NextResponse.json({ instructions: saved })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
