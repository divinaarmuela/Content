import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { announceBatchChange } from '../../../../../lib/production-live'
import {
  notifyTagged, resolveTags, settleTagNotifications, taggableTeam,
} from '../../../../../lib/comment-tags'

/**
 * The shoot's comment thread, team side — the same rows the client reads
 * and writes on their portal shoot page. One thread, two windows.
 *
 * Since wave 2 a team member can tag a colleague here with "@Name": that
 * sets `assigned_to` (supabase/shoot_comment_tags.sql), emails them with a
 * link to this shoot, and keeps the note under "Waiting on you" until it is
 * marked done. The client never sees who is tagged — the portal reads the
 * body only.
 */

const COLS = 'id, created_at, body, author_id, assigned_to, resolved, team_users!batch_comments_author_id_fkey(name, role)'
/** the wave-1 shape, for a database where the tags SQL has not run yet */
const COLS_LEGACY = 'id, created_at, body, author_id, team_users!batch_comments_author_id_fkey(name, role)'

async function guard(user: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const { data: batch } = await supabase
    .from('batches').select('id, client_id, owner_id, title').eq('id', id).maybeSingle()
  if (!batch) return { response: NextResponse.json({ error: 'Shoot not found' }, { status: 404 }) }
  if (!(await canOpenBatch(user, batch))) {
    return { response: NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 }) }
  }
  return { batch }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const g = await guard(user, id)
    if ('response' in g) return g.response
    let { data, error } = await supabase
      .from('batch_comments').select(COLS).eq('batch_id', id)
      .order('created_at', { ascending: true }).limit(200)
    if (error) {
      const again = await supabase
        .from('batch_comments').select(COLS_LEGACY).eq('batch_id', id)
        .order('created_at', { ascending: true }).limit(200)
      data = again.data as typeof data
      error = again.error
    }
    // table not migrated yet → an empty thread, not an error page
    return NextResponse.json({ comments: error ? [] : data ?? [], viewer_id: user.id })
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
    const json = await req.json()
    const body = String(json.body ?? '').trim().slice(0, 4000)
    if (!body) return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })

    const explicit = [
      ...(Array.isArray(json.mention_ids) ? json.mention_ids.map(String) : []),
      ...(json.assigned_to ? [String(json.assigned_to)] : []),
    ]
    const tagged = resolveTags(body, explicit, await taggableTeam(), user.id)
    const assignedTo = tagged[0]?.id ?? null

    let { data, error } = await supabase
      .from('batch_comments')
      .insert({ batch_id: id, author_id: user.id, body, assigned_to: assignedTo })
      .select(COLS)
      .single()
    if (error && assignedTo === null) {
      // the tags column may not exist yet — a plain comment still lands
      const again = await supabase
        .from('batch_comments').insert({ batch_id: id, author_id: user.id, body }).select(COLS_LEGACY).single()
      data = again.data as typeof data
      error = again.error
    }
    if (error) {
      return NextResponse.json({
        error: assignedTo
          ? 'Tagging on shoot comments needs supabase/shoot_comment_tags.sql run first'
          : 'Comments need supabase/portal_comments.sql run first',
      }, { status: 503 })
    }
    if (tagged.length > 0 && data) {
      await notifyTagged({
        actor: user, tagged, text: body,
        target: { kind: 'shoot', id, title: String(g.batch.title ?? 'a shoot') },
        commentId: String((data as { id: string }).id),
      })
    }
    announceBatchChange({ batch_id: id, client_id: g.batch.client_id, status: 'brief', kind: 'updated' })
    return NextResponse.json({ comment: data })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Mark a tagged shoot comment done (or reopen it). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const g = await guard(user, id)
    if ('response' in g) return g.response
    const json = await req.json()
    if (!json.comment_id || typeof json.resolved !== 'boolean') {
      return NextResponse.json({ error: 'comment_id and resolved are required' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('batch_comments')
      .update({ resolved: json.resolved })
      .eq('id', json.comment_id).eq('batch_id', id)
      .select(COLS)
      .single()
    if (error) return NextResponse.json({ error: 'Marking done needs supabase/shoot_comment_tags.sql run first' }, { status: 503 })
    if (json.resolved) await settleTagNotifications(id, String(json.comment_id))
    announceBatchChange({ batch_id: id, client_id: g.batch.client_id, status: 'brief', kind: 'updated' })
    return NextResponse.json({ comment: data })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
