import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { PostComment, SocialPost } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { parseNoteInput } from '@/app/lib/post-window-core'

/**
 * A NOTE ON A POST — pinned to one file, or to the whole post (the owner's
 * decision 9, 29 Sep 2026: "comment is per file").
 *
 * Two threads. Team is the default and never reaches the client; Client is
 * the thread the portal shows (P6 reads it with `commentVisibleTo`). A note is
 * appended, never edited here, so there is nothing to race: every insert is
 * its own row. It emails nobody — nothing in the posting flow ever writes to
 * a client on its own.
 *
 * Team members only (`requireRole('scheduler')` is the whole team ladder), and
 * only on a post of a client they may work on. The browser reads the notes
 * live from `post_comments`; this route is only the write.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const post = await table<SocialPost>('social_posts').get(id)
      if (!post) return NextResponse.json({ error: 'That post no longer exists' }, { status: 404 })
      const clients = await accessibleClientIds(user)
      if (clients !== null && !clients.includes(post.client_id)) {
        return NextResponse.json({ error: 'That client is not one of yours' }, { status: 403 })
      }
      const parsed = parseNoteInput(await req.json().catch(() => null))
      if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
      const now = new Date().toISOString()
      const comment = await table<PostComment>('post_comments').insert({
        post_id: post.id,
        client_id: post.client_id,
        version: parsed.note.version,
        file_url: parsed.note.file_url,
        slide_index: parsed.note.slide_index,
        visibility: parsed.note.visibility,
        author_id: user.id,
        author_name: user.name || user.email,
        author_role: user.role,
        body: parsed.note.body,
        assigned_to: null,
        resolved_at: null,
        resolved_by: null,
        created_at: now,
        updated_at: now,
      })
      return NextResponse.json({ comment })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
