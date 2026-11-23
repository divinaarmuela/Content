import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MAX_DAYS, MAX_ROWS, findClient, pickSchedule, publishedPost, readRange, schedulePost, sortPublished, stageWord, totalsByClient,
} from '../app/lib/mcp-core'

/**
 * THE CONNECTOR FOR CLAUDE AND CHATGPT (the owner, 23 Nov 2026: "create one for claude and chatgpt … we can ask
 * questions about the posts"). Pinned: what a question may ask for, what an answer holds, that it reads and never
 * writes, and that it is asked for a sign-in and a role before it says anything.
 */

describe('the days a question covers', () => {
  it('two real days, in order, no more than a quarter apart', () => {
    expect(readRange('2026-11-01', '2026-11-23')).toEqual({ ok: true, from: '2026-11-01', to: '2026-11-23' })
    expect(readRange('2026-11-23', '2026-11-23').ok).toBe(true)
    expect(readRange('1 Nov', '2026-11-23').ok).toBe(false)
    expect(readRange('2026-11-23', '2026-11-01').ok).toBe(false)
    expect(readRange('2026-01-01', '2026-11-23')).toMatchObject({ ok: false, reason: `That is more than ${MAX_DAYS} days. Ask for a shorter stretch.` })
    expect(readRange(undefined, null).ok).toBe(false)
  })
})

describe('which client', () => {
  const clients = [{ id: 'c1', name: 'Basfoods' }, { id: 'c2', name: 'Stretchworks' }, { id: 'c3', name: 'TMS Logistics' }, { id: 'c4', name: 'TMS Freight' }]
  it('by id, by its name in any case, or by the one name that holds the words', () => {
    expect(findClient(clients, 'c2')).toMatchObject({ ok: true, client: { name: 'Stretchworks' } })
    expect(findClient(clients, 'basfoods')).toMatchObject({ ok: true, client: { id: 'c1' } })
    expect(findClient(clients, 'stretch')).toMatchObject({ ok: true, client: { id: 'c2' } })
  })
  it('asks which when more than one matches, and says so when none does: it never guesses', () => {
    expect(findClient(clients, 'tms')).toMatchObject({ ok: false, reason: 'More than one client matches: TMS Logistics, TMS Freight. Say which.' })
    expect(findClient(clients, 'Nobody')).toMatchObject({ ok: false })
    expect(findClient(clients, '  ')).toMatchObject({ ok: false, reason: 'Say which client.' })
  })
})

describe('the schedule', () => {
  const rows = [
    { id: 'a', client_id: 'c1', stage: 'booked', scheduled_for: '2026-11-24T22:00:00.000Z', caption: 'Specials', channels: ['ig', 'fb'], slides: [{ type: 'image' }, { type: 'video' }] },
    { id: 'b', client_id: 'c2', stage: 'draft', scheduled_for: '2026-11-25T01:00:00.000Z', caption: 'Stretch', channels: ['ig'], slides: [] },
    { id: 'c', client_id: 'c1', stage: 'draft', scheduled_for: null },
    { id: 'd', client_id: 'c1', stage: 'posted', scheduled_for: '2026-10-01T01:00:00.000Z' },
  ]
  const span = { fromMs: Date.parse('2026-11-24T00:00:00Z'), toMs: Date.parse('2026-11-26T00:00:00Z') }
  it('the posts inside the days, soonest first; one with no time is not on it', () => {
    expect(pickSchedule(rows, span).map(r => r.id)).toEqual(['a', 'b'])
    expect(pickSchedule(rows, { ...span, clientId: 'c2' }).map(r => r.id)).toEqual(['b'])
    expect(pickSchedule(rows, { ...span, stage: 'booked' }).map(r => r.id)).toEqual(['a'])
  })
  it('is capped', () => {
    const many = Array.from({ length: MAX_ROWS + 20 }, (_, i) => ({ id: `p${i}`, client_id: 'c1', stage: 'booked', scheduled_for: '2026-11-24T22:00:00.000Z' }))
    expect(pickSchedule(many, span)).toHaveLength(MAX_ROWS)
  })
  it('a post is said in the page\'s own words, with its networks and counts, and no file address', () => {
    const out = schedulePost(rows[0], 'Basfoods', id => ({ ig: 'instagram', fb: 'facebook' } as Record<string, string>)[id] ?? null)
    expect(out).toEqual({
      id: 'a', client: 'Basfoods', stage: 'Booked in', goes_out: '2026-11-24T22:00:00.000Z', time_zone: 'Australia/Melbourne',
      networks: ['instagram', 'facebook'], files: 2, videos: 1, caption: 'Specials',
    })
    expect(JSON.stringify(out)).not.toMatch(/https?:/)
    expect(stageWord('with_client')).toBe('With the client')
  })
})

describe('published posts and their numbers', () => {
  const post = (over: Record<string, unknown>) => ({
    id: 'x', content: 'Caption', publishedAt: '2026-11-20T01:00:00Z', platform: 'instagram', accountId: 'acc', url: 'https://www.instagram.com/p/x/',
    thumbnail: 'https://cdn/thumb.jpg', mediaType: 'carousel', engagementRate: null, updatedAt: '2026-11-23T04:00:00Z',
    metrics: { views: 100, impressions: 100, reach: 80, likes: 5, comments: 2, shares: 1, saves: 3, clicks: 0 }, ...over,
  }) as never
  it('engagement is likes, comments, shares and saves; the picture\'s address is left out', () => {
    const r = publishedPost(post({}), 'Basfoods')
    expect(r).toMatchObject({ client: 'Basfoods', network: 'instagram', views: 100, reach: 80, engagement: 11, link: 'https://www.instagram.com/p/x/' })
    expect(JSON.stringify(r)).not.toContain('thumb.jpg')
  })
  it('sorted by what was asked, and totalled per client', () => {
    const rows = [
      publishedPost(post({ metrics: { views: 10, impressions: 0, reach: 9, likes: 9, comments: 0, shares: 0, saves: 0, clicks: 0 }, publishedAt: '2026-11-22T00:00:00Z' }), 'A'),
      publishedPost(post({}), 'B'),
      publishedPost(post({ metrics: { views: 50, impressions: 0, reach: 40, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 }, publishedAt: '2026-11-21T00:00:00Z' }), 'A'),
    ]
    expect(sortPublished(rows, 'views').map(r => r.views)).toEqual([100, 50, 10])
    expect(sortPublished(rows, 'likes')[0].likes).toBe(9)
    expect(sortPublished(rows, 'newest')[0].published).toBe('2026-11-22T00:00:00Z')
    expect(totalsByClient(rows)).toEqual([
      { client: 'B', posts: 1, views: 100, reach: 80, engagement: 11 },
      { client: 'A', posts: 2, views: 60, reach: 49, engagement: 9 },
    ])
  })
})

describe('wired through (source pins)', () => {
  const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const route = read('app/mcp/route.ts')
  it('every request needs a sign-in, checked against this address', () => {
    expect(route).toContain('const authHandler = withClerkMcpAuth(handler, mcpAuthOptions)')
    expect(route).toContain('export { authHandler as GET, authHandler as POST, authHandler as DELETE }')
    expect(read('app/lib/mcp-options.ts')).toContain("process.env.MCP_RESOURCE_URL || 'https://app.mdmmarketing.com.au/mcp'")
  })
  it('every tool asks who is there first, and only a scheduler and above is answered', () => {
    const tools = route.match(/server\.registerTool\(/g) ?? []
    expect(tools).toHaveLength(5)
    expect(route.match(/const me = await who\(ctx\)/g)).toHaveLength(tools.length)
    expect(route).toContain("roleSatisfies(row.role as never, 'scheduler' as never)")
    expect(route).toContain('if (!row.active_status)')
  })
  it('it reads and never writes, and the bearer token is never returned', () => {
    expect(route).not.toMatch(/\.(insert|update|upsert|claim|remove|delete|set)\(/)
    expect(route).not.toMatch(/inngest|performPostTransition|actOnPost|getPublisher/)
    expect(route).not.toContain('authInfo.token')
  })
  it('the sign-in server can be found by a connector, and the routes are not behind the dashboard\'s login wall', () => {
    expect(read('app/.well-known/oauth-protected-resource/mcp/route.ts')).toContain('protectedResourceMetadataHandler(mcpAuthOptions)')
    expect(read('app/.well-known/oauth-authorization-server/route.ts')).toContain('authorizationServerMetadataHandler()')
    const mw = read('middleware.ts')
    expect(mw).not.toContain("'/mcp")
    expect(mw).not.toContain("'/.well-known")
  })
})
