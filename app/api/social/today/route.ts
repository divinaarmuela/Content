import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, PublishJob, SocialAccount, SocialPost, TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { getPublisher } from '@/app/lib/publisher'
import { heldForClient, waitingForClient } from '@/app/lib/post-stage-core'
import { dayIn, earliestFirst, isGoingOutToday, kindWord, todayState, type ZernioPlatform } from '@/app/lib/today-posts-core'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Loose = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' ? v : null)

/** What Zernio says about one post right now — null when it would not say. */
async function fromZernio(providerPostId: string): Promise<{ status: string | null; platforms: ZernioPlatform[] } | null> {
  try {
    const raw = await Promise.race([
      getPublisher().getPost(providerPostId) as Promise<unknown>,
      new Promise<null>(r => setTimeout(() => r(null), 8000)),
    ]) as Loose | null
    if (!raw) return null
    const p = ((raw.post as Loose) ?? raw) as Loose
    const platforms = (Array.isArray(p.platforms) ? p.platforms : []).map((x: Loose) => ({
      platform: String(x.platform ?? ''),
      status: String(x.status ?? ''),
      url: s(x.platformPostUrl) ?? s(x.url),
      error: s(x.errorMessage) ?? s(x.error),
    }))
    return { status: s(p.status), platforms }
  } catch {
    return null
  }
}

/**
 * GET /api/social/today — every post going out today (Melbourne), newest time
 * first: what it is, where, who approved and booked it, and what Zernio says
 * about it right now.
 */
export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const now = new Date()
      const today = dayIn(now.toISOString())!
      const [posts, jobs, team, clients, accounts, mine] = await Promise.all([
        table<SocialPost>('social_posts').list({ fresh: true }),
        table<PublishJob>('publish_jobs').list({ fresh: true }),
        table<TeamUser>('team_users').list(),
        table<Client>('clients').list(),
        table<SocialAccount>('social_accounts').list(),
        accessibleClientIds(user),
      ])
      const allowed = mine === null ? null : new Set(mine)
      const personName = new Map<string, string>()
      for (const u of team as (TeamUser & Loose)[]) {
        const name = String(u.name ?? u.full_name ?? u.email ?? '').trim()
        if (!name) continue
        personName.set(String(u.id), name)
        if (u.email) personName.set(String(u.email).toLowerCase(), name)
      }
      const who = (v: unknown) => (v ? personName.get(String(v).toLowerCase()) ?? personName.get(String(v)) ?? String(v) : null)
      const clientName = new Map(clients.map(c => [c.id, String(c.name ?? '')]))
      const accountOf = new Map(accounts.map(a => [a.id, a]))
      const jobById = new Map(jobs.map(j => [j.id, j]))

      const todays = (posts as (SocialPost & Loose)[]).filter(p => {
        if (allowed && !allowed.has(p.client_id)) return false
        if (p.stage === 'cancelled') return false
        const at = s(p.scheduled_for) ?? s((p.booking as Loose | null)?.for_time)
        return dayIn(at) === today
      })

      const rows = await Promise.all(todays.map(async p => {
        const booking = (p.booking ?? null) as Loose | null
        const approval = (p.approval ?? null) as Loose | null
        const at = s(p.scheduled_for) ?? s(booking?.for_time)
        const jobIds = [...((booking?.job_ids as string[] | undefined) ?? []), ...((p.publish_job_ids as string[] | null) ?? [])]
        const job = jobIds.map(id => jobById.get(id)).find(Boolean) as (PublishJob & Loose) | undefined
        const providerId = s(job?.provider_post_id)
        const zernio = providerId ? await fromZernio(providerId) : null
        const onClient = heldForClient(p as never) ? ('held' as const) : waitingForClient(p as never) ? ('waiting' as const) : null
        const slides = (Array.isArray(p.slides) ? p.slides : []) as Loose[]
        const images = slides.filter(x => x.type === 'image').length
        const videos = slides.filter(x => x.type === 'video').length
        const per = (p.per_channel ?? {}) as Record<string, Loose>
        const results = ((job?.platform_results as Loose[] | undefined) ?? [])
        const platforms = ((p.channels as string[] | null) ?? []).map(chId => {
          const acc = accountOf.get(chId)
          const platform = acc?.platform ?? 'unknown'
          const z = zernio?.platforms.find(x => x.platform === platform)
          const r = results.find(x => x.platform === platform)
          return {
            platform,
            account: acc?.username ?? acc?.name ?? null,
            kind: kindWord({ stated: s(per[chId]?.kind) ?? s(r?.kind), images, videos, platform }),
            status: z?.status ?? s(r?.status) ?? null,
            url: z?.url ?? s(r?.url),
            error: z?.error ?? null,
          }
        })
        const caption = String(p.caption || Object.values(per).map(c => c?.caption).find(Boolean) || job?.caption || '')
        const thumb = slides.find(x => x.type === 'image')?.url ?? (slides[0]?.thumbnail_url as string | undefined) ?? null
        return {
          id: p.id,
          client_id: p.client_id,
          client: clientName.get(p.client_id) ?? 'Client',
          at,
          caption: caption.split('\n').find(l => l.trim()) ?? '',
          media: { images, videos, thumb },
          platforms,
          stage: p.stage ?? null,
          going: isGoingOutToday({ stage: p.stage, jobStatus: job?.status ?? null, client: onClient }),
          state: todayState({ stage: p.stage, jobStatus: job?.status ?? null, zernio, at, now, client: onClient }),
          madeBy: who(p.created_by),
          approvedBy: who(approval?.by ?? p.approved_by),
          bookedBy: who(job?.created_by),
          bookedAt: s(booking?.at) ?? s(job?.created_at),
          zernio: providerId ? { checked: zernio !== null, status: zernio?.status ?? null } : null,
        }
      }))

      return NextResponse.json({ day: today, checkedAt: now.toISOString(), rows: earliestFirst(rows.filter(r => r.going)) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
