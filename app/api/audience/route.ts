import { NextRequest, NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { NewsletterSubscriber, RoomInviteRequest } from '@/lib/db-types'

/**
 * Gated (middleware) — the audience lists for the dashboard: newsletter
 * subscribers and The Room invite requests. One route, both lists; they are
 * small and always shown together on the Audience page.
 */

export async function GET() {
  return withRequestCache(async () => {
  try {
    const [newsletter, invites] = await Promise.all([
      table<NewsletterSubscriber>('newsletter_subscribers').list({ orderBy: [['created_at', 'desc']] }),
      table<RoomInviteRequest>('room_invite_requests').list({ orderBy: [['created_at', 'desc']] }),
    ])
    return NextResponse.json({ newsletter, invites })
  } catch (e) {
    console.error('audience fetch error:', e)
    return NextResponse.json({ error: 'Could not load audience' }, { status: 502 })
  }
  })
}

const TABLES = {
  newsletter: 'newsletter_subscribers',
  invites: 'room_invite_requests',
} as const

export async function DELETE(req: NextRequest) {
  return withRequestCache(async () => {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') as keyof typeof TABLES | null
  const id = searchParams.get('id')

  if (!type || !(type in TABLES) || !id) {
    return NextResponse.json({ error: 'Missing type or id' }, { status: 400 })
  }

  try {
    await table(TABLES[type]).remove(id)
  } catch (e) {
    console.error('audience delete error:', e)
    return NextResponse.json({ error: 'Delete failed' }, { status: 502 })
  }
  return NextResponse.json({ success: true })
  })
}
