import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, TeamUser as TeamUserRow } from '@/lib/db-types'
import { announceAfter } from '@/lib/live'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { claimDraftPost } from '../../../../../lib/post-stage'
import { currentFiles } from '../../../../../lib/final-files-core'
import { slideTypeFromUrl, type Slide } from '../../../../../lib/version-files-core'
import { safeZone } from '../../../../../lib/timezone-core'
import { batchApprovalSteps } from '../../../../../lib/post-batch-core'
import { SCHEDULING_HAND_TO_ORDER } from '../../../../../lib/hand-over-core'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { DASHBOARD_URL } from '../../../../../lib/app-url'
import { logActivity } from '../../../../../lib/workflow'

/**
 * POST THESE (the owner, 26 Oct 2026: "I just want the videos/images to be post not the card" — "videos that are approved
 * or images that are not approved and goes into post approval and post it or I can hand over to someone to post").
 *
 *   POST { file_ids, to, together }   the picked files on the card, approved or not, become draft posts in Post
 *                                     approval — one post each, or all in one post in the order picked — made for `to`
 *                                     (yourself, or a scheduler / account manager / super admin, who is told).
 *
 * The card does not move and keeps its files. Each post is CLAIMED under an id made of the card and the files, so a
 * second press makes nothing twice (trap 11). A draft tells nobody (audit V12); the hand-over's one notice says it.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id) as unknown as { id: string; client_id: string; title: string }
      const body = await req.json().catch(() => ({})) as { file_ids?: unknown; to?: unknown; together?: unknown }
      const want = Array.isArray(body.file_ids) ? [...new Set(body.file_ids.map(String))].slice(0, 30) : []
      const onCard = currentFiles(item as never)
      const picked = want.map(fid => onCard.find(f => f.id === fid)).filter((f): f is NonNullable<typeof f> => !!f)
      if (picked.length === 0) return NextResponse.json({ error: 'Pick at least one video or picture on the card' }, { status: 400 })
      // who makes the posts: yourself, or a person who schedules (the Hand to… popup's list)
      const toId = typeof body.to === 'string' && body.to ? body.to : user.id
      const to = toId === user.id ? null : await table<TeamUserRow>('team_users').get(toId)
      if (toId !== user.id && (!to || to.active_status === false || !(SCHEDULING_HAND_TO_ORDER as readonly string[]).includes(String(to.role)))) {
        return NextResponse.json({ error: 'Posts go to a scheduler, an account manager or a super admin' }, { status: 400 })
      }
      const client = await table<Client>('clients').get(item.client_id).catch(() => null)
      const zone = safeZone((client as { timezone?: string | null } | null)?.timezone ?? null)
      const steps = batchApprovalSteps(client as never)
      const slideOf = (f: (typeof picked)[number]): Slide => ({
        url: f.url, name: f.name, type: String(f.mime).startsWith('video/') ? 'video' : slideTypeFromUrl(f.url), ...(f.size ? { bytes: f.size } : {}),
      })
      const groups = body.together === true ? [picked] : picked.map(f => [f])
      const ids: string[] = []
      let made = 0
      for (const g of groups) {
        const key = createHash('sha256').update(`${item.id}|${g.map(f => f.id).join(',')}`).digest('hex').slice(0, 24)
        const postId = `pick_${key}`
        const res = await claimDraftPost({
          id: postId, client_id: item.client_id, item_id: item.id,
          created_by: toId, assigned_to: toId, version_id: null, version_number: null,
          slides: g.map(slideOf), caption: '', channels: [], per_channel: {}, scheduled_for: null, timezone: zone, approval_steps: steps,
        })
        ids.push(postId)
        if (res.created) { made++; announceAfter('schedule', { client_id: item.client_id, post_id: postId, kind: 'created' }) }
      }
      await logActivity({
        actor: user, clientId: item.client_id, entityType: 'content_item', entityId: item.id, action: 'posts_made',
        detail: `${picked.length} ${picked.length === 1 ? 'file' : 'files'} sent to Post approval as ${groups.length} ${groups.length === 1 ? 'post' : 'posts'}${to ? ` for ${to.name || to.email}` : ''}`,
      }).catch(() => undefined)
      // handed to someone else: their one notice
      if (to && made > 0 && to.email) {
        await notify({
          actorName: user.name ?? null, actorEmail: user.email ?? null,
          eventType: 'posts_handed', entityType: 'content_item', entityId: `${item.id}#posts#${ids.join(',').slice(0, 200)}`,
          recipientId: to.id, recipientEmail: String(to.email), clientId: item.client_id,
          subject: `${user.name || user.email} handed you ${made} ${made === 1 ? 'post' : 'posts'} from ${item.title}`,
          bodyHtml: renderEmail(
            'Posts to make',
            `<p>${escapeHtml(user.name || user.email || 'Someone')} sent ${made} ${made === 1 ? 'post' : 'posts'} from <strong>${escapeHtml(item.title)}</strong> to Post approval for you — add the caption, channels and time.</p>`,
            'Open Post approval', `${DASHBOARD_URL}/dashboard/scheduler/board`,
          ),
        }).catch(e => console.error('[make-posts] telling the person failed:', e instanceof Error ? e.message : e))
      }
      return NextResponse.json({ ok: true, posts: ids.length, made })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
