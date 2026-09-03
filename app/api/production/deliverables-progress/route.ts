import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachMany, attachOne } from '@/lib/db-join'
import type { Batch, ClientAgreement, ContentItem, MonthlyCommitment } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '../../../lib/authz'
import { visibleClientIds } from '../../../lib/production-access'
import {
  computeMonthlyProgress, effectiveQuotas, liveAtFromEntries, normaliseDeliverableLines,
} from '../../../lib/agreement-core'
import { isInternalKind } from '../../../lib/task-kind-core'
import { safeZone } from '../../../lib/timezone-core'

/**
 * "Are we hitting Releeph's 20 graphics this month?" — one number set,
 * computed the same way everywhere it shows (client overview, board strip,
 * brief captions). Month attribution: the shoot's month first, then the
 * item's due date, then its creation date.
 */

export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    const url = new URL(req.url)
    const clientId = url.searchParams.get('client_id') ?? ''
    const now = new Date()
    const month = Number(url.searchParams.get('month')) || now.getMonth() + 1
    const year = Number(url.searchParams.get('year')) || now.getFullYear()
    if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })

    // the shoot page draws this strip under every deliverable, so whoever
    // holds the shoot must be able to read it — visibleClientIds, not the
    // client-team list. Counts only; it opens nothing.
    const ids = await visibleClientIds(user)
    if (ids !== null && !ids.includes(clientId)) {
      return NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 })
    }

    const [agreement, commitment, itemRows, batches, client] = await Promise.all([
      table<ClientAgreement>('client_agreements')
        .list({ by: { client_id: clientId }, limit: 1 }).then(r => r[0] ?? null),
      table<MonthlyCommitment>('monthly_commitments')
        .list({ by: { client_id: clientId }, where: r => r.month === month && r.year === year, limit: 1 })
        .then(r => r[0] ?? null),
      table<ContentItem>('content_items').list({ by: { client_id: clientId }, limit: 1000 }),
      table<Batch>('batches').list({ by: { client_id: clientId }, limit: 200 }),
      // which month a published item lands in is decided on the CLIENT's
      // calendar: a post that went out at 11 pm on the 31st is that month's
      // delivery, whatever UTC calls it
      table('clients').get(clientId),
    ])
    const items = await attachMany(
      await attachOne(itemRows, 'work_kind_id', 'work_kinds', ['slug', 'uses_media']),
      'id', 'schedule_entries', 'item_id', ['published_at'],
    )
    const tz = safeZone((client?.timezone ?? null) as string | null)

    const lines = normaliseDeliverableLines(agreement?.deliverable_lines)
    const quotas = effectiveQuotas('lines' in lines ? lines.lines : [], (commitment as unknown as Record<string, unknown> | null))
    const batchesById = new Map(batches.map(b => [b.id as string, b]))
    // brief TASKS are the plan, not the delivery — they never count
    const producedItems = items
      .filter(i => ((i as { work_kinds?: { slug?: string } | null }).work_kinds?.slug ?? '') !== 'shoot_brief')
      // nor does a research/strategy task — the agreement is what gets posted
      .filter(i => !isInternalKind((i as { work_kinds?: { slug?: string; uses_media?: boolean } | null }).work_kinds))
      .map(i => ({ ...i, published_at: liveAtFromEntries((i as { schedule_entries?: { published_at?: string | null }[] | null }).schedule_entries) }))
    const per_type = computeMonthlyProgress(producedItems, batchesById, month, year, quotas, tz)

    return NextResponse.json({ month, year, per_type, has_agreement: Boolean(agreement) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
