import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { getPublisher } from '../../../lib/publisher'
import { SUPPORTED_PLATFORMS } from '../../../lib/publish-core'

/** Connected accounts, optionally for one client, plus whether publishing is
 *  configured at all — so the UI can explain rather than fail silently. */
export async function GET(req: Request) {
  try {
    await requireRole('editor')
    const clientId = new URL(req.url).searchParams.get('clientId')

    let q = supabase
      .from('social_accounts')
      .select('id, client_id, platform, provider_account_id, name, username, avatar_url, active, connected_at')
      .order('platform', { ascending: true })
    if (clientId) q = q.eq('client_id', clientId)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({
      accounts: data ?? [],
      platforms: SUPPORTED_PLATFORMS,
      provider: {
        name: getPublisher().name,
        configured: getPublisher().configured(),
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Disconnect locally: stop targeting an account without revoking OAuth. */
export async function DELETE(req: Request) {
  try {
    await requireRole('account_manager')
    const { id } = await req.json()
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    const { error } = await supabase.from('social_accounts').update({ active: false }).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
