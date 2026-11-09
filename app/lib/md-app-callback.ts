import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { connectClient, mdAppReady } from './md-app'
import { connectAds } from './md-app-ads'
import { verifyMdAppState } from './md-app-core'

/**
 * MD App's half of the shared callback /api/meta/facebook/callback (6 Nov 2026). PUBLIC and Clerk-free: its only
 * authority is the signed, MD-App-prefixed `state`. Code → BISU token (stored encrypted) → assigned accounts
 * stored for a super admin to pick → back to the client's Social page with `?md_app=`. No token is logged,
 * returned or put in a URL we build.
 */

const plain = (body: string, status: number) =>
  new NextResponse(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

const back = (req: NextRequest, clientId: string, result: Record<string, string>) => {
  const u = new URL(`/dashboard/clients/${encodeURIComponent(clientId)}/social`, req.url)
  for (const [k, v] of Object.entries(result)) u.searchParams.set(k, v)
  return NextResponse.redirect(u, 302)
}

export async function mdAppCallback(req: NextRequest): Promise<NextResponse> {
  const ready = mdAppReady()
  if (!ready.ok) return plain(ready.reason, 503)
  const q = req.nextUrl.searchParams
  const state = verifyMdAppState(q.get('state'), ready.env.appSecret, Date.now())
  if (!state.ok) {
    return plain(state.reason === 'expired'
      ? 'This connect link has expired. Go back to the client and press Connect again.'
      : 'This connect link is not valid. Go back to the client and press Connect again.', 400)
  }
  const { clientId, userId } = state.payload
  if (q.get('error')) return back(req, clientId, { md_app: 'denied' })
  const code = q.get('code')
  if (!code) return back(req, clientId, { md_app: 'error', reason: 'Meta sent no code back' })
  // the ads connect (a user token, md-app-ads.ts — 9 Nov 2026)
  if (state.payload.kind === 'ads') {
    try {
      const out = await connectAds(ready, { code, clientId, userId, now: Date.now() })
      return back(req, clientId, out.missing.length ? { md_ads: 'missing', reason: out.missing.join(', ') } : { md_app: 'connected' })
    } catch (e) {
      const reason = (e instanceof Error ? e.message : 'failed').slice(0, 160)
      console.warn('[md-app] ads connect failed:', reason)
      return back(req, clientId, { md_ads: 'error', reason })
    }
  }
  try {
    const out = await connectClient(ready, { code, clientId, userId, now: Date.now() })
    return back(req, clientId, { md_app: out.assets ? 'connected' : 'empty' })
  } catch (e) {
    const reason = (e instanceof Error ? e.message : 'failed').slice(0, 160)
    console.warn('[md-app] connect failed:', reason)
    return back(req, clientId, { md_app: 'error', reason })
  }
}
