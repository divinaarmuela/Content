import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { queuePublishJob, runPublishJob } from '../../../lib/publish'
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

    // Hand the job to the provider straight away, whether it publishes now or
    // later. The provider holds the schedule, so a scheduled post does not
    // depend on our cron running at the right minute — and the operator finds
    // out immediately if it was refused, rather than at the scheduled time.
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
    await requireRole('editor')
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
