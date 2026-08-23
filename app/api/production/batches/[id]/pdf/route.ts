import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { batchClientIds } from '../../../../../lib/production-access'
import { sanitisePlannedDeliverables, sanitiseShotList } from '../../../../../lib/batch-brief-core'
import { renderBriefPdf } from '../../../../../lib/brief-pdf'

export const maxDuration = 60

const STATUS_LABEL: Record<string, string> = {
  brief: 'In planning', locked: 'Date locked', shot: 'Shot', wrapped: 'Wrapped',
}

/** The shoot brief as a PDF hand-out — same read access as the brief page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const { data: batch } = await supabase
      .from('batches')
      .select('*, clients(name)')
      .eq('id', id)
      .maybeSingle()
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    const ids = await batchClientIds(user)
    if (ids !== null && !ids.includes(batch.client_id)) {
      return NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 })
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
        'Content-Disposition': `attachment; filename="shoot-brief-${slug}.pdf"`,
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
