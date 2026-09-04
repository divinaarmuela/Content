import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { getPublisher, NO_CHANNEL_OPTIONS } from '@/app/lib/publisher'
import { TIKTOK_PRIVACY_LABELS, TIKTOK_PRIVACY_LEVELS } from '@/app/lib/publish-core'

/**
 * The lists the composer's per-network options need — one connected account
 * at a time.
 *
 * `GET ?accountId=…` → `{ playlists, organizations, pages, privacy }`
 *
 * Every one of these is a list only the network can give us: a YouTube
 * playlist id, a LinkedIn company page, a Facebook Page, the privacy levels
 * TikTok allows THIS creator. None of them can be invented locally — an
 * invented id is a post the platform refuses hours after anybody was watching
 * — so the window offers what comes back here and nothing else.
 *
 * Gated exactly like the rest of Schedule: a scheduler or better, and only
 * for a client whose work is theirs to run. A missing or unavailable upstream
 * endpoint is an EMPTY list, never an error: the composer still opens, and a
 * post with no playlist on it is still a post.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const accountId = new URL(req.url).searchParams.get('accountId')
      if (!accountId) return NextResponse.json({ error: 'Which channel?' }, { status: 400 })

      const account = await table<SocialAccount>('social_accounts').get(accountId)
      if (!account) {
        return NextResponse.json({ error: 'That channel is not connected any more' }, { status: 404 })
      }
      // the same scoping the schedule page itself runs on: null means this
      // person is scoped by status rather than by client (scheduler, super
      // admin), which is the answer the production board acts on too
      const allowed = await accessibleClientIds(user)
      if (allowed && !allowed.includes(String(account.client_id))) {
        return NextResponse.json({ error: 'That channel is not connected any more' }, { status: 404 })
      }

      const platform = String(account.platform ?? '')
      const options = await getPublisher()
        .channelOptions(String(account.provider_account_id || account.id), platform)
        .catch(() => ({ ...NO_CHANNEL_OPTIONS }))

      // TikTok always has SOMETHING to choose between: when the creator's own
      // allowed list cannot be read, the four documented levels are offered
      // rather than an empty menu that reads as "you may not choose".
      const privacy = options.privacy.length > 0
        ? options.privacy
        : platform === 'tiktok'
          ? TIKTOK_PRIVACY_LEVELS.map(value => ({ value, label: TIKTOK_PRIVACY_LABELS[value] }))
          : []

      return NextResponse.json({ ...options, privacy })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
