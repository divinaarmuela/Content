import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount, Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { getPublisher } from '../../../lib/publisher'
import { SUPPORTED_PLATFORMS } from '../../../lib/publish-core'

/** The columns every account list has returned; the row carries no more. */
const accountShape = (r: SocialAccount) => ({
  id: r.id, client_id: r.client_id, platform: r.platform,
  provider_account_id: r.provider_account_id, name: r.name,
  username: r.username, avatar_url: r.avatar_url, active: r.active,
  connected_at: r.connected_at,
})

/** Connected accounts, optionally for one client, plus whether publishing is
 *  configured at all — so the UI can explain rather than fail silently. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const clientId = new URL(req.url).searchParams.get('clientId')

    const rows = await table<SocialAccount>('social_accounts').list({
      where: clientId ? a => a.client_id === clientId : undefined,
      orderBy: [['platform', 'asc']],
    })
    const data = rows.map(accountShape)

    // Token health is opt-in: it is one upstream call per account, and the
    // common case (rendering a list) does not need it. Failures collapse to
    // null so a slow or unavailable provider never blanks the page.
    // `expiresIn` is the provider's own word on the token — "Auto-refreshes"
    // for a platform that renews itself. Dropping it left the list page with
    // only a date, which is how two accounts connected minutes earlier ended
    // up under "needs reconnecting".
    let health: Record<string, {
      valid: boolean; expiresAt: string | null; expiresIn: string | null; needsRefresh: boolean
    }> = {}
    if (new URL(req.url).searchParams.get('health') === '1' && data.length > 0) {
      const publisher = getPublisher()
      const results = await Promise.all(
        data.map(async row => {
          const h = await publisher.accountHealth(row.provider_account_id as string) as {
            tokenStatus?: {
              valid?: boolean; expiresAt?: string; expiresIn?: string; needsRefresh?: boolean
            }
          } | null
          return [row.id as string, h?.tokenStatus
            ? {
                valid: Boolean(h.tokenStatus.valid),
                expiresAt: h.tokenStatus.expiresAt ?? null,
                expiresIn: h.tokenStatus.expiresIn ?? null,
                needsRefresh: Boolean(h.tokenStatus.needsRefresh),
              }
            : null] as const
        })
      )
      health = Object.fromEntries(results.filter(([, v]) => v !== null) as [string, NonNullable<typeof results[number][1]>][])
    }

    // Whether this client has ever connected. The UI uses it to decide if an
    // empty channel list is worth reconciling upstream — a client that never
    // had a profile cannot have accounts waiting for us.
    let hasProfile: boolean | null = null
    if (clientId) {
      const c = await table<Client>('clients').get(clientId)
      hasProfile = Boolean(c?.social_profile_id)
    }

    return NextResponse.json({
      accounts: data,
      hasProfile,
      health,
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
  })
}

/** Disconnect an account.
 *
 *  This revokes it at the provider as well as locally — a local-only flag
 *  would leave the client's account still authorised, which is not what
 *  "disconnect" means to anyone reading the button. The provider call comes
 *  first: if it fails we keep the local row, so the two never disagree in the
 *  direction that matters (us thinking it is gone when it is not). */
export async function DELETE(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('account_manager')
    const { id } = await req.json()
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const accounts = table<SocialAccount>('social_accounts')
    const row = await accounts.get(id)
    if (!row) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    await getPublisher().disconnectAccount(row.provider_account_id)

    await accounts.remove(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
