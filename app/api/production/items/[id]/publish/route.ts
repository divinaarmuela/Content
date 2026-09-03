import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity, notifyPublishQueued } from '../../../../../lib/workflow'
import {
  markScheduledAfterQueue, planItemPublish, queueItemPublish,
} from '../../../../../lib/production-publish'
import { announceItemChange } from '../../../../../lib/production-live'
import { table, withRequestCache } from '@/lib/db'
import type { PublishJob } from '@/lib/db-types'
import { getPublisher } from '../../../../../lib/publisher'
import { releaseClaimLock } from '../../../../../lib/claim-lock'
import { publishLockKey } from '../../../../../lib/publish'

/**
 * Who may put something on a client's live accounts.
 *
 * Not the plain ladder: `requireRole('scheduler')` admits editors, and editing
 * a cut is not the same act as sending it to the public.
 *
 * But the list left out the account manager, who runs the client's schedule
 * and signs the work off — so the person answering to the client for what goes
 * out was the one person who could not send it, while an EDITOR-level ladder
 * check on /api/social/publish let them post the same content ad-hoc through
 * the composer. The comment on POST below already said "Scheduler and above";
 * this is the code catching up with it.
 */
const MAY_PUBLISH = ['scheduler', 'account_manager', 'super_admin']

const NOT_ALLOWED = 'Publishing to a client account is for schedulers and account managers'

/** What would be published for this item, and what is stopping it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    if (!MAY_PUBLISH.includes(user.role)) {
      return NextResponse.json({ error: NOT_ALLOWED }, { status: 403 })
    }
    const { id } = await params
    await loadItemForUser(user, id) // client scoping
    return NextResponse.json(await planItemPublish(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Send an approved item to the client's connected channels.
 *
 *  Scheduler and above: this is the act of putting content in front of the
 *  public, and it is gated on the workflow having approved the item. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    if (!MAY_PUBLISH.includes(user.role)) {
      return NextResponse.json({ error: NOT_ALLOWED }, { status: 403 })
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({}))

    const result = await queueItemPublish(id, {
      publishNow: body.publishNow === true,
      createdBy: user.email,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error, issues: result.issues }, { status: 400 })
    }

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: body.publishNow ? 'publish_requested' : 'publish_queued',
      detail: `publish job ${result.id}`,
    })

    // an explicit empty pick means "tell no one" — only an ABSENT field
    // falls back to the client's assigned managers
    if (!Array.isArray(body.notifyIds) || body.notifyIds.length > 0) {
      notifyPublishQueued(user, item, {
        jobId: result.id,
        publishNow: body.publishNow === true,
        // the email names the hour, in the audience's zone — the person
        // reading it may be in a different one from the person who set it
        scheduledFor: result.plan.scheduledFor,
        timezone: result.plan.timezone,
        recipientIds: Array.isArray(body.notifyIds)
          ? body.notifyIds.map((v: unknown) => String(v)).filter(Boolean)
          : undefined,
      })
    }

    // Handing a post to the provider IS scheduling it — the status follows in
    // the same request rather than waiting for somebody to remember. Done
    // after the notification fan-out so a slow transition never delays the
    // "it's queued" email, and after the activity log so the trail reads in
    // the order things happened.
    const movedTo = await markScheduledAfterQueue(user, item, result.plan, body.publishNow === true)

    announceItemChange({
      item_id: id, client_id: item.client_id,
      status: movedTo ?? item.status, kind: movedTo ? 'transition' : 'schedule',
    })
    return NextResponse.json({ jobId: result.id, status: movedTo ?? item.status })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/**
 * Take a queued post back.
 *
 * Two different worlds, and the difference matters to whoever presses this:
 * a job still QUEUED has not left the building, so cancelling it is complete.
 * A job the provider is already holding (status 'scheduled') has to be pulled
 * back THERE — and when that fails, we say so rather than showing a cancelled
 * post that is still going to appear on the client's feed.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    if (!MAY_PUBLISH.includes(user.role)) {
      return NextResponse.json({ error: NOT_ALLOWED }, { status: 403 })
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)

    const jobs = table<PublishJob>('publish_jobs')
    const job = (await jobs.list({
      where: r => r.content_item_id === id && ['queued', 'publishing', 'scheduled'].includes(r.status),
      orderBy: [['created_at', 'desc']],
      limit: 1,
    }))[0] ?? null

    if (!job) return NextResponse.json({ error: 'Nothing is queued for this item' }, { status: 400 })
    if (job.status === 'publishing') {
      return NextResponse.json(
        { error: 'It is being sent right now — wait for it to finish, then delete the post at the platform' },
        { status: 409 },
      )
    }

    // pull it back at the provider FIRST: a local row saying "cancelled" over
    // a post the provider will still publish is the one outcome worth avoiding
    let providerNote: string | null = null
    if (job.status === 'scheduled' && job.provider_post_id) {
      try {
        await getPublisher().deletePost(job.provider_post_id as string)
      } catch (e) {
        providerNote = e instanceof Error ? e.message : 'The channel would not cancel it'
        return NextResponse.json({
          error: `Cancelled here, but ${providerNote}. Open the post at the platform and delete it there.`,
        }, { status: 502 })
      }
    }

    // it may have gone out while we were asking, so the status the operator
    // acted on is checked INSIDE the write: still where they saw it, or the
    // cancel does not land at all
    const cancelled = await jobs.claim(job.id, cur =>
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
    // a cancelled job stops owning its content item
    if (job.content_item_id) {
      await releaseClaimLock(publishLockKey(String(job.content_item_id)), job.id).catch(() => {})
    }

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'publish_cancelled',
      detail: `publish job ${job.id}`,
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'schedule' })
    return NextResponse.json({ cancelled: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
