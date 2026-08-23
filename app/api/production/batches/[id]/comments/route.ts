import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { accessibleClientIds } from '../../../../../lib/production-access'

/**
 * The shoot's comment thread, team side — the same rows the client reads
 * and writes on their portal shoot page. One thread, two windows.
 */

async function guard(user: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const { data: batch } = await supabase
    .from('batches').select('id, client_id').eq('id', id).maybeSingle()
  if (!batch) return { response: NextResponse.json({ error: 'Shoot not found' }, { status: 404 }) }
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(batch.client_id)) {
    return { response: NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 }) }
  }
  return { batch }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const g = await guard(user, id)
    if ('response' in g) return g.response
    const { data, error } = await supabase
      .from('batch_comments')
      .select('id, created_at, body, author_id, team_users!batch_comments_author_id_fkey(name, role)')
      .eq('batch_id', id)
      .order('created_at', { ascending: true })
      .limit(200)
    // table not migrated yet → an empty thread, not an error page
    return NextResponse.json({ comments: error ? [] : data ?? [] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const g = await guard(user, id)
    if ('response' in g) return g.response
    const body = String((await req.json()).body ?? '').trim().slice(0, 4000)
    if (!body) return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })
    const { data, error } = await supabase
      .from('batch_comments')
      .insert({ batch_id: id, author_id: user.id, body })
      .select('id, created_at, body, author_id, team_users!batch_comments_author_id_fkey(name, role)')
      .single()
    if (error) {
      return NextResponse.json({ error: 'Comments need supabase/portal_comments.sql run first' }, { status: 503 })
    }
    return NextResponse.json({ comment: data })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
