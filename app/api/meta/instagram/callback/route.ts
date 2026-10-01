import { NextRequest, NextResponse } from 'next/server'
import { connectAccount, metaIgReady } from '@/app/lib/meta-ig'
import { verifyState } from '@/app/lib/meta-ig-core'

/**
 * GET /api/meta/instagram/callback — where Instagram sends the person back
 * (1 Oct 2026, branch meta-instagram-login).
 *
 * PUBLIC and Clerk-free on purpose: it is the redirect URI registered with
 * Meta, and it is absent from middleware.ts's protected list and matcher. Its
 * only authority is the signed `state` (client, person, expiry) the connect
 * route issued. Then: code → short-lived token → long-lived token → /me →
 * one `meta_ig_accounts` row keyed by the Instagram id, and back to the
 * client's Social page with `?meta_ig=` saying how it went. No token is ever
 * logged, put in a URL we build, or returned.
 */
export const dynamic = 'force-dynamic'

const plain = (body: string, status: number) =>
  new NextResponse(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

const back = (req: NextRequest, clientId: string, result: Record<string, string>) => {
  const u = new URL(`/dashboard/clients/${encodeURIComponent(clientId)}/social`, req.url)
  for (const [k, v] of Object.entries(result)) u.searchParams.set(k, v)
  return NextResponse.redirect(u, 302)
}

export async function GET(req: NextRequest) {
  const ready = metaIgReady()
  if (!ready.ok) return plain(ready.reason, 503)

  const q = req.nextUrl.searchParams
  const state = verifyState(q.get('state'), ready.env.appSecret, Date.now())
  if (!state.ok) {
    return plain(state.reason === 'expired'
      ? 'This Instagram connect link has expired. Go back to the client and press Connect again.'
      : 'This Instagram connect link is not valid. Go back to the client and press Connect again.', 400)
  }
  const { clientId, userId } = state.payload

  // the person said no on Instagram's screen
  if (q.get('error')) return back(req, clientId, { meta_ig: 'denied' })
  const code = q.get('code')
  if (!code) return back(req, clientId, { meta_ig: 'error', reason: 'Instagram sent no code back' })

  try {
    const row = await connectAccount(ready, { code, clientId, userId, now: Date.now() })
    return back(req, clientId, { meta_ig: 'connected', username: row.username ?? '' })
  } catch (e) {
    // the message is Meta's error text (token-free by construction), kept short for the URL
    const reason = (e instanceof Error ? e.message : 'failed').slice(0, 160)
    console.warn('[meta-ig] connect failed:', reason)
    return back(req, clientId, { meta_ig: 'error', reason })
  }
}
