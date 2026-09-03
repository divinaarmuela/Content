import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, BatchComment } from '@/lib/db-types'
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
 * sets `assigned_to`, emails them with a link to this shoot, and keeps the
 * note under "Waiting on you" until it is marked done. The client never sees
 * who is tagged — the portal reads the body only.
 */

/** Every comment carries who wrote it — "who said this" is half its meaning. */
const withAuthors = (rows: BatchComment[]) =>
  attachOne(rows, 'author_id', 'team_users', ['name', 'role'])

async function guard(user: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const batch = await table<Batch>('batches').get(id)
  if (!batch) return { response: NextResponse.json({ error: 'Shoot not found' }, { status: 404 }) }
  if (!(await canOpenBatch(user, batch))) {
    return { response: NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 }) }
  }
  return { batch }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const g = await guard(user, id)
    if ('response' in g) return g.response
    let comments: unknown[] = []
    try {
      comments = await withAuthors(await table<BatchComment>('batch_comments').list({
        by: { batch_id: id },
        orderBy: [['created_at', 'asc']],
        limit: 200,
      }))
    } catch {
      // a thread that cannot be read is an empty thread, not an error page
      comments = []
    }
    return NextResponse.json({ comments, viewer_id: user.id })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
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

    let data: (BatchComment & { team_users: Record<string, unknown> | null }) | null = null
    try {
      const row = await table('batch_comments').insert({
        batch_id: id, author_id: user.id, body, assigned_to: assignedTo,
        // an unstamped boolean reads back absent, and "still open" filters
        // test `resolved === false`
        resolved: false,
      })
      data = (await withAuthors([row as unknown as BatchComment]))[0]
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save the comment' }, { status: 500 })
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
  })
}

/** Mark a tagged shoot comment done (or reopen it). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const g = await guard(user, id)
    if ('response' in g) return g.response
    const json = await req.json()
    if (!json.comment_id || typeof json.resolved !== 'boolean') {
      return NextResponse.json({ error: 'comment_id and resolved are required' }, { status: 400 })
    }
    const comments = table<BatchComment>('batch_comments')
    const existing = await comments.get(String(json.comment_id))
    // the comment must be on THIS shoot — never mark somebody else's thread
    if (!existing || existing.batch_id !== id) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }
    const updated = await comments.update(existing.id, { resolved: json.resolved })
    const data = updated ? (await withAuthors([updated]))[0] : null
    if (json.resolved) await settleTagNotifications(id, String(json.comment_id))
    announceBatchChange({ batch_id: id, client_id: g.batch.client_id, status: 'brief', kind: 'updated' })
    return NextResponse.json({ comment: data })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
