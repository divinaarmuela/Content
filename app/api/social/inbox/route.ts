import { NextResponse, after } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { byLatestComment, FIRST_VISIT_WINDOW_MS } from '@/app/lib/inbox-clients-core'
import type { InboxTouch, InboxView, InboxPostCache } from '@/lib/db-types'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { accessibleClientIds } from '@/app/lib/production-access'
import { nextCursor } from '@/app/lib/inbox-core'
import { getPublisher } from '@/app/lib/publisher'

/** Keep only comments from a currently-connected account (the owner, 14 Sep
 *  2026: a disconnected account's comments were still showing). A comment
 *  with no account id is kept — nothing to judge it by. */
export function onlyConnected<T extends { accountId?: string }>(rows: T[], connectedIds: Set<string>): T[] {
  return rows.filter(c => !c.accountId || connectedIds.has(c.accountId))
}

/** Only posts somebody commented on (the owner, 3 Nov 2026: "why are comments not appearing?"). Zernio's list is
 *  every recent post, newest first, `commentCount: 0` included (read live 3 Nov 2026: Justin Engelke's had posts
 *  with 5, 4 and 1 comments under a run of 0s) — so the top of the Inbox was a wall of "0 comments" and the posts
 *  people had actually commented on were buried. A row with no count is kept: nothing to judge it by. */
export function withComments<T extends { commentCount?: number }>(rows: T[]): T[] {
  return rows.filter(r => typeof r.commentCount !== 'number' || r.commentCount > 0)
}

/** Run `fn` over `items` a few at a time — Zernio's inbox calls share a per-minute allowance, and asking for every
 *  account at once ("All clients", about 45 of them, up to 5 pages each) was refused part-way and hung the page. */
export async function inBatches<T, R>(items: readonly T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

/** One client's posts that have comments, EVERY PAGE of each of its accounts (30 Sep 2026: the list was one page of
 *  50 across all 26 accounts, reaching back four days, so a client's older posts never showed). `?clientId=` is
 *  required; `all` walks every account the person may see. */
export const maxDuration = 60

export async function GET(req: Request) {
 return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const publisher = getPublisher()
    if (!publisher.configured()) return NextResponse.json({ data: [], configured: false })
    const clientId = new URL(req.url).searchParams.get('clientId') ?? 'all'
    const accounts = await table<SocialAccount>('social_accounts').list()
    let scope = accounts.filter(a => a.active !== false && a.provider_account_id && a.client_id)
    if (clientId !== 'all') {
      await assertClientAccess(user, clientId)
      scope = scope.filter(a => a.client_id === clientId)
    } else {
      const mine = await accessibleClientIds(user)
      if (mine !== null) scope = scope.filter(a => mine.includes(String(a.client_id)))
    }
    // ONE client: every page of each of its accounts, four accounts at a time. ALL clients: Zernio's own cross-account
    // list (one request covers every connected account — 48 on 3 Nov 2026), five pages of 100, newest first; asking
    // account by account was past 40 s however it was batched (read live 3 Nov 2026). Scoped to this person below.
    // …AND A TIME LIMIT: Zernio can take over 40 s to answer across every account, and a page that spins forever reads
    // as broken (3 Nov 2026). Whatever has arrived by the deadline is shown, marked `partial`.
    // 30 s, not 12 (3 Nov 2026): Zernio's first cross-account answer took 17 s cold (0.9 s warm), so 12 s showed nothing
    const deadline = Date.now() + 30_000
    // OUR COPY FIRST (3 Nov 2026: "why is it so slow"): each account's newest 100 posts as Zernio last gave them,
    // shown at once and refreshed in the background once over a minute old. Zernio's own answer is ~1 s warm but up
    // to 23 s cold per account (all 48 timed live: 4 s warm, 25 s cold). Which posts were commented on, and when,
    // comes from our webhook notes below — so a new comment moves its post up even before the copy refreshes.
    const rows = (await Promise.all(scope.map(a => cachedPosts(publisher, String(a.provider_account_id), deadline)))).flat()
    const partial = Date.now() >= deadline
    const connectedIds = new Set(accounts.map(a => a.provider_account_id))
    const seen = new Set<string>()
    const unique = withComments(onlyConnected(rows, connectedIds))
      .filter(p => { const k = `${p.accountId ?? ''}:${p.id}`; if (seen.has(k)) return false; seen.add(k); return true })
    // BY LATEST COMMENT, with "N new" per person (3 Nov 2026) — from our own webhook notes
    const [touches, views] = await Promise.all([
      table<InboxTouch>('inbox_touches').list({ fresh: true }).catch(() => [] as InboxTouch[]),
      table<InboxView>('inbox_views').list({ fresh: true, where: v => v.user_id === user.id }).catch(() => [] as InboxView[]),
    ])
    const seenFor = new Map(views.map(v => [v.client_id, v.seen_at]))
    const dayAgo = new Date(Date.now() - FIRST_VISIT_WINDOW_MS).toISOString()
    const data = byLatestComment(unique, touches, c => (c && seenFor.get(c)) || dayAgo)
    return NextResponse.json({ data, configured: true, partial })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}

type PostRow = { id: string; accountId?: string; createdTime?: string; commentCount?: number }

/** The answer, or null once the deadline passes — a slow Zernio page is given up on, not waited for. */
function beforeDeadline<T>(p: Promise<T>, deadline: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()))),
  ])
}

const FRESH_MS = 60_000
const postCache = () => table<InboxPostCache>('inbox_post_cache')

/** One account's newest posts: our copy at once (refreshed after the answer when over a minute old), or — when there
 *  is no copy yet — Zernio live, within the deadline, and saved for next time. */
async function cachedPosts(publisher: ReturnType<typeof getPublisher>, accountId: string, deadline: number): Promise<PostRow[]> {
  const copy = await postCache().get(accountId).catch(() => null)
  const rows = Array.isArray(copy?.rows) ? copy.rows as PostRow[] : null
  if (rows) {
    if (Date.now() - (Date.parse(copy?.fetched_at ?? '') || 0) > FRESH_MS) after(() => refreshPosts(publisher, accountId, Date.now() + 60_000))
    return rows
  }
  return (await refreshPosts(publisher, accountId, deadline)) ?? []
}

/** Read Zernio's newest page for one account and keep it; null when Zernio did not answer in time (the copy stays). */
async function refreshPosts(publisher: ReturnType<typeof getPublisher>, accountId: string, deadline: number): Promise<PostRow[] | null> {
  const page = await beforeDeadline(publisher.listComments({ accountId, limit: 100 }), deadline) as { data?: PostRow[] } | null
  if (!page) return null
  const rows = page.data ?? []
  await postCache().upsert({ id: accountId, rows, fetched_at: new Date().toISOString() }).catch(() => {})
  return rows
}

/** Every page of one account's commented posts, 100 at a time — capped, so a runaway cursor cannot hang the page. */
async function allPosts(publisher: ReturnType<typeof getPublisher>, accountId: string, maxPages: number, deadline: number): Promise<PostRow[]> {
  const out: PostRow[] = []
  let cursor: string | null = null
  for (let i = 0; i < maxPages && Date.now() < deadline; i++) {
    const page = await beforeDeadline(publisher.listComments({ accountId, limit: 100, cursor }), deadline) as { data?: PostRow[] } | null
    if (!page) break
    out.push(...(page.data ?? []))
    cursor = nextCursor(page)
    if (!cursor) break
  }
  return out
}
