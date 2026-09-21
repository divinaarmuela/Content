import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { LinktreeConnection, LinktreeState } from '@/lib/db-types'
import { requireRole } from '../../../../lib/authz'
import { decryptSecret } from '../../../../lib/secret-box'
import { DASHBOARD_URL } from '../../../../lib/app-url'
import { profilesFrom } from '../../../../lib/linktree-core'
import { exchangeLinktreeCode, tokenFields, withLinktree } from '../../../../lib/linktree'

/**
 * BACK FROM LINKTREE'S SIGN-IN (21 Sep 2026). The state is claimed — used
 * once, by one request — then the code is exchanged, the tokens are kept
 * encrypted on the client's connection, and the profile is set when the
 * person can reach exactly one; otherwise Social channels asks which.
 */
export const dynamic = 'force-dynamic'

const back = (words: string, ok: boolean) =>
  NextResponse.redirect(`${DASHBOARD_URL}/dashboard/social?linktree=${ok ? 'connected' : 'failed'}&say=${encodeURIComponent(words)}`)

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const url = new URL(req.url)
      const state = url.searchParams.get('state') ?? ''
      const code = url.searchParams.get('code') ?? ''
      if (url.searchParams.get('error')) return back(url.searchParams.get('error_description') ?? 'Linktree sign-in was cancelled', false)
      if (!state || !code) return back('Linktree came back without a code', false)

      const now = new Date().toISOString()
      const claimed = await table<LinktreeState>('linktree_states').claim(state, ((cur: LinktreeState | null): unknown => {
        const row = cur as (LinktreeState & { used_at?: string | null; user_id?: string | null }) | null
        if (!row || row.used_at || row.user_id !== user.id) return null
        return { ...row, used_at: now }
      }) as (c: LinktreeState | null) => LinktreeState | null)
      if (!claimed.claimed) return back('That sign-in link was already used, or is not yours — press Connect again', false)
      const st = claimed.row as LinktreeState & { client_id: string; verifier_enc: string }
      // ten minutes is the life of a sign-in; an older one is abandoned
      if (Date.now() - Date.parse(String(st.created_at)) > 10 * 60_000) return back('That sign-in took too long — press Connect again', false)

      const tokens = await exchangeLinktreeCode(code, decryptSecret(st.verifier_enc))
      let profiles: ReturnType<typeof profilesFrom> = []
      try {
        profiles = await withLinktree(tokens.access_token, async call => profilesFrom(await call('list_accessible_profiles', { allPages: true })))
      } catch (e) {
        console.error('[linktree] listing profiles after sign-in failed:', e)
      }
      const only = profiles.length === 1 ? profiles[0] : null
      await table<LinktreeConnection>('linktree_connections').upsert({
        id: st.client_id, client_id: st.client_id,
        ...tokenFields(tokens, Date.now()),
        profile_username: only?.username ?? null,
        profile_url: only?.profileUrl ?? null,
        profile_name: only?.displayName ?? null,
        connected_by: user.id, connected_at: now, updated_at: now, last_error: null,
      } as never)
      await table<LinktreeState>('linktree_states').remove(state).catch(() => null)
      return back(only ? `Linktree connected — ${only.username}` : 'Linktree connected — pick the profile for this client', true)
    } catch (e) {
      console.error('[linktree] callback failed:', e)
      return back(e instanceof Error ? e.message.slice(0, 160) : 'Linktree could not be connected', false)
    }
  })
}
