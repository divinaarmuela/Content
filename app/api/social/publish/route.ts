import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { queuePublishJob, runPublishJob } from '../../../lib/publish'
import { inngest } from '../../../inngest/client'
import { isPlatform, type MediaItem, type Platform } from '../../../lib/publish-core'

/** Queue a post, and optionally push it straight away.
 *
 *  Publishing to a client's real account is a scheduler/account_manager
 *  action; editors submit content through the production workflow instead. */
export async function POST(req: Request) {
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
}

/** Recent publish jobs, newest first — the audit trail for what went out. */
export async function GET(req: Request) {
  try {
    await requireRole('scheduler')
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId')

    let q = supabase
      .from('publish_jobs')
      .select('id, client_id, caption, targets, status, scheduled_for, provider_post_id, permalink, error, attempts, created_at, published_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(url.searchParams.get('limit') ?? 40), 200))
    if (clientId) q = q.eq('client_id', clientId)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ jobs: data ?? [] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
