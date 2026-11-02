import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireSignedIn } from '@/app/lib/authz'
import { loadPostState, mayActOn } from '@/app/lib/post-stage'
import { ACTION_LABEL, type PostEventRow } from '@/app/lib/post-stage-core'

/**
 * GET /api/posts/<id>/log — A POST'S LOG, for anyone on the team who may open it (the owner, 2 Nov 2026: "can we
 * add a log section in the card … so everyone can see"): every move (who, when, the words they left) and, under
 * each, the notices it sent — to whom, when, and whether it went. Read only when the Log tab is opened.
 *
 * The notices are matched by the move they belong to (`<post>#r<rev>` in notification_log), the moves by the post.
 * Neither table is indexed by post, so both are read and filtered here — a few thousand small rows, on demand.
 */
export const dynamic = 'force-dynamic'

type Notice = { entity_id?: string | null; recipient_email?: string | null; recipient_id?: string | null; subject?: string | null; status?: string | null; sent_at?: string | null; created_at?: string | null; event_type?: string | null }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      const { post } = await loadPostState(id)
      if (!post) return NextResponse.json({ error: 'That post is not there any more.' }, { status: 404 })
      if (user.role === 'client' || !(await mayActOn(user, post))) return NextResponse.json({ error: 'Not one of your posts.' }, { status: 403 })
      const [events, notices, team] = await Promise.all([
        table<PostEventRow>('post_events').list({ where: e => e.post_id === id }).catch(() => [] as PostEventRow[]),
        // the post's own notices, and its card's (the editor's "Please acknowledge", a hand-over)
        table<Notice & { id: string }>('notification_log' as never).list({ where: n => {
          const e = String(n.entity_id ?? '')
          return e === id || e.startsWith(`${id}#`) || (!!post.source_item_id && (e === post.source_item_id || e.startsWith(`${post.source_item_id}#`)))
        } }).catch(() => []),
        table<{ id: string; name?: string | null; email?: string | null }>('team_users').list().catch(() => []),
      ])
      const nameOf = (uid: string | null | undefined) => (uid ? team.find(t => t.id === uid)?.name ?? null : null)
      const byEmail = (email: string | null | undefined) => (email ? team.find(t => (t.email ?? '').toLowerCase() === email.toLowerCase())?.name ?? null : null)
      const rows = [...events].sort((a, b) => a.rev - b.rev).map(e => ({
        rev: e.rev,
        at: e.at,
        what: ACTION_LABEL[e.action] ?? e.action,
        by: e.actor_id ? nameOf(e.actor_id) ?? 'Someone on the team' : e.hat === 'client' ? 'The client' : 'The app',
        from: e.from, to: e.to,
        note: e.note ?? null,
        sent: notices
          .filter(n => n.entity_id === `${id}#r${e.rev}` || String(n.entity_id ?? '').startsWith(`${id}#r${e.rev}#`))
          .map(n => ({ to: nameOf(n.recipient_id) ?? byEmail(n.recipient_email) ?? n.recipient_email ?? 'someone', email: n.recipient_email ?? null, subject: n.subject ?? '', status: n.status ?? null, at: n.sent_at ?? n.created_at ?? null })),
      }))
      // notices that belong to no single move (reminders) still say who was told
      const matched = new Set(rows.flatMap(r => r.sent.map(s => `${s.email}|${s.subject}|${s.at}`)))
      const other = notices
        .map(n => ({ to: nameOf(n.recipient_id) ?? byEmail(n.recipient_email) ?? n.recipient_email ?? 'someone', email: n.recipient_email ?? null, subject: n.subject ?? '', status: n.status ?? null, at: n.sent_at ?? n.created_at ?? null }))
        .filter(n => !matched.has(`${n.email}|${n.subject}|${n.at}`))
      return NextResponse.json({ rows, other })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
