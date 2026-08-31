import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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

async function loadJob(id: string) {
  const { data } = await supabase
    .from('publish_jobs')
    .select('id, client_id, content_item_id, status, provider_post_id, attempts')
    .eq('id', id)
    .maybeSingle()
  return data
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

    const { data: cancelled } = await supabase
      .from('publish_jobs')
      .update({ status: 'cancelled', error: null, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', job.status)     // it may have gone out while we were asking
      .select('id')
      .maybeSingle()
    if (!cancelled) {
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

    const { data: requeued } = await supabase
      .from('publish_jobs')
      .update({ status: 'queued', error: null, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'failed')
      .select('id')
      .maybeSingle()
    if (!requeued) {
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
}
