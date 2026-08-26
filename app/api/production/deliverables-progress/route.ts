import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'
import {
  computeMonthlyProgress, effectiveQuotas, liveAtFromEntries, normaliseDeliverableLines,
} from '../../../lib/agreement-core'
import { isInternalKind } from '../../../lib/task-kind-core'

/**
 * "Are we hitting Releeph's 20 graphics this month?" — one number set,
 * computed the same way everywhere it shows (client overview, board strip,
 * brief captions). Month attribution: the shoot's month first, then the
 * item's due date, then its creation date.
 */

export async function GET(req: Request) {
  try {
    const user = await requireSignedIn()
    const url = new URL(req.url)
    const clientId = url.searchParams.get('client_id') ?? ''
    const now = new Date()
    const month = Number(url.searchParams.get('month')) || now.getMonth() + 1
    const year = Number(url.searchParams.get('year')) || now.getFullYear()
    if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })

    const ids = await accessibleClientIds(user)
    if (ids !== null && !ids.includes(clientId)) {
      return NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 })
    }

    const [{ data: agreement }, { data: commitment }, { data: items }, { data: batches }] = await Promise.all([
      supabase.from('client_agreements').select('deliverable_lines').eq('client_id', clientId).maybeSingle(),
      supabase.from('monthly_commitments').select('*')
        .eq('client_id', clientId).eq('month', month).eq('year', year).maybeSingle(),
      supabase.from('content_items')
        .select('id, batch_id, content_type, status, due_date, created_at, work_kinds(slug, uses_media), schedule_entries(published_at)')
        .eq('client_id', clientId).limit(1000),
      supabase.from('batches').select('id, month, year').eq('client_id', clientId).limit(200),
    ])

    const lines = normaliseDeliverableLines(agreement?.deliverable_lines)
    const quotas = effectiveQuotas('lines' in lines ? lines.lines : [], commitment ?? null)
    const batchesById = new Map((batches ?? []).map(b => [b.id as string, b]))
    // brief TASKS are the plan, not the delivery — they never count
    const producedItems = (items ?? [])
      .filter(i => ((i as { work_kinds?: { slug?: string } | null }).work_kinds?.slug ?? '') !== 'shoot_brief')
      // nor does a research/strategy task — the agreement is what gets posted
      .filter(i => !isInternalKind((i as { work_kinds?: { slug?: string; uses_media?: boolean } | null }).work_kinds))
      .map(i => ({ ...i, published_at: liveAtFromEntries((i as { schedule_entries?: { published_at?: string | null }[] | null }).schedule_entries) }))
    const per_type = computeMonthlyProgress(producedItems, batchesById, month, year, quotas)

    return NextResponse.json({ month, year, per_type, has_agreement: Boolean(agreement) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
