import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { PostVersion } from '@/lib/db-types'
import { authzErrorResponse, requireSignedIn } from '@/app/lib/authz'
import { loadPostState, mayActOn } from '@/app/lib/post-stage'
import type { PostEventRow } from '@/app/lib/post-stage-core'

/**
 * GET /api/posts/<id>/versions — EVERY SAVED VERSION OF A POST (the owner, 2 Nov 2026: "save everything from past
 * versions within that modal … they would want to look back at it"). Each version is frozen when the post is sent for
 * the quality check, to the client, or booked (post_versions, `<post>_v<n>`): its media, channels, every channel's
 * caption and its time. Also `wasBooked`: the version that was booked and its time, when the post has since been taken
 * off the schedule and not booked again — so the window can offer to book it straight back.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      const { post } = await loadPostState(id)
      if (!post) return NextResponse.json({ error: 'That post is not there any more.' }, { status: 404 })
      if (user.role === 'client' || !(await mayActOn(user, post))) return NextResponse.json({ error: 'Not one of your posts.' }, { status: 403 })
      const [versions, events, team] = await Promise.all([
        table<PostVersion>('post_versions').list({ where: v => v.post_id === id }).catch(() => [] as PostVersion[]),
        table<PostEventRow>('post_events').list({ where: e => e.post_id === id }).catch(() => [] as PostEventRow[]),
        table<{ id: string; name?: string | null }>('team_users').list().catch(() => []),
      ])
      const nameOf = (uid: string | null | undefined) => (uid ? team.find(t => t.id === uid)?.name ?? null : null)
      // the last time it left the schedule, and whether it was booked again after
      const ev = [...events].sort((a, b) => a.rev - b.rev)
      // taken off by a PERSON (Edit, Take off the schedule) — a booking the channel refused is not 'was booked' (2 Nov 2026)
      const lastOff = [...ev].reverse().find(e => e.from === 'booked' && (e.action === 'edit_booked' || e.action === 'unbook'))
      const bookedAfter = lastOff ? ev.some(e => e.rev > lastOff.rev && e.to === 'booked') : true
      const offVersion = lastOff ? versions.find(v => v.n === (lastOff.version ?? post.sent_version)) : null
      const wasBooked = lastOff && !bookedAfter && offVersion && ['draft', 'ready', 'cancelled'].includes(post.stage)
        ? { n: offVersion.n, at: offVersion.scheduled_for, offBy: nameOf(lastOff.actor_id), offAt: lastOff.at }
        : null
      return NextResponse.json({
        versions: versions.sort((a, b) => b.n - a.n).map(v => ({
          n: v.n, frozen_for: v.frozen_for, frozen_at: v.frozen_at, frozen_by: nameOf(v.frozen_by),
          slides: v.slides, caption: v.caption, channels: v.channels, per_channel: v.per_channel,
          scheduled_for: v.scheduled_for, timezone: v.timezone, automation: v.automation ?? null,
        })),
        current: post.sent_version,
        wasBooked,
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
