import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { PostComment, SocialPost } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { mayActOnRow } from '@/app/lib/post-stage'
import { parseNoteInput } from '@/app/lib/post-window-core'
import { notifyTagged, resolveTags, taggableTeam } from '@/app/lib/comment-tags'
import { teamPostPath } from '@/app/lib/post-notify-core'

/**
 * A NOTE ON A POST — pinned to one file, or to the whole post (the owner's
 * decision 9, 29 Sep 2026: "comment is per file").
 *
 * Two threads. Team is the default and never reaches the client; Client is
 * the thread the portal shows (P6 reads it with `commentVisibleTo`). A note is
 * appended, never edited here, so there is nothing to race: every insert is
 * its own row. It never writes to a client. A TEAM member tagged in it ("@Manal Rizwan") is told — an email and
 * the bell, linked to the post — like a tag on a card (the owner, 22 Oct 2026: "why doesnt it get notified")
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
      // the same rule the act route and the boards use: the quality reviewer may note any post
      // waiting on the check, whoever's client it is
      if (!(await mayActOnRow(user, post as never))) {
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
      // the people tagged in a team note are told; a client-thread note tags nobody (it is the client's to read)
      if (parsed.note.visibility === 'team' && parsed.note.body.includes('@')) {
        const tagged = resolveTags(parsed.note.body, [], await taggableTeam(), user.id)
        if (tagged.length) {
          const title = String((post as { caption?: string | null }).caption ?? '').split(/\r?\n/)[0].slice(0, 60) || 'a post'
          await notifyTagged({
            actor: user, tagged, text: parsed.note.body, commentId: String((comment as { id?: string }).id ?? now),
            target: { kind: 'post', id: post.id, title: `the post “${title}”`, path: teamPostPath(post as never) },
          }).catch(e => console.error('post comment tag notify failed', e))
        }
      }
      return NextResponse.json({ comment })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
