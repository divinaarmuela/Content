import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, authzErrorResponse } from '../../../lib/authz'

export const dynamic = 'force-dynamic'

/** The signed-in person's own notification history — the same rows the
 *  email outbox wrote, so the page can never disagree with the inbox. */
export async function GET() {
  try {
    const user = await requireSignedIn()
    const { data, error } = await supabase
      .from('notification_log')
      .select('id, event_type, subject, status, entity_type, entity_id, created_at')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    return NextResponse.json({ notifications: data ?? [] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
