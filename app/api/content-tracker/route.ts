import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Client, ContentTracker, SocialAccount } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import {
  inMonth, monthKey, monthRange, piecesFromZernio, piecesFromZernioScheduled, sanitiseTrackerPatch, scheduledUntilByClient, shiftMonth,
  trackerLine, trackerPosts, trackerRowId, type TrackerPost,
} from '@/app/lib/content-tracker-core'

/**
 * THE CONTENT TRACKER (app/lib/content-tracker-core.ts) — the team's monthly sheet, live.
 *
 * GET ?month=YYYY-MM   one row per client: graphics and reels required against what is in ZERNIO for them that
 *                      month, published through it or still scheduled (the owner: "get from zernio"), stories, LinkedIn, scheduled until (the
 *                      last post waiting in Zernio), status, what is still needed, and the columns a person types
 *                      (notes, responsible, in Asana); and every post that went live that month with its numbers.
 *                      A client is on the sheet once Zernio published for them in the month or targets were set.
 *                      Zernio's lists are read page by page and kept 5 minutes.
 * PATCH { client_id, month, …columns }   what a person typed, merged onto that client's month.
 *
 * Team only (scheduler and up).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PAGE = 100
const MAX_PAGES = 30
const KEEP_MS = 5 * 60_000
const cache = new Map<string, { at: number; raw: unknown[] }>()
let waiting: { at: number; raw: unknown[] } | null = null

/** every post waiting in Zernio to go out */
async function scheduledInZernio(fresh: boolean): Promise<unknown[]> {
  if (!fresh && waiting && Date.now() - waiting.at < KEEP_MS) return waiting.raw
  const publisher = getPublisher()
  if (!publisher.configured()) return []
  const raw: unknown[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await publisher.scheduledPage({ page, limit: PAGE }) as { posts?: unknown[]; pagination?: { pages?: number } } | null
    if (!res) break
    raw.push(...(res.posts ?? []))
    if (page >= Number(res.pagination?.pages ?? 1) || (res.posts ?? []).length === 0) break
  }
  waiting = { at: Date.now(), raw }
  return raw
}

async function monthFromZernio(month: string, fresh: boolean): Promise<{ raw: unknown[]; complete: boolean }> {
  const hit = cache.get(month)
  if (!fresh && hit && Date.now() - hit.at < KEEP_MS) return { raw: hit.raw, complete: true }
  const range = monthRange(month)!
  const publisher = getPublisher()
  if (!publisher.configured()) return { raw: [], complete: false }
  const raw: unknown[] = []
  let complete = true
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await publisher.analyticsPage({ fromDate: range.from, toDate: range.to, page, limit: PAGE }) as
      { posts?: unknown[]; pagination?: { pages?: number } } | null
    if (!res) { complete = false; break }
    raw.push(...(res.posts ?? []))
    const pages = Number(res.pagination?.pages ?? 1)
    if (page >= pages || (res.posts ?? []).length === 0) break
    if (page === MAX_PAGES) complete = false
  }
  if (raw.length) cache.set(month, { at: Date.now(), raw })
  return { raw, complete }
}

export async function GET(req: Request) {
  try {
    await requireRole('scheduler')
    const url = new URL(req.url)
    const month = url.searchParams.get('month') || monthKey(new Date().toISOString())!
    if (!monthRange(month)) return NextResponse.json({ error: 'month is YYYY-MM' }, { status: 400 })
    const previous = shiftMonth(month, -1)

    const fresh = url.searchParams.get('fresh') === '1'
    const [{ raw, complete }, queued, accounts, clients, rows, links, team] = await Promise.all([
      monthFromZernio(month, fresh),
      scheduledInZernio(fresh),
      table<SocialAccount>('social_accounts').list(),
      table<Client>('clients').list(),
      table<ContentTracker>('content_tracker').list({ where: r => r.month === month || r.month === previous }),
      table<{ id: string; client_id: string; team_user_id: string }>('team_user_clients').list(),
      table<{ id: string; name: string; role: string; active_status: boolean }>('team_users').list(),
    ])

    const clientOfAccount = new Map(accounts.filter(a => a.provider_account_id).map(a => [String(a.provider_account_id), a.client_id ?? null]))
    const clientOf = (id: string | null) => (id ? clientOfAccount.get(id) ?? null : null)

    const feed: TrackerPost[] = inMonth(trackerPosts({ posts: raw }, clientOf), month)
    // the month in Zernio: what went out through it, and what is still waiting to go
    const pieces = [...piecesFromZernio({ posts: raw }, clientOf), ...piecesFromZernioScheduled({ posts: queued }, clientOf)]
    const until = scheduledUntilByClient({ posts: queued }, clientOf)

    // the clients on the sheet: Zernio published for them this month, or someone set their targets (this month or
    // last) — not every connected account (Pattons posts on its own; none of it is ours)
    const withPieces = new Set(pieces.filter(p => p.clientId && monthKey(p.at) === month).map(p => String(p.clientId)))
    const withRows = new Set(rows.map(r => r.client_id))
    const onSheet = clients.filter(c => withPieces.has(c.id) || (withRows.has(c.id) && (c.status ?? 'active') === 'active'))
    // the rest of the active clients, so one can be added to the sheet
    const addable = clients.filter(c => (c.status ?? 'active') === 'active' && !onSheet.some(o => o.id === c.id))
      .map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))

    const logo = new Map<string, string>()
    for (const a of accounts) {
      const pic = (a as { avatar_url?: string | null }).avatar_url
      if (a.client_id && pic && !logo.has(a.client_id)) logo.set(a.client_id, pic)
    }
    const people = new Map(team.filter(t => t.active_status && (t.role === 'account_manager' || t.role === 'super_admin')).map(t => [t.id, t.name]))
    const managers = (clientId: string) => links.filter(l => l.client_id === clientId).map(l => people.get(l.team_user_id)).filter(Boolean).join(' / ')
    const rowOf = (clientId: string, m: string) => rows.find(r => r.id === trackerRowId(clientId, m)) ?? null

    const lines = onSheet.map(c => trackerLine(c.id, pieces, month, rowOf(c.id, month) as never, rowOf(c.id, previous) as never, managers(c.id), until.get(c.id) ?? null))
    const named = clients
      .filter(c => onSheet.some(o => o.id === c.id) || feed.some(p => p.clientId === c.id))
      .map(c => ({ id: c.id, name: c.name, logo: logo.get(c.id) ?? null }))

    return NextResponse.json({ month, lines, posts: feed, clients: named, addable, complete, fetchedAt: new Date().toISOString() })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const clientId = typeof body?.client_id === 'string' ? body.client_id : ''
    const month = typeof body?.month === 'string' ? body.month : ''
    if (!clientId || !monthRange(month)) return NextResponse.json({ error: 'client_id and month (YYYY-MM) are needed' }, { status: 400 })
    if (!(await table<Client>('clients').get(clientId))) return NextResponse.json({ error: 'No such client' }, { status: 404 })
    const patch = sanitiseTrackerPatch(body)
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    const id = trackerRowId(clientId, month)
    const now = new Date().toISOString()
    // merged onto whatever is there now, in one write: two people typing in two columns both land
    const done = await table<ContentTracker>('content_tracker').claim(id, cur => ({
      ...(cur ?? { id, client_id: clientId, month, created_at: now }),
      ...patch,
      updated_by: user.id,
      updated_at: now,
    }) as ContentTracker)
    if (!done.claimed) return NextResponse.json({ error: 'Could not save — try again' }, { status: 409 })
    return NextResponse.json({ ok: true, row: done.row })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
