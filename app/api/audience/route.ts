import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

/**
 * Gated (middleware) — the audience lists for the dashboard: newsletter
 * subscribers and The Room invite requests. One route, both lists; they are
 * small and always shown together on the Audience page.
 */

export async function GET() {
  const [newsletter, invites] = await Promise.all([
    supabase
      .from('newsletter_subscribers')
      .select('id, email, source, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('room_invite_requests')
      .select('id, name, email, about, created_at')
      .order('created_at', { ascending: false }),
  ])

  if (newsletter.error || invites.error) {
    console.error('audience fetch error:', newsletter.error ?? invites.error)
    return NextResponse.json({ error: 'Could not load audience' }, { status: 502 })
  }

  return NextResponse.json({ newsletter: newsletter.data, invites: invites.data })
}

const TABLES = {
  newsletter: 'newsletter_subscribers',
  invites: 'room_invite_requests',
} as const

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') as keyof typeof TABLES | null
  const id = searchParams.get('id')

  if (!type || !(type in TABLES) || !id) {
    return NextResponse.json({ error: 'Missing type or id' }, { status: 400 })
  }

  const { error } = await supabase.from(TABLES[type]).delete().eq('id', id)
  if (error) {
    console.error('audience delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 502 })
  }
  return NextResponse.json({ success: true })
}
