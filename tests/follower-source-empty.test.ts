import { describe, expect, it } from 'vitest'
import { hikerSource } from '../app/lib/follower-source'
/* ── HikerAPI says 404 for "no comments" (8 Sep 2026) ────────────────── */

describe('hikerSource — an empty answer is not a failure', () => {
  it('turns a 404 on the comments and likers calls into an empty page', async () => {
    const seen: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url)
      seen.push(u)
      if (u.includes('/v1/media/comments/chunk') || u.includes('/v1/media/likers')) {
        return new Response('{"detail":"Entries not found","exc_type":"NotFoundError"}', { status: 404 })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    try {
      const src = hikerSource('k')
      expect(await src.commenters('1_2', null)).toEqual({ ok: true, value: { people: [], next: null } })
      expect(await src.likers('1_2')).toEqual({ ok: true, value: [] })
      // …but a post the provider does not know at all is still a failure
      expect(await src.mediaId('https://www.instagram.com/p/x/')).toEqual({ ok: false, error: 'http_404' })
    } finally {
      globalThis.fetch = realFetch
    }
    expect(seen).toHaveLength(3)
  })
})
