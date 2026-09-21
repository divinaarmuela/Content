import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { LinktreeState } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { accessibleClientIds } from '../../../../lib/production-access'
import { encryptSecret } from '../../../../lib/secret-box'
import { linktreeAuthorizeUrl } from '../../../../lib/linktree-core'
import { linktreeAuthMeta, linktreeClientId, linktreeRedirectUri, newPkce } from '../../../../lib/linktree'

/**
 * CONNECT A CLIENT'S LINKTREE (21 Sep 2026). A manager presses Connect on
 * Social channels and is sent to Linktree's own sign-in. The state and the
 * PKCE verifier wait in `linktree_states`, used exactly once by the callback.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const clientId = new URL(req.url).searchParams.get('clientId') ?? ''
      const allowed = await accessibleClientIds(user)
      if (!clientId || (allowed !== null && !allowed.includes(clientId))) {
        return NextResponse.json({ error: 'That client is not yours to connect' }, { status: 403 })
      }
      const meta = await linktreeAuthMeta()
      const pkce = newPkce()
      await table<LinktreeState>('linktree_states').insert({
        id: pkce.state, client_id: clientId, user_id: user.id, verifier_enc: encryptSecret(pkce.verifier),
        used_at: null, created_at: new Date().toISOString(),
      } as never)
      return NextResponse.redirect(linktreeAuthorizeUrl({
        authorizationEndpoint: meta.authorization_endpoint, clientId: linktreeClientId(),
        redirectUri: linktreeRedirectUri(), state: pkce.state, codeChallenge: pkce.challenge,
      }))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
