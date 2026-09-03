import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachMany, attachOne } from '@/lib/db-join'
import type {
  Batch, ClientAgreement, ContentItem, PostAnalytic,
} from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'
import {
  agreementMonthWindow, computeMonthlyProgress, effectiveQuotas, liveAtFromEntries,
  normaliseDeliverableLines, paceStatus,
} from '../../../lib/agreement-core'
import { isInternalKind } from '../../../lib/task-kind-core'
import { safeZone } from '../../../lib/timezone-core'
import { melbourneMonthKey, PORTAL_TZ } from '../../../lib/post-analytics-core'
import {
  buildMonthRows, monthKeyOf,
  type MonthAnalyticsRow, type MonthClientInput, type MonthTypeLine,
} from '../../../lib/overview-month-core'

/**
 * "This month across clients" — what every client was promised, what they got,
 * and what it did.
 *
 * The at-risk endpoint answers "who is behind?"; this answers the owner's
 * wider question — *did each client get their month, and how is it
 * performing?* — so it carries the same agreement maths plus the last post and
 * the month's views. Managers and super admins only: it spans clients, and it
 * is scoped through the same `accessibleClientIds` gate as everything else, so
 * an account manager sees their own clients and nobody else's.
 *
 * One bulk fetch per table, grouped in memory. Never N+1 across clients.
 */
export async function GET(req: Request) {
 return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const now = new Date()
    const url = new URL(req.url)
    const month = Number(url.searchParams.get('month')) || now.getMonth() + 1
    const year = Number(url.searchParams.get('year')) || now.getFullYear()
    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Bad month' }, { status: 400 })
    }
    const isThisMonth = month === now.getMonth() + 1 && year === now.getFullYear()
    const daysInMonth = new Date(year, month, 0).getDate()
    // a past month is complete: pace is measured against its whole length,
    // never against today's date in a month that already ended
    const dayOfMonth = isThisMonth ? now.getDate() : daysInMonth
    const monthKey = monthKeyOf(month, year)

    const ids = await accessibleClientIds(user)
    // an empty id list scopes to nothing on its own — no sentinel needed
    // every read below degrades to empty rather than erroring the page: a
    // transient fault yields a month with no rows, the same as overview GET
    const clients = await table('clients').list({
      by: { status: 'active' },
      where: ids === null ? undefined : r => ids.includes(r.id),
      orderBy: [['name', 'asc']],
    }).catch(() => [])
    const clientIds = clients.map(c => c.id)
    if (clientIds.length === 0) {
      return NextResponse.json({ month, year, month_key: monthKey, tz: PORTAL_TZ, clients: [] })
    }

    // the analytics window, widened a day either side so a Melbourne month
    // boundary can never clip a post; the exact month test is done in the pure
    // core, against the agency's zone
    const from = new Date(Date.UTC(year, month - 1, 1) - 86_400_000).toISOString()
    const to = new Date(Date.UTC(year, month, 1) + 86_400_000).toISOString()

    const [agreements, commitments, items, batches] = await Promise.all([
      table<ClientAgreement>('client_agreements')
        .list({ where: r => clientIds.includes(r.client_id) }).catch(() => []),
      table('monthly_commitments')
        .list({ where: r => clientIds.includes(r.client_id as string) && r.month === month && r.year === year })
        .catch(() => []),
      table<ContentItem>('content_items')
        .list({ where: r => clientIds.includes(r.client_id), limit: 4000 })
        .then(rows => attachOne(rows, 'work_kind_id', 'work_kinds', ['slug', 'uses_media']))
        .then(rows => attachMany(rows, 'id', 'schedule_entries', 'item_id', ['published_at']))
        .catch(() => []),
      table<Batch>('batches')
        .list({ where: r => clientIds.includes(r.client_id), limit: 1000 }).catch(() => []),
    ])

    type ItemRow = {
      id: string; title: string | null; client_id: string; batch_id: string | null
      content_type: string; status: string; due_date: string | null; created_at: string | null
      work_kinds?: { slug?: string; uses_media?: boolean } | null
      schedule_entries?: { published_at?: string | null }[] | null
    }
    const itemRows = items as unknown as ItemRow[]

    // the month's cached numbers, keyed by item so the kind of piece — and
    // therefore whether it is judged on views or reach — comes from OUR data,
    // not the provider's. The table may not be migrated yet: no rows means
    // "—" in the Views column, which is what it said yesterday.
    const analyticsByClient = new Map<string, MonthAnalyticsRow[]>()
    const itemById = new Map(itemRows.map(i => [i.id, i]))
    const analytics = await table<PostAnalytic>('post_analytics').list({
      where: r => r.published_at != null && r.published_at >= from && r.published_at < to,
      limit: 5000,
    }).catch(() => [])
    for (const a of analytics) {
      const item = itemById.get(a.item_id as string)
      if (!item) continue                       // a post outside this caller's clients
      const arr = analyticsByClient.get(item.client_id) ?? []
      arr.push({
        content_type: item.content_type,
        published_at: a.published_at as string | null,
        views: a.views as number | null,
        reach: a.reach as number | null,
        impressions: a.impressions as number | null,
      })
      analyticsByClient.set(item.client_id, arr)
    }

    const agByClient = new Map(agreements.map(a => [a.client_id, a]))
    const cmByClient = new Map(commitments.map(c => [c.client_id as string, c]))
    const itemsByClient = new Map<string, ItemRow[]>()
    for (const it of itemRows) {
      const arr = itemsByClient.get(it.client_id) ?? []
      arr.push(it); itemsByClient.set(it.client_id, arr)
    }
    const batchesById = new Map(batches.map(b => [b.id, b]))

    const inputs: MonthClientInput[] = clients.map(client => {
      const id = client.id as string
      const name = client.name as string
      // this client's month, on this client's calendar — the table spans
      // zones, and a Manila client's August does not start when Melbourne's does
      const tz = safeZone(client.timezone as string | null)
      const linesRes = normaliseDeliverableLines(agByClient.get(id)?.deliverable_lines)
      const agreementLines = 'lines' in linesRes ? linesRes.lines : []
      const quotas = effectiveQuotas(agreementLines, cmByClient.get(id) ?? null)

      // the deliverable pipeline only: a shoot brief is a plan, and a research
      // task is not a post — neither is something the client was promised
      const clientItems = (itemsByClient.get(id) ?? [])
        .filter(i => (i.work_kinds?.slug ?? '') !== 'shoot_brief')
        .filter(i => !isInternalKind(i.work_kinds))
        .map(i => ({ ...i, published_at: liveAtFromEntries(i.schedule_entries) }))

      // the month's most recent live post, and the item to open for it
      let lastPost: MonthClientInput['last_post'] = null
      for (const i of clientItems) {
        if (!i.published_at) continue
        if (melbourneMonthKey(i.published_at, tz) !== monthKey) continue
        if (!lastPost || i.published_at > lastPost.at) {
          lastPost = { at: i.published_at, item_id: i.id, title: i.title }
        }
      }

      const analyticsRows = analyticsByClient.get(id) ?? []
      if (quotas.length === 0) {
        return { id, name, has_agreement: false, lines: [], last_post: lastPost, analytics: analyticsRows, tz }
      }

      // pacing runs on the agreement's own clock: a deal signed mid-month is
      // measured over the days it was live, and one that starts later owes
      // nothing yet
      const window = agreementMonthWindow(
        (agByClient.get(id) as { start_date?: string | null } | undefined)?.start_date,
        month, year, { day: dayOfMonth, daysInMonth },
      )
      const progress = computeMonthlyProgress(clientItems, batchesById, month, year, quotas, tz)
      const lines: MonthTypeLine[] = progress.map(p => ({
        type: p.type,
        label: p.label,
        promised: p.quota,
        posted: p.posted,
        scheduled: p.scheduled,
        // "in production" on this table means everything not yet booked or
        // live — an approved piece with no slot is still work in hand
        in_production: p.in_production + p.approved,
        pace: window === null
          ? 'met'
          : paceStatus(p.delivered, p.quota, window.dayOfMonth, window.daysInMonth),
      }))
      return {
        id, name, has_agreement: true, not_started: window === null,
        lines, last_post: lastPost, analytics: analyticsRows, tz,
      }
    })

    return NextResponse.json({
      month, year, month_key: monthKey, tz: PORTAL_TZ,
      is_current_month: isThisMonth,
      clients: buildMonthRows(inputs, monthKey),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}
