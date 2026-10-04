import { NextRequest, NextResponse } from 'next/server'
import { guard, requireRole, authzErrorResponse } from '@/app/lib/authz'
import { table } from '@/lib/db'
import type { Client, PublishJob, SocialAccount, SocialPost } from '@/lib/db-types'
import { listClientAccounts, metaIgReady } from '@/app/lib/meta-ig'
import { readPostState } from '@/app/lib/post-stage-core'
import { META_PROVIDER, routeMark, type InstagramRoute } from '@/app/lib/meta-route-core'
import { accessibleClientIds } from '@/app/lib/production-access'
import { AuthzError } from '@/app/lib/authz'

/** the client must be one this person works on — the same rule as the Schedule's, without its mailer */
async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

/**
 * /api/meta/instagram/accounts — super admins only.
 *
 * GET ?clientId=  this client's DIRECT Instagram connections, for the "Direct
 *                 — testing" card (never the token: listClientAccounts strips
 *                 it), and the client's switch `instagram_via_meta`.
 * GET ?postId=    which road this post's Instagram takes — the mark on the
 *                 channel line ("Instagram · direct (Meta)"). A booked post
 *                 answers from its jobs (what WILL happen); an unbooked one
 *                 from the rule as it stands (meta-route-core.ts).
 * PATCH { clientId, viaMeta }  the switch: "Post this client's Instagram
 *                 through Meta (testing)". Off by default.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get('postId')?.trim()
  if (postId) {
    const denied = await guard('super_admin')
    if (denied) return denied
    return NextResponse.json(await postRoute(postId))
  }
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  // an account manager reads their own clients' connection (the Meta reviewer is a 100M-only manager); a super admin any
  try {
    const me = await requireRole('account_manager')
    await assertMine(me, clientId)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  const ready = metaIgReady()
  const [accounts, client] = await Promise.all([
    listClientAccounts(clientId),
    table<Client>('clients').get(clientId, { fresh: true }).catch(() => null),
  ])
  return NextResponse.json({
    configured: ready.ok, reason: ready.ok ? null : ready.reason, accounts,
    viaMeta: (client as { instagram_via_meta?: unknown } | null)?.instagram_via_meta === true,
  })
}

export async function PATCH(req: NextRequest) {
  try {
    await requireRole('super_admin')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  const body = await req.json().catch(() => null) as { clientId?: unknown; viaMeta?: unknown } | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId || typeof body?.viaMeta !== 'boolean') {
    return NextResponse.json({ error: 'clientId and viaMeta (true or false) are required' }, { status: 400 })
  }
  const client = await table<Client>('clients').get(clientId, { fresh: true }).catch(() => null)
  if (!client) return NextResponse.json({ error: 'No such client' }, { status: 404 })
  await table<Client>('clients').update(clientId, { instagram_via_meta: body.viaMeta } as Partial<Client>)
  return NextResponse.json({ ok: true, viaMeta: body.viaMeta })
}

type PostRoute = { route: InstagramRoute | null; mark: string | null }

async function postRoute(postId: string): Promise<PostRoute> {
  const none: PostRoute = { route: null, mark: null }
  const row = await table<SocialPost>('social_posts').get(postId, { fresh: true }).catch(() => null)
  const post = readPostState(row as never)
  if (!post) return none

  // booked: the jobs say what will happen
  const jobIds = post.booking?.job_ids ?? []
  if (jobIds.length > 0) {
    const jobs = (await Promise.all(jobIds.map(id => table<PublishJob>('publish_jobs').get(id).catch(() => null))))
      .filter((j): j is PublishJob => !!j && j.status !== 'cancelled')
    const meta = jobs.find(j => j.provider === META_PROVIDER)
    if (meta) {
      const { metaStillRouted } = await import('@/app/lib/meta-ig-publish')
      const still = await metaStillRouted(meta)
      const route: InstagramRoute = still.ok
        ? { via: 'meta', igUserId: still.state.ig_user_id, username: still.state.username ?? null }
        : { via: 'zernio', reason: still.reason }
      return { route, mark: routeMark(route) }
    }
    const igOnZernio = jobs.some(j => Array.isArray(j.targets) && (j.targets as { platform?: string }[]).some(t => t?.platform === 'instagram'))
    if (igOnZernio) {
      // booked before the switch, or not eligible: say so only when the client is switched on
      const { metaRoutingFor } = await import('@/app/lib/meta-ig-publish')
      const routing = await metaRoutingFor(post.client_id)
      const route: InstagramRoute = { via: 'zernio', reason: routing.viaMeta ? 'This booking was made for Zernio — book it again to send it through Meta' : null }
      return { route, mark: routeMark(route) }
    }
    return none
  }

  // not booked: the rule as it stands, on the post's own channels and files
  const accounts = (await table<SocialAccount>('social_accounts').list({ by: { client_id: post.client_id } }).catch(() => []))
    .filter(a => post.channels.includes(a.id))
  if (!accounts.some(a => a.platform === 'instagram')) return none
  const [{ targetsFor }, { splitBookingForMeta }] = await Promise.all([
    import('@/app/lib/social-schedule'), import('@/app/lib/meta-ig-publish'),
  ])
  const targets = targetsFor({ slides: post.slides, per_channel: post.per_channel } as never, accounts)
  const media = post.slides.map(s => ({ url: s.url, type: s.type === 'video' ? 'video' as const : 'image' as const }))
  const split = await splitBookingForMeta({ clientId: post.client_id, targets, accounts, media })
  const route = split.meta
    ? { via: 'meta' as const, igUserId: split.meta.state.ig_user_id, username: split.meta.state.username ?? null }
    : split.routes[0] ?? null
  return { route, mark: routeMark(route) }
}
