import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  CONNECTABLE, connectLinkPath, isConnectable, isShareToken, networkState, parseNetworks,
} from '../app/lib/connect-link-core'
import { connectReturnPath } from '../app/lib/social-connect'

/**
 * THE CLIENT'S OWN CONNECT LINK (the owner, 9 Sep 2026): "on Social channels
 * create a universal link that I can send to clients … we will pick which
 * platforms we want them to login from, like a checkbox … and then they can
 * sign in from there … make sure it works."
 */

const connectCalls: { platform: string; redirectUrl: string }[] = []
vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({
    configured: () => true,
    createProfile: async () => 'prof-1',
    connectUrl: async ({ platform, redirectUrl }: { platform: string; redirectUrl: string }) => {
      connectCalls.push({ platform, redirectUrl })
      return `https://network.example/oauth/${platform}`
    },
    listAccounts: async () => [
      { providerAccountId: 'acc-fb', platform: 'facebook', username: 'acme.page', name: 'Acme', avatarUrl: null },
    ],
    // after a reconnect the provider says the token works again
    accountsHealth: async () => ({ accounts: [{ accountId: 'acc-fb', platform: 'facebook', status: 'healthy', canPost: true, tokenValid: true, needsReconnect: false }] }),
  }),
}))
vi.mock('../app/lib/mailer', () => ({ notify: vi.fn(async () => {}), renderEmail: () => '', escapeHtml: (s: string) => s }))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))

const TOKEN = '11111111-2222-4333-8444-555555555555'
let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null; connectCalls.length = 0 })

const client = (): Row => ({
  id: 'c1', name: 'Acme', share_token: TOKEN, social_profile_id: null, status: 'active',
}) as unknown as Row

const json = async (p: Promise<Response>) => { const r = await p; return { status: r.status, body: await r.json() } }
const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('the link itself — pure', () => {
  it('carries the ticked networks, and none means all', () => {
    expect(connectLinkPath(TOKEN, ['facebook', 'instagram'])).toBe(`/connect/${TOKEN}?networks=instagram,facebook`)
    expect(connectLinkPath(TOKEN, [...CONNECTABLE])).toBe(`/connect/${TOKEN}`)
    expect(parseNetworks('facebook, instagram,nonsense')).toEqual(['instagram', 'facebook'])
    expect(parseNetworks('')).toEqual([...CONNECTABLE])
    expect(parseNetworks(null)).toEqual([...CONNECTABLE])
  })

  it('knows a token and a network when it sees one', () => {
    expect(isShareToken(TOKEN)).toBe(true)
    expect(isShareToken('../etc')).toBe(false)
    expect(isConnectable('tiktok')).toBe(true)
    expect(isConnectable('myspace')).toBe(false)
  })

  it('says who is connected on a network, in the client’s words', () => {
    const have = [{ platform: 'facebook', username: 'acme.page' }]
    expect(networkState(have, 'facebook')).toEqual({ connected: true, who: 'acme.page', reconnect: false, soon: false, reason: null })
    expect(networkState(have, 'tiktok')).toEqual({ connected: false })
  })

  it('the network sends the client back to THEIR link, never to an address somebody else chose', () => {
    expect(connectReturnPath({ path: `/connect/${TOKEN}?networks=facebook` }, 'c1', 'facebook'))
      .toBe(`/connect/${TOKEN}?networks=facebook&connected=facebook&clientId=c1`)
    expect(connectReturnPath({ path: '//evil.example/x' }, 'c1', 'facebook')).toMatch(/^\/\?connected=facebook/)
    expect(connectReturnPath({ path: 'https://evil.example' }, 'c1', 'facebook')).toMatch(/^\/\?connected=facebook/)
  })
})

describe('the token-authed API', () => {
  it('a bad token opens nothing', async () => {
    fake = seedDb({ clients: [client()] })
    const route = await import('../app/api/connect/[token]/route')
    expect((await json(route.GET(new Request('https://x.test'), params('nope')))).status).toBe(404)
    expect((await json(route.GET(new Request('https://x.test'), params('99999999-2222-4333-8444-555555555555')))).status).toBe(404)
  })

  it('a good token names the client and what is connected — and nothing more', async () => {
    fake = seedDb({
      clients: [client()],
      social_accounts: [{ id: 'a1', client_id: 'c1', platform: 'instagram', username: 'acme', name: null, active: true, provider_account_id: 'secret' } as unknown as Row],
    })
    const route = await import('../app/api/connect/[token]/route')
    const res = await json(route.GET(new Request('https://x.test'), params(TOKEN)))
    expect(res.status).toBe(200)
    expect(res.body.client).toBe('Acme')
    expect(res.body.connected).toEqual([{ platform: 'instagram', username: 'acme', name: null, reconnect: false, soon: false, reason: null }])
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  it('a press starts that network’s sign-in, returning to the link with its ticks', async () => {
    fake = seedDb({ clients: [client()] })
    const route = await import('../app/api/connect/[token]/route')
    const res = await json(route.POST(new Request('https://x.test', {
      method: 'POST', body: JSON.stringify({ platform: 'facebook', networks: 'facebook,tiktok' }),
    }), params(TOKEN)))
    expect(res.status).toBe(200)
    expect(res.body.authUrl).toBe('https://network.example/oauth/facebook')
    // the ticks come back in the bar's drawing order (Facebook before TikTok),
    // whatever order the press sent them in
    expect(connectCalls[0].redirectUrl).toContain(`/connect/${TOKEN}?networks=facebook,tiktok&connected=facebook&clientId=c1`)
    // …and the client now has a provider profile of their own
    expect(fake.rows('clients')[0]).toMatchObject({ social_profile_id: 'prof-1' })
  })

  it('refuses a network the manager did not tick, and one that does not exist', async () => {
    fake = seedDb({ clients: [client()] })
    const route = await import('../app/api/connect/[token]/route')
    const off = await json(route.POST(new Request('https://x.test', {
      method: 'POST', body: JSON.stringify({ platform: 'tiktok', networks: 'facebook' }),
    }), params(TOKEN)))
    expect(off.status).toBe(400)
    expect(connectCalls).toHaveLength(0)
    const bad = await json(route.POST(new Request('https://x.test', {
      method: 'POST', body: JSON.stringify({ platform: 'myspace' }),
    }), params(TOKEN)))
    expect(bad.status).toBe(400)
  })

  it('back from the network, the re-read lands the account under the client', async () => {
    fake = seedDb({ clients: [{ ...client(), social_profile_id: 'prof-1' } as Row] })
    const route = await import('../app/api/connect/[token]/route')
    const res = await json(route.PUT(new Request('https://x.test', { method: 'PUT' }), params(TOKEN)))
    expect(res.status).toBe(200)
    expect(res.body.synced).toBe(1)
    expect(res.body.connected).toEqual([{ platform: 'facebook', username: 'acme.page', name: 'Acme', reconnect: false, soon: false, reason: 'Connected' }])
  })
})

describe('the same link reconnects (the owner: "what if the connection is getting lost")', () => {
  it('an account the morning check called expired is offered as Reconnect — and is clean again after the re-read', async () => {
    fake = seedDb({
      clients: [{ ...client(), social_profile_id: 'prof-1' } as Row],
      social_accounts: [{
        id: 'a1', client_id: 'c1', platform: 'facebook', username: 'acme.page', name: 'Acme', active: true,
        provider_account_id: 'acc-fb',
        health: { level: 'act', can_post: false, expires_at: null, checked_at: '2026-09-09T07:00:00.000Z', reason: 'Its connection has expired' },
      } as unknown as Row],
    })
    const route = await import('../app/api/connect/[token]/route')
    const before = await json(route.GET(new Request('https://x.test'), params(TOKEN)))
    expect(before.body.connected[0]).toMatchObject({ platform: 'facebook', reconnect: true })
    expect(networkState(before.body.connected, 'facebook')).toMatchObject({ connected: true, reconnect: true })

    // the client signs in again and comes back: the re-read asks the provider now
    const after = await json(route.PUT(new Request('https://x.test', { method: 'PUT' }), params(TOKEN)))
    expect(after.body.connected[0]).toMatchObject({ platform: 'facebook', reconnect: false })
    expect((fake.rows('social_accounts')[0] as any).health.level).toBe('ok')
  })
})

describe('the words for a sign-in that did not finish', () => {
  it('say nothing was changed, and what to press', async () => {
    const { returnErrorWords } = await import('../app/lib/connect-link-core')
    expect(returnErrorWords('access_denied', 'Facebook')).toMatch(/cancelled and nothing was connected/)
    expect(returnErrorWords('server_error', 'TikTok')).toMatch(/did not finish connecting and nothing was changed/)
    expect(returnErrorWords('', 'TikTok')).toBeNull()
    expect(returnErrorWords(null, 'TikTok')).toBeNull()
  })

  it('a connection that runs out soon is said, and offered a Reconnect, before a post is refused', async () => {
    const { networkState } = await import('../app/lib/connect-link-core')
    const have = [{ platform: 'tiktok', username: 'acme', soon: true, reason: 'Its connection runs out in 6 days — reconnect it before then.' }]
    expect(networkState(have, 'tiktok')).toMatchObject({ connected: true, reconnect: false, soon: true, reason: expect.stringContaining('6 days') })
  })
})
