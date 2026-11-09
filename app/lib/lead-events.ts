import 'server-only'
import { createHash } from 'node:crypto'
import { table } from '@/lib/db'
import type { LeadEvent } from '@/lib/db-types'

/**
 * Write one line on a lead's timeline (lead-timeline-core.ts). `key` makes it idempotent: Calendly retries a webhook,
 * the same booking must not appear twice — claim() lets exactly one write win. Never throws: the timeline is a record,
 * never a reason for a booking or an enquiry to fail.
 */
export async function logLeadEvent(e: { leadId: string; kind: string; title: string; detail?: string | null; meta?: Record<string, unknown> | null; at?: string; key?: string }) {
  try {
    const at = e.at ?? new Date().toISOString()
    const id = createHash('sha256').update(e.key ?? `${e.leadId}|${e.kind}|${at}|${Math.random()}`).digest('hex').slice(0, 24)
    await table<LeadEvent>('lead_events').claim(id, cur => cur ?? {
      id, lead_id: e.leadId, at, kind: e.kind, title: e.title.slice(0, 300),
      detail: e.detail ? e.detail.slice(0, 2000) : null, meta: e.meta ?? null,
    })
  } catch (err) { console.error('lead event not logged', err) }
}
