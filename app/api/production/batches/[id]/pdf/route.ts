import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { sanitisePlannedDeliverables, sanitiseShotList } from '../../../../../lib/batch-brief-core'
import { renderBriefPdf } from '../../../../../lib/brief-pdf'

export const maxDuration = 60

const STATUS_LABEL: Record<string, string> = {
  brief: 'In planning', locked: 'Date locked', shot: 'Shot', wrapped: 'Wrapped',
}

/** The shoot brief as a PDF hand-out — same read access as the brief page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const found = await table<Batch>('batches').get(id)
    if (!found) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    const batch = (await attachOne([found], 'client_id', 'clients', ['name']))[0]
    if (!(await canOpenBatch(user, batch))) {
      return NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 })
    }

    const pdf = await renderBriefPdf({
      title: batch.title,
      clientName: (batch.clients as { name: string } | null)?.name ?? 'Client',
      statusLabel: STATUS_LABEL[batch.status as string] ?? batch.status,
      shootDate: batch.shoot_date ?? null,
      location: batch.location ?? null,
      concept: batch.concept ?? null,
      deliverables: sanitisePlannedDeliverables(batch.planned_deliverables),
      shotList: sanitiseShotList(batch.shot_list),
    })

    const slug = String(batch.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shoot'
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="shoot-plan-${slug}.pdf"`,
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
