import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { loadSection } from '@/app/lib/channel-insights'
import { sectionsFor, type SectionKey } from '@/app/lib/channel-insights-core'

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/**
 * ONE TAB OF A CHANNEL'S DEEP ANALYTICS (2 Nov 2026). `GET ?account=<social_accounts id>&section=<tab>&from&to` —
 * Instagram's account, followers, audience, Stories, tagged posts; TikTok's account; Facebook's Page and audience;
 * LinkedIn's page or profile and its followers' make-up. Read only.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const url = new URL(req.url)
      const accountId = url.searchParams.get('account')
      const section = url.searchParams.get('section') as SectionKey | null
      const from = day(url.searchParams.get('from')), to = day(url.searchParams.get('to'))
      if (!accountId || !section || !from || !to) return NextResponse.json({ error: 'Pick a channel, a tab and the days' }, { status: 400 })
      const account = await table<SocialAccount>('social_accounts').get(accountId)
      if (!account) return NextResponse.json({ error: 'That channel is not connected' }, { status: 404 })
      if (!sectionsFor(account.platform).some(s => s.key === section)) {
        return NextResponse.json({ error: 'This channel has no such tab' }, { status: 400 })
      }
      return NextResponse.json(await loadSection(account, section, { from, to }))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
