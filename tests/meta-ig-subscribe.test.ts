import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { subscribeAccount, WEBHOOK_FIELDS } from '../app/lib/meta-ig-client'

// 1 Oct 2026: the webhook was saved and verified in Meta, but no connected account was subscribed to it
describe('subscribing a connected account to the webhook', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('POSTs me/subscribed_apps with the fields, on the account token, and reads success', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const out = await subscribeAccount('TOKEN-x')
    expect(out).toEqual({ success: true })
    expect(calls).toHaveLength(1)
    const u = new URL(calls[0].url)
    expect(u.pathname).toMatch(/\/me\/subscribed_apps$/)
    expect(u.searchParams.get('access_token')).toBe('TOKEN-x')
    expect(calls[0].init?.method).toBe('POST')
    expect(String(calls[0].init?.body)).toContain(`subscribed_fields=${encodeURIComponent(WEBHOOK_FIELDS.join(','))}`)
    expect(WEBHOOK_FIELDS).toContain('comments')
    expect(WEBHOOK_FIELDS).toContain('messages')
  })
  it('connecting subscribes, and the manual route is gated', () => {
    expect(readFileSync('app/lib/meta-ig.ts', 'utf8')).toContain('await subscribeWebhooksFor(me.userId)')
    const mw = readFileSync('middleware.ts', 'utf8')
    expect(mw).toContain("'/api/meta/instagram/subscribe(.*)'")
    expect(readFileSync('app/api/meta/instagram/subscribe/route.ts', 'utf8')).toContain("await guard('super_admin')")
  })
})
