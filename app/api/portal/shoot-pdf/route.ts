import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, Batch } from '@/lib/db-types'
import { sanitisePlannedDeliverables, sanitiseShotList } from '../../../lib/batch-brief-core'
import { sanitiseScripts } from '../../../lib/script-core'
import { renderBriefPdf } from '../../../lib/brief-pdf'
import { shootStatusLabel } from '../../../lib/portal-words'
import { clientByPortalToken } from '../../../lib/portal-owner'



/** The same brief PDF the team downloads, for a client with a valid portal
 *  token — only for a shoot the AM explicitly shared. Public, token-gated,
 *  same trust model as every other /api/portal route. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const url = new URL(req.url)
    const rawToken = url.searchParams.get('token') ?? ''
    const id = url.searchParams.get('id') ?? ''
    const token = decodeURIComponent(rawToken).split('--').pop() ?? rawToken
    if (!/^[0-9a-f-]{36}$/i.test(token) || !id) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    }
    const client = await clientByPortalToken(token)
    if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })

    const found = await table<Batch>('batches').get(id)
    const batch = found && found.client_id === client.id ? found : null
    if (!batch || !batch.shared_with_client) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const pdf = await renderBriefPdf({
      title: batch.title,
      clientName: client.name,
      statusLabel: shootStatusLabel(batch.status as string),
      shootDate: batch.shoot_date ?? null,
      location: batch.location ?? null,
      // never the team's notes on the client's copy
      concept: null,
      deliverables: sanitisePlannedDeliverables(batch.planned_deliverables),
      shotList: sanitiseShotList(batch.shot_list),
      callTime: batch.call_time ?? null,
      objective: batch.objective ?? null,
      script: batch.script ?? null,
      scripts: sanitiseScripts(batch.scripts),
      talent: batch.talent ?? null,
      propsWardrobe: batch.props_wardrobe ?? null,
      clientAvailability: batch.client_availability ?? null,
      audience: 'client',
    })
    const slug = String(batch.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shoot'
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="shoot-plan-${slug}.pdf"`,
      },
    })
  } catch (e) {
    console.error('portal shoot pdf error:', e)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
  })
}
