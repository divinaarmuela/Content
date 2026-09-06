import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { instagramShortcode } from '../../lib/link-preview-core'
import {
  actorInput, cacheDecision, fromActorItem, VIDEO_TTL_MS,
  type InstagramVideoRow, type VideoAnswer,
} from '../../lib/instagram-video-core'

/**
 * The video behind an Instagram link, for a card somebody is looking at.
 *
 * POST { url, token?, force? } → { video, poster, caption, author, duration }
 * or { video: null, reason }. `token` is the client's portal share token,
 * so the client's board plays too; without it the caller must be a team
 * member. The answer is cached per post for VIDEO_TTL_MS (the CDN URL is
 * signed and expires), one run per post at a time (claim), and a post that
 * keeps failing is left alone for a day. No token → the feature is simply
 * absent: `reason: 'off'`, and the card shows its picture as before.
 *
 * The owner's rule: nothing here names the service to a browser.
 */

const ACTOR = 'apify~instagram-scraper'
const RUN_TIMEOUT_S = 55
const HTTP_TIMEOUT_MS = 60_000

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const body = await req.json().catch(() => ({})) as { url?: unknown; token?: unknown; force?: unknown }
      const url = typeof body.url === 'string' ? body.url : ''
      const code = instagramShortcode(url)
      if (!code) return NextResponse.json({ error: 'Not an Instagram post link' }, { status: 400 })

      // who is asking: a client with a valid portal link, or a team member
      if (typeof body.token === 'string' && body.token) {
        const token = body.token.split('--').pop() ?? body.token
        if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
        const client = (await table<Client>('clients').list({ where: c => c.share_token === token, limit: 1 }))[0]
        if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
      } else {
        await requireRole('editor')
      }

      const apiToken = process.env.APIFY_TOKEN
      if (!apiToken) return NextResponse.json({ video: null, reason: 'off' } satisfies VideoAnswer)

      const videos = table<InstagramVideoRow>('instagram_videos')
      const now = Date.now()
      const cached = await videos.get(code, { fresh: true })
      const decision = cacheDecision(cached, now, body.force === true)
      if (decision === 'serve' && cached?.video) return NextResponse.json(answerOf(cached))
      if (decision === 'backoff') return NextResponse.json({ video: null, reason: 'unavailable' } satisfies VideoAnswer)

      // one run per post at a time: whoever claims the row does the asking;
      // anyone else waits a moment and reads what they wrote
      const stamp = new Date(now).toISOString()
      const seat = await videos.claim(code, current => {
        if (current && Date.parse(current.fetched_at) > now - 60_000 && current.last_error === 'running') return null
        return {
          id: code,
          video: current?.video ?? null, poster: current?.poster ?? null, caption: current?.caption ?? null,
          author: current?.author ?? null, duration: current?.duration ?? null,
          expires_at: current?.expires_at ?? null,
          fetched_at: stamp, fail_count: current?.fail_count ?? 0, last_error: 'running',
        }
      })
      if (!seat.claimed) {
        await new Promise(r => setTimeout(r, 4000))
        const again = await videos.get(code, { fresh: true })
        if (again?.video && again.last_error !== 'running' && cacheDecision(again, Date.now()) === 'serve') {
          return NextResponse.json(answerOf(again))
        }
        return NextResponse.json({ video: null, reason: 'unavailable' } satisfies VideoAnswer)
      }

      const prevFails = seat.row.fail_count
      const postUrl = `https://www.instagram.com/p/${code}/`
      const result = await runActor(apiToken, postUrl)
      if (result.ok) {
        const row: InstagramVideoRow = {
          id: code, ...result.value,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + VIDEO_TTL_MS).toISOString(),
          fail_count: 0, last_error: null,
        }
        await videos.upsert(row)
        return NextResponse.json(answerOf(row))
      }
      await videos.upsert({
        id: code, video: null, poster: null, caption: null, author: null, duration: null, expires_at: null,
        fetched_at: new Date().toISOString(), fail_count: prevFails + 1, last_error: result.error,
      })
      return NextResponse.json({ video: null, reason: result.error === 'not_video' ? 'not_video' : 'unavailable' } satisfies VideoAnswer)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

function answerOf(row: InstagramVideoRow): VideoAnswer {
  return { video: row.video as string, poster: row.poster, caption: row.caption, author: row.author, duration: row.duration }
}

async function runActor(apiToken: string, postUrl: string): Promise<
  { ok: true; value: NonNullable<ReturnType<typeof fromActorItem>> } | { ok: false; error: string }
> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS)
  try {
    const endpoint = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_S}`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify(actorInput(postUrl)),
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    const items = await res.json().catch(() => null)
    if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'empty' }
    const value = fromActorItem(items[0])
    if (!value) return { ok: false, error: 'not_video' }
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_failed' }
  } finally {
    clearTimeout(timer)
  }
}
