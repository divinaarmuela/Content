import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sanitisePlannedDeliverables, sanitiseShotList } from '../../../lib/batch-brief-core'
import { renderBriefPdf } from '../../../lib/brief-pdf'

const STATUS_LABEL: Record<string, string> = {
  brief: 'In planning', locked: 'Shoot booked', shot: 'Shot', wrapped: 'Wrapped',
}

/** The same brief PDF the team downloads, for a client with a valid portal
 *  token — only for a shoot the AM explicitly shared. Public, token-gated,
 *  same trust model as every other /api/portal route. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const rawToken = url.searchParams.get('token') ?? ''
    const id = url.searchParams.get('id') ?? ''
    const token = decodeURIComponent(rawToken).split('--').pop() ?? rawToken
    if (!/^[0-9a-f-]{36}$/i.test(token) || !id) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    }
    const { data: client } = await supabase.from('clients').select('id, name').eq('share_token', token).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })

    const { data: batch } = await supabase
      .from('batches')
      .select('title, status, shoot_date, location, concept, planned_deliverables, shot_list, shared_with_client')
      .eq('id', id).eq('client_id', client.id)
      .maybeSingle()
    if (!batch || !batch.shared_with_client) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const pdf = await renderBriefPdf({
      title: batch.title,
      clientName: client.name,
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
    console.error('portal shoot pdf error:', e)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
