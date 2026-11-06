import { NextRequest, NextResponse } from 'next/server'
import { connectPages, metaFbReady } from '@/app/lib/meta-fb'
import { verifyFbState } from '@/app/lib/meta-fb-core'
import { isMdAppState } from '@/app/lib/md-app-core'
import { mdAppCallback } from '@/app/lib/md-app-callback'

/**
 * GET /api/meta/facebook/callback — where Facebook sends the person back (6 Nov 2026). The redirect URI
 * registered with Meta: https://app.mdmmarketing.com.au/api/meta/facebook/callback.
 *
 * PUBLIC and Clerk-free on purpose (absent from middleware.ts's protected list and matcher). Its only
 * authority is the signed `state` the connect route issued. Then code → user token → long-lived user token →
 * the person's Pages, each stored for this client as a CANDIDATE (meta_fb_pages, token encrypted); back to the
 * client's Social page with `?meta_fb=`, where the person picks which Page is the client's (a single Page
 * offered is picked for them). No token is ever logged, put in a URL we build, or returned.
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
  // MD App (Unified Login, 6 Nov 2026) shares this registered redirect URI; its state carries its own prefix
  if (isMdAppState(req.nextUrl.searchParams.get('state'))) return mdAppCallback(req)
  const ready = metaFbReady()
  if (!ready.ok) return plain(ready.reason, 503)
  const q = req.nextUrl.searchParams
  const state = verifyFbState(q.get('state'), ready.env.appSecret, Date.now())
  if (!state.ok) {
    return plain(state.reason === 'expired'
      ? 'This Facebook connect link has expired. Go back to the client and press Connect again.'
      : 'This Facebook connect link is not valid. Go back to the client and press Connect again.', 400)
  }
  const { clientId, userId } = state.payload
  if (q.get('error')) return back(req, clientId, { meta_fb: 'denied' })
  const code = q.get('code')
  if (!code) return back(req, clientId, { meta_fb: 'error', reason: 'Facebook sent no code back' })
  try {
    const out = await connectPages(ready, { code, clientId, userId, now: Date.now() })
    if (out.offered + out.kept === 0) {
      return back(req, clientId, { meta_fb: 'error', reason: out.taken ? 'Those Pages are already connected to another client' : 'No Facebook Page was shared with the app' })
    }
    return back(req, clientId, { meta_fb: out.autoPicked || out.offered === 0 ? 'connected' : 'pick' })
  } catch (e) {
    const reason = (e instanceof Error ? e.message : 'failed').slice(0, 160)
    console.warn('[meta-fb] connect failed:', reason)
    return back(req, clientId, { meta_fb: 'error', reason })
  }
}
