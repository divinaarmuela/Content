import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { PublishJob } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { getPublisher } from '../../../../lib/publisher'
import { logActivity } from '../../../../lib/workflow'
import { inngest } from '../../../../inngest/client'

/**
 * One publish job: pull it back, or send it again.
 *
 * The item-linked version of cancel lives on /api/production/items/[id]/publish
 * and is keyed by item. This one is keyed by the JOB, so it works for the
 * ad-hoc posts the composer makes — which until now could be watched from
 * nowhere and stopped from nowhere.
 */

const MAY_PUBLISH = ['scheduler', 'account_manager', 'super_admin']

const jobs = () => table<PublishJob>('publish_jobs')

async function loadJob(id: string) {
  return jobs().get(id)
}

/**
 * Take a post back.
 *
 * A job still QUEUED has not left the building, so cancelling it is complete.
 * One the provider is already holding (status 'scheduled') has to be pulled
 * back THERE first — a local row saying "cancelled" over a post the provider
 * will still publish is the one outcome worth avoiding, so that failure is
 * reported rather than hidden.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    if (!MAY_PUBLISH.includes(user.role)) {
      return NextResponse.json({ error: 'Cancelling a post is for schedulers and account managers' }, { status: 403 })
    }
    const { id } = await params
    const job = await loadJob(id)
    if (!job) return NextResponse.json({ error: 'That post no longer exists' }, { status: 404 })

    if (job.status === 'publishing') {
      return NextResponse.json(
        { error: 'It is being sent right now — wait for it to finish, then delete the post at the platform' },
        { status: 409 },
      )
    }
    if (!['queued', 'scheduled'].includes(job.status)) {
      return NextResponse.json({ error: 'That post is not waiting to go out' }, { status: 409 })
    }

    if (job.status === 'scheduled' && job.provider_post_id) {
      try {
        await getPublisher().deletePost(job.provider_post_id)
      } catch (e) {
        const why = e instanceof Error ? e.message : 'The channel would not cancel it'
        return NextResponse.json({
          error: `Cancelled here, but ${why}. Open the post at the platform and delete it there.`,
        }, { status: 502 })
      }
    }

    // it may have gone out while we were asking, so the status the operator
    // acted on is checked INSIDE the write: still where they saw it, or the
    // cancel does not land at all
    const cancelled = await jobs().claim(job.id, cur =>
      cur && cur.status === job.status
        // publish_jobs carries no updated_at trigger, so the stamp is explicit
        ? { ...cur, status: 'cancelled', error: null, updated_at: new Date().toISOString() }
        : null)
    if (!cancelled.claimed) {
      return NextResponse.json(
        { error: 'It moved on while you were cancelling — refresh to see where it got to' },
        { status: 409 },
      )
    }

    await logActivity({
      actor: user, clientId: job.client_id,
      entityType: 'publish_job', entityId: job.id, action: 'publish_cancelled',
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/**
 * Send a failed post again.
 *
 * Back to `queued` with the error cleared, then the same event the composer
 * sends — so it goes immediately rather than on the next ten-minute pass.
 * The attempt counter is left alone on purpose: `dueJobIds` stops at five,
 * and a retry button that reset it would let one broken post be hammered
 * forever.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    if (!MAY_PUBLISH.includes(user.role)) {
      return NextResponse.json({ error: 'Sending a post is for schedulers and account managers' }, { status: 403 })
    }
    const { id } = await params
    const job = await loadJob(id)
    if (!job) return NextResponse.json({ error: 'That post no longer exists' }, { status: 404 })
    if (job.status !== 'failed') {
      return NextResponse.json({ error: 'Only a post that did not go out can be sent again' }, { status: 409 })
    }
    if (job.attempts >= 5) {
      return NextResponse.json(
        { error: 'This post has failed five times. Fix what the error says, then make a new post.' },
        { status: 409 },
      )
    }

    // same one-winner rule as the cancel above: only a job that is STILL
    // failed goes back on the queue, so two retry clicks cannot send twice
    const requeued = await jobs().claim(job.id, cur =>
      cur && cur.status === 'failed'
        ? { ...cur, status: 'queued', error: null, updated_at: new Date().toISOString() }
        : null)
    if (!requeued.claimed) {
      return NextResponse.json({ error: 'It changed while you were retrying — refresh' }, { status: 409 })
    }

    await inngest.send({ name: 'app/post.publish.requested', data: { jobId: job.id } })
    await logActivity({
      actor: user, clientId: job.client_id,
      entityType: 'publish_job', entityId: job.id, action: 'publish_retried',
    })
    return NextResponse.json({ ok: true, status: 'queued' })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
