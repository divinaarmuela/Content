import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'

/** Upsert a platform schedule entry (scheduler+). unique(item_id, platform)
 *  means concurrent upserts for the same platform collapse to one row. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json()
    if (!body.platform) return NextResponse.json({ error: 'platform is required' }, { status: 400 })

    const patch: Record<string, unknown> = {
      item_id: id,
      platform: String(body.platform).toLowerCase(),
      scheduler_id: user.id,
    }
    if ('scheduled_at' in body) patch.scheduled_at = body.scheduled_at
    if ('tool_url' in body) patch.tool_url = body.tool_url
    if ('live_url' in body) {
      patch.live_url = body.live_url
      if (body.live_url) {
        patch.publish_status = 'published'
        patch.published_at = new Date().toISOString()
      }
    }

    const { data, error } = await supabase
      .from('schedule_entries')
      .upsert(patch, { onConflict: 'item_id,platform' })
      .select()
      .single()
    if (error) throw new Error(error.message)

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: body.live_url ? 'live_link_added' : 'schedule_set',
      detail: `${patch.platform}${body.scheduled_at ? ` @ ${body.scheduled_at}` : ''}`,
    })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
