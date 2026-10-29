import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ContentItem, PostAnalytic, PublishJob, SocialAccount, SocialPost, TeamUserClient } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError } from '../../../lib/authz'
import { getPublisher } from '../../../lib/publisher'
import { accessibleClientIdsOf } from '../../../lib/scope-client'
import { byHandRows } from '../../../lib/post-outcome-core'
import { waitingForClient } from '../../../lib/post-stage-core'
import { DEFAULT_TZ, monthInZone } from '../../../lib/timezone-core'
import {
  jobTargets, metaQueueCounts, middleOfMonth, monthPostsByAccount, zernioMonthCounts,
  type AccountPostsRow, type LiveCounts, type MonthJob, type PostLogEntry, type WaitingPost, type ZernioPostLite,
} from '../../../lib/overview-posts-core'

/**
 * GET /api/overview/posts-month — THE OVERVIEW'S "POSTS THIS MONTH", from Zernio (29 Oct 2026: "thats wrong data …
 * make sure we get that from zernio"; "if scheduled but waiting client approval … there should be notify or copy
 * portal link"). Managers only. Per account: what Zernio published, holds for later and failed this month (plus our
 * own Instagram queue), the posts still waiting on the client — each to notify — and the month's numbers and by-hand
 * posts as before. Read on the server, so the Overview no longer listens to every publishing job and analytics row
 * live; kept for two minutes per scope.
 */
export const dynamic = 'force-dynamic'

type Row = AccountPostsRow & { waiting: WaitingPost[]; log: PostLogEntry[] }
const cache = new Map<string, { at: number; body: { rows: Row[]; source: 'zernio' | 'jobs'; at: string } }>()
const KEEP_MS = 2 * 60 * 1000

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (user.role !== 'super_admin' && user.role !== 'account_manager') throw new AuthzError('Managers only', 403)
      const links = await table<TeamUserClient>('team_user_clients').list({ by: { team_user_id: user.id } }).catch(() => [] as TeamUserClient[])
      const scoped = accessibleClientIdsOf({ id: user.id, role: user.role } as never, links as never)
      // ANY MONTH (the owner, 29 Oct 2026: "make a quick button for other months too"): ?month=2026-11; this month without it
      const asked = middleOfMonth(new URL(req.url).searchParams.get('month'))
      const key = `${scoped === null ? 'all' : [...scoped].sort().join(',')}|${asked ? asked.toISOString().slice(0, 7) : 'now'}`
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < KEEP_MS) return NextResponse.json(hit.body)

      const now = asked ?? new Date()
      const [accounts, clients, jobs, analytics, items, posts] = await Promise.all([
        table<SocialAccount>('social_accounts').list(),
        table<Client>('clients').list(),
        table<PublishJob>('publish_jobs').list(),
        table<PostAnalytic>('post_analytics').list().catch(() => [] as PostAnalytic[]),
        table<ContentItem>('content_items').list(),
        table<SocialPost>('social_posts').list(),
      ])
      const base = monthPostsByAccount({
        now, accounts: accounts as never, clients: clients as never, jobs: jobs as unknown as MonthJob[],
        byHand: byHandRows(items as never), analytics: analytics as never, clientIds: scoped, defaultTz: DEFAULT_TZ,
      })

      const clientById = new Map(clients.map(c => [c.id, c]))
      const tzOf = (id: string) => (clientById.get(id) as { timezone?: string | null } | undefined)?.timezone || DEFAULT_TZ
      const inMonth = (iso: string | null | undefined, clientId: string) => {
        if (!iso) return false
        const want = monthInZone(now, tzOf(clientId)), got = monthInZone(iso, tzOf(clientId))
        return !!want && !!got && want.month === got.month && want.year === got.year
      }
      const mine = accounts.filter(a => a.active !== false && a.client_id && (scoped === null || scoped.includes(String(a.client_id))))
      const byProvider = new Map(mine.filter(a => a.provider_account_id).map(a => [String(a.provider_account_id), { id: a.id, client_id: a.client_id ? String(a.client_id) : null }]))

      // the window, a day wider each side so every client's own month is inside it
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 86_400_000).toISOString().slice(0, 10)
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) + 86_400_000).toISOString().slice(0, 10)
      const zernio = await getPublisher().postsBetween?.(from, to).catch(() => null) ?? null
      let counts: Map<string, LiveCounts> | null = null
      const log = new Map<string, PostLogEntry[]>()
      if (zernio) {
        counts = zernioMonthCounts(zernio as ZernioPostLite[], byProvider, inMonth, log)
        const accountsOfJob = (job: MonthJob) => {
          const out: { id: string; client_id: string | null }[] = []
          for (const t of jobTargets(job)) {
            const hit = (t.accountId ? byProvider.get(t.accountId) : undefined)
              ?? (() => { const a = mine.find(x => x.client_id === (job.client_id ?? null) && String(x.platform).toLowerCase() === t.platform); return a ? { id: a.id, client_id: a.client_id ? String(a.client_id) : null } : undefined })()
            if (hit) out.push(hit)
          }
          return out
        }
        metaQueueCounts(jobs as never, accountsOfJob, inMonth, counts, log)
      }

      // waiting on the client: booked and still waiting on their word, or with them before booking
      const waitingByAccount = new Map<string, WaitingPost[]>()
      for (const p of posts as unknown as (SocialPost & { stage?: string; channels?: unknown; if_no_answer?: unknown; client_review?: unknown })[]) {
        const booked = waitingForClient(p as never)
        if (!booked && p.stage !== 'with_client') continue
        if (!p.client_id || !inMonth(p.scheduled_for ?? null, String(p.client_id))) continue
        for (const ch of Array.isArray(p.channels) ? p.channels.map(String) : []) {
          if (!mine.some(a => a.id === ch)) continue
          waitingByAccount.set(ch, [...(waitingByAccount.get(ch) ?? []), { post_id: p.id, at: p.scheduled_for ?? null, booked }])
        }
      }

      // SCHEDULED, AWAITING THE CLIENT'S APPROVAL (the owner, 29 Oct 2026: "add a tag booked in but awaiting client
      // approval … copy portal link"). Such a post IS booked in Zernio — its booking's jobs carry the Zernio post — so
      // that post's own line in the log carries the tag and our post's id for Notify. One whose Zernio post is not
      // found still gets a line of its own, so none goes missing
      const jobById = new Map(jobs.map(j => [j.id, j]))
      const platformOf = new Map(mine.map(a => [a.id, String(a.platform)]))
      const awaitingByZernio = new Map<string, string>()
      const zernioIds = new Set([...log.values()].flat().map(e => e.id.split(':')[0]))
      for (const p of posts as unknown as (SocialPost & { stage?: string; channels?: unknown; caption?: unknown; booking?: { job_ids?: unknown } | null; publish_job_ids?: unknown })[]) {
        if (!waitingForClient(p as never) || !p.client_id || !inMonth(p.scheduled_for ?? null, String(p.client_id))) continue
        const jobIds = [...(Array.isArray(p.booking?.job_ids) ? p.booking!.job_ids as unknown[] : []), ...(Array.isArray(p.publish_job_ids) ? p.publish_job_ids : [])].map(String)
        const zids = jobIds.map(j => (jobById.get(j) as { provider_post_id?: string | null } | undefined)?.provider_post_id).filter((z): z is string => !!z)
        const found = zids.filter(z => zernioIds.has(z))
        for (const z of found) awaitingByZernio.set(z, p.id)
        if (found.length > 0) continue
        const chans = (Array.isArray(p.channels) ? p.channels.map(String) : []).filter(ch => platformOf.has(ch))
        const entry: PostLogEntry = {
          id: `post:${p.id}`, status: 'booked', at: p.scheduled_for ?? null, caption: String(p.caption ?? '').trim(), url: null, error: null,
          networks: chans.map(ch => ({ platform: platformOf.get(ch)!, status: 'booked' as const, url: null })), awaiting_client: true, post_id: p.id,
        }
        for (const ch of chans) log.set(ch, [...(log.get(ch) ?? []), entry])
      }
      const tagged = (e: PostLogEntry): PostLogEntry => {
        const pid = e.status === 'booked' ? awaitingByZernio.get(e.id.split(':')[0]) : undefined
        return pid ? { ...e, awaiting_client: true, post_id: pid } : e
      }

      // one row per account with anything this month; Zernio's three numbers replace the jobs' when Zernio answered
      const rows = new Map<string, Row>(base.map(r => [r.key, { ...r, waiting: [], log: [] }]))
      const blank = (a: SocialAccount): Row => ({
        key: a.id, account_id: a.id, client_id: a.client_id ? String(a.client_id) : null,
        client_name: clientById.get(String(a.client_id))?.name ?? 'No client', platform: String(a.platform),
        username: (a as { username?: string | null }).username ?? (a as { name?: string | null }).name ?? null,
        went_out: 0, booked: 0, did_not: 0, by_hand: 0, metrics: { interactions: null, likes: null, comments: null, views: null }, waiting: [], log: [],
      })
      for (const a of mine) {
        const c = counts?.get(a.id)
        const w = waitingByAccount.get(a.id) ?? []
        if (!rows.has(a.id) && !c && w.length === 0) continue
        const r = rows.get(a.id) ?? blank(a)
        if (counts) { r.went_out = c?.went_out ?? 0; r.booked = c?.booked ?? 0; r.did_not = c?.did_not ?? 0 }
        r.waiting = w.sort((x, y) => String(x.at ?? '').localeCompare(String(y.at ?? '')))
        // newest first, as Zernio's own list
        // what went out and what is booked only (the owner, 29 Oct 2026: "remove the did not go out ones")
        r.log = (log.get(a.id) ?? []).filter(e => e.status !== 'did_not').map(tagged).sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')))
        rows.set(a.id, r)
      }
      const list = [...rows.values()]
        .filter(r => r.went_out + r.booked + r.by_hand + r.waiting.length > 0)
        .sort((a, b) => (b.went_out + b.booked + b.by_hand) - (a.went_out + a.booked + a.by_hand)
          || a.client_name.localeCompare(b.client_name) || String(a.platform ?? '').localeCompare(String(b.platform ?? '')))
      const body = { rows: list, source: (counts ? 'zernio' : 'jobs') as 'zernio' | 'jobs', at: new Date().toISOString() }
      cache.set(key, { at: Date.now(), body })
      return NextResponse.json(body)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
