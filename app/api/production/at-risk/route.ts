import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'
import {
  agreementMonthWindow, computeMonthlyProgress, effectiveQuotas, liveAtFromEntries, normaliseDeliverableLines, paceStatus,
  type PaceStatus,
} from '../../../lib/agreement-core'

/**
 * The cross-client "are we meeting the month" rollup. For every client the
 * caller can see, compare this month's delivered work against the agreement,
 * and flag the ones falling behind pace. One screen instead of checking each
 * client's page. Managers only — it spans clients.
 */
export async function GET(req: Request) {
  try {
    const user = await requireRole('account_manager')
    const now = new Date()
    const url = new URL(req.url)
    const month = Number(url.searchParams.get('month')) || now.getMonth() + 1
    const year = Number(url.searchParams.get('year')) || now.getFullYear()
    const dayOfMonth = (month === now.getMonth() + 1 && year === now.getFullYear()) ? now.getDate() : 28
    const daysInMonth = new Date(year, month, 0).getDate()

    const ids = await accessibleClientIds(user)
    let clientsQ = supabase.from('clients').select('id, name').eq('status', 'active').order('name')
    if (ids !== null) clientsQ = clientsQ.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    const { data: clients } = await clientsQ
    const clientIds = (clients ?? []).map(c => c.id)
    if (clientIds.length === 0) return NextResponse.json({ month, year, clients: [] })

    // bulk-fetch everything once, then group in memory (no N+1)
    const [{ data: agreements }, { data: commitments }, { data: items }, { data: batches }] = await Promise.all([
      supabase.from('client_agreements').select('client_id, deliverable_lines, start_date').in('client_id', clientIds),
      supabase.from('monthly_commitments').select('*').in('client_id', clientIds).eq('month', month).eq('year', year),
      supabase.from('content_items')
        .select('client_id, batch_id, content_type, status, due_date, created_at, work_kinds(slug), schedule_entries(published_at)')
        .in('client_id', clientIds).limit(4000),
      supabase.from('batches').select('id, client_id, month, year').in('client_id', clientIds).limit(1000),
    ])

    const agByClient = new Map((agreements ?? []).map(a => [a.client_id as string, a]))
    const cmByClient = new Map((commitments ?? []).map(c => [c.client_id as string, c]))
    const itemsByClient = new Map<string, typeof items>()
    for (const it of items ?? []) {
      const arr = itemsByClient.get(it.client_id as string) ?? []
      arr.push(it); itemsByClient.set(it.client_id as string, arr)
    }
    const batchesById = new Map((batches ?? []).map(b => [b.id as string, b]))

    const RANK: Record<PaceStatus, number> = { behind: 0, tight: 1, on_track: 2, met: 3 }
    const out = (clients ?? []).map(client => {
      const linesRes = normaliseDeliverableLines(agByClient.get(client.id)?.deliverable_lines)
      const lines = 'lines' in linesRes ? linesRes.lines : []
      const quotas = effectiveQuotas(lines, cmByClient.get(client.id) ?? null)
      if (quotas.length === 0) {
        return { id: client.id, name: client.name, has_agreement: false, worst: 'met' as PaceStatus, lines: [] }
      }
      // pacing runs on the agreement's own clock: signed mid-month, the
      // client is measured over the days the deal was live; not started
      // yet, they owe nothing and never show as at risk
      const window = agreementMonthWindow(
        (agByClient.get(client.id) as { start_date?: string | null } | undefined)?.start_date,
        month, year, { day: dayOfMonth, daysInMonth },
      )
      if (window === null) {
        return { id: client.id, name: client.name, has_agreement: true, not_started: true, worst: 'met' as PaceStatus, lines: [] }
      }
      const clientItems = (itemsByClient.get(client.id) ?? [])
        .filter(i => ((i as { work_kinds?: { slug?: string } | null }).work_kinds?.slug ?? '') !== 'shoot_brief')
        .map(i => ({ ...i, published_at: liveAtFromEntries((i as { schedule_entries?: { published_at?: string | null }[] | null }).schedule_entries) }))
      const progress = computeMonthlyProgress(clientItems, batchesById, month, year, quotas)
      const withPace = progress.map(p => ({
        type: p.type, label: p.label, quota: p.quota, delivered: p.delivered, planned: p.planned,
        pace: paceStatus(p.delivered, p.quota, window.dayOfMonth, window.daysInMonth),
      }))
      const worst = withPace.reduce<PaceStatus>((w, p) => (RANK[p.pace] < RANK[w] ? p.pace : w), 'met')
      return { id: client.id, name: client.name, has_agreement: true, worst, lines: withPace }
    })
    // most at-risk first
    out.sort((a, b) => RANK[a.worst] - RANK[b.worst])
    return NextResponse.json({ month, year, day_of_month: dayOfMonth, days_in_month: daysInMonth, clients: out })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
