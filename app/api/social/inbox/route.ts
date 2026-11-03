import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
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
    // ONE client: every page of its accounts. ALL clients (~45 accounts): each one's newest 100, six at a time — five
    // pages each, four at a time, was still past 40 s (read live 3 Nov 2026)
    const all = clientId === 'all'
    const rows = (await inBatches(scope, all ? 6 : 4, a => allPosts(publisher, String(a.provider_account_id), all ? 1 : 5))).flat()
    const connectedIds = new Set(accounts.map(a => a.provider_account_id))
    const seen = new Set<string>()
    const data = withComments(onlyConnected(rows, connectedIds))
      .filter(p => { const k = `${p.accountId ?? ''}:${p.id}`; if (seen.has(k)) return false; seen.add(k); return true })
      .sort((x, y) => (Date.parse(y.createdTime ?? '') || 0) - (Date.parse(x.createdTime ?? '') || 0))
    return NextResponse.json({ data, configured: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}

type PostRow = { id: string; accountId?: string; createdTime?: string; commentCount?: number }

/** Every page of one account's commented posts, 100 at a time — capped, so a runaway cursor cannot hang the page. */
async function allPosts(publisher: ReturnType<typeof getPublisher>, accountId: string, maxPages: number): Promise<PostRow[]> {
  const out: PostRow[] = []
  let cursor: string | null = null
  for (let i = 0; i < maxPages; i++) {
    const page = await publisher.listComments({ accountId, limit: 100, cursor }).catch(() => null) as { data?: PostRow[] } | null
    if (!page) break
    out.push(...(page.data ?? []))
    cursor = nextCursor(page)
    if (!cursor) break
  }
  return out
}
