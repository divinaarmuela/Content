import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { PublishJob } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { queuePublishJob, runPublishJob } from '../../../lib/publish'
import { inngest } from '../../../inngest/client'
import { isPlatform, type MediaItem, type Platform } from '../../../lib/publish-core'

// relayMedia (lib/publish.ts) streams multi-hundred-MB files through this
// function synchronously; the platform default timeout is too short for that.
export const maxDuration = 300

/** Queue a post, and optionally push it straight away.
 *
 *  Publishing to a client's real account is a scheduler/account_manager
 *  action; editors submit content through the production workflow instead. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json()

    const targets = (Array.isArray(body.targets) ? body.targets : [])
      .filter((t: unknown) => {
        const x = t as { platform?: unknown; accountId?: unknown }
        return typeof x.platform === 'string' && isPlatform(x.platform) && typeof x.accountId === 'string'
      }) as { platform: Platform; accountId: string }[]

    if (targets.length === 0) {
      return NextResponse.json({ error: 'Select at least one connected account' }, { status: 400 })
    }

    const queued = await queuePublishJob({
      clientId: body.clientId ?? null,
      contentItemId: body.contentItemId ?? null,
      scheduleEntryId: body.scheduleEntryId ?? null,
      caption: String(body.caption ?? ''),
      media: (Array.isArray(body.media) ? body.media : []) as MediaItem[],
      targets,
      scheduledFor: body.scheduledFor ?? null,
      timezone: body.timezone,
      createdBy: user.email,
    })

    if ('error' in queued) {
      return NextResponse.json({ error: queued.error, issues: queued.issues }, { status: 400 })
    }

    /**
     * Hand the job over — inline when that is quick, in the background when
     * it is not.
     *
     * Publishing inline is genuinely better when it can be done: the provider
     * holds the schedule either way, and the operator finds out immediately if
     * a post was refused rather than at the scheduled time.
     *
     * It stops being possible the moment there is MEDIA. The job relays every
     * file — reads it out of our storage and pushes it to the provider — and a
     * video makes that longer than a serverless function is allowed to live.
     * The function is killed, the response never arrives, the button spins
     * until the browser gives up, and the row is left mid-flight for the
     * reclaim to find. The post is not lost, but nobody watching could tell.
     *
     * So anything carrying media goes to `publish-post`, which is the same
     * code with no request waiting on it. The answer comes back as `queued`
     * immediately, and the job's own status is what reports the outcome.
     */
    const heavy = (Array.isArray(body.media) ? body.media : []).length > 0
    if (heavy) {
      await inngest.send({
        name: 'app/post.publish.requested',
        data: { jobId: queued.id },
      })
      // even if that send is dropped, `dueJobIds` picks up any queued job on
      // the next dispatcher tick — the event only makes it immediate
      return NextResponse.json({ id: queued.id, status: 'queued', background: true })
    }

    const status = await runPublishJob(queued.id)
    return NextResponse.json({ id: queued.id, status: status ?? 'publishing' })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Recent publish jobs, newest first — the audit trail for what went out. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId')

    const rows = await table<PublishJob>('publish_jobs').list({
      where: clientId ? j => j.client_id === clientId : undefined,
      orderBy: [['created_at', 'desc']],
      limit: Math.min(Number(url.searchParams.get('limit') ?? 40), 200),
    })
    // the columns the old select named. timezone, media and updated_at ride
    // along: the activity page prints the booked time in the CLIENT's zone,
    // shows a thumbnail, and needs updated_at to tell "sending now" from
    // "stuck for twenty minutes"
    const jobs = rows.map(j => ({
      id: j.id, client_id: j.client_id, content_item_id: j.content_item_id,
      caption: j.caption, media: j.media, targets: j.targets,
      status: j.status, scheduled_for: j.scheduled_for, timezone: j.timezone,
      provider_post_id: j.provider_post_id, permalink: j.permalink,
      error: j.error, attempts: j.attempts,
      created_at: j.created_at, updated_at: j.updated_at, published_at: j.published_at,
    }))
    return NextResponse.json({ jobs })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
