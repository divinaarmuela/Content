import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { getPublisher } from '@/app/lib/publisher'

/**
 * INSTAGRAM'S AUDIO CATALOGUE, for the Reel being written.
 *
 * `GET ?accountId=…&q=summer&audioType=music|original`
 *   → `{ tracks: [{ audioId, title, audioType, durationMs, artist }] }`
 *   → or `{ tracks: [], needsFacebookLogin: true }`
 *
 * Two things it will not do:
 *
 *  1. IT WILL NOT INVENT A TRACK. An `audioId` is Meta's own; one made up
 *     locally is a Reel that fails at posting time, so the window offers what
 *     comes back here and nothing else.
 *  2. IT WILL NOT TURN "RECONNECT THIS ACCOUNT" INTO "NO RESULTS". Meta only
 *     serves the catalogue to accounts connected through Facebook Login, and
 *     an account connected the classic way gets a 400 with a code on it. That
 *     comes back as `needsFacebookLogin`, so the window says the one sentence
 *     that actually fixes it instead of showing an empty list.
 *
 * Gated exactly like the options route beside it: a scheduler or better, and
 * only for a client whose work is theirs to run.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const url = new URL(req.url)
      const accountId = url.searchParams.get('accountId')
      if (!accountId) return NextResponse.json({ error: 'Which channel?' }, { status: 400 })
      const audioType = url.searchParams.get('audioType') === 'original' ? 'original' : 'music'
      const q = url.searchParams.get('q')

      const account = await table<SocialAccount>('social_accounts').get(accountId)
      if (!account) {
        return NextResponse.json({ error: 'That channel is not connected any more' }, { status: 404 })
      }
      const allowed = await accessibleClientIds(user)
      if (allowed && !allowed.includes(String(account.client_id))) {
        return NextResponse.json({ error: 'That channel is not connected any more' }, { status: 404 })
      }
      if (String(account.platform ?? '') !== 'instagram') {
        return NextResponse.json({ tracks: [], needsFacebookLogin: false })
      }

      const found = await getPublisher()
        .searchInstagramAudio(String(account.provider_account_id || account.id), q, audioType)
        .catch(() => ({ tracks: [], needsFacebookLogin: false }))

      return NextResponse.json(found)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
