import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE AUTOMATIONS ROUTES, with Zernio's fetch mocked (29 Sep 2026). What is pinned: a create sends
 * platformPostId OR postId to POST /v1/comment-automations and never neither; the browser only names a
 * post KEY and the server finds the post; schedulers look, account managers set up; a client that is
 * not yours is refused; a cancelled post's automations are switched off.
 */

let role = 'account_manager'
let allowedClients: string[] | null = null
const RANK: Record<string, number> = { client: 0, editor: 1, scheduler: 2, general: 3, account_manager: 4, super_admin: 5 }
class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('../app/lib/authz', () => ({
  requireRole: async (required: string) => {
    if (RANK[role] < RANK[required]) throw new AuthzError('Insufficient permissions', 403)
    return { id: 'u1', role, email: 'am@example.invalid', active_status: true }
  },
  roleSatisfies: (actual: string, required: string) => RANK[actual] >= RANK[required],
  authzErrorResponse: (e: unknown) => e instanceof AuthzError ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))
vi.mock('../app/lib/production-access', () => ({ accessibleClientIds: async () => allowedClients }))

type R = Record<string, unknown> & { id: string }
const db: Record<string, Map<string, R>> = {}
const tbl = (name: string) => (db[name] ??= new Map())
vi.mock('@/lib/db', () => ({
  withRequestCache: (f: () => unknown) => f(),
  table: (name: string) => ({
    get: async (id: string) => tbl(name).get(id) ?? null,
    list: async (q?: { where?: (r: R) => boolean }) => [...tbl(name).values()].filter(r => (q?.where ? q.where(r) : true)),
    insert: async (row: R) => { tbl(name).set(row.id, row); return row },
    update: async (id: string, patch: Partial<R>) => { const cur = tbl(name).get(id); if (!cur) return null; const n = { ...cur, ...patch }; tbl(name).set(id, n); return n },
    remove: async (id: string) => { tbl(name).delete(id) },
  }),
}))

vi.stubEnv('PUBLISH_DRY_RUN', '')
vi.stubEnv('ZERNIO_API_KEY', 'test-key')

type Call = { method: string; path: string; body: Record<string, unknown> | null }
const calls: Call[] = []
let createResponse: { status: number; body: unknown } = { status: 200, body: { success: true, automation: { id: 'za1' } } }
const ACCOUNT_POSTS = { status: 'success', posts: [
  { id: '18125559040862013', message: 'Live post\nsecond line', createdTime: '2026-09-29T06:19:12.000Z', picture: 'https://pic/1', permalink: 'https://www.instagram.com/p/LIVE/' },
  { id: '18000000000000002', message: 'Made on the phone', createdTime: '2026-09-20T06:19:12.000Z', picture: null, permalink: 'https://www.instagram.com/p/PHONE/' },
] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  const path = new URL(url).pathname.replace(/^\/api\/v1/, '')
  const method = init?.method ?? 'GET'
  calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
  if (method === 'GET' && path === '/accounts/zacc1/posts') return json(ACCOUNT_POSTS)
  if (method === 'POST' && path === '/comment-automations') return json(createResponse.body, createResponse.status)
  if (method === 'GET' && path === '/comment-automations') return json({ success: true, automations: [
    { id: 'za1', accountId: 'zacc1', platform: 'instagram', platformPostId: '18125559040862013', keywords: ['BOOK'], isActive: true, trigger: 'comment', stats: { triggered: 2, dmsSent: 2 } },
    { id: 'zwide', name: 'Old one', accountId: 'zacc1', platform: 'instagram', keywords: ['LINK'], isActive: true, trigger: 'comment', stats: {} },
  ] })
  if (method === 'GET' && path.startsWith('/comment-automations/')) {
    const id = path.split('/')[2]
    if (id === 'zwide') return json({ success: true, automation: { id: 'zwide', accountId: 'zacc1', keywords: ['LINK'], isActive: true, trigger: 'comment' } })
    return json({ success: true, automation: { id, accountId: 'zacc1', platformPostId: '181', isActive: true, stats: { triggered: 2, dmsSent: 2, linkClicks: 1 } },
      logs: [{ id: 'l1', commenterName: 'akmal.ashwin', commentText: 'BOOK', status: 'sent', createdAt: '2026-09-29T09:00:14Z' }] })
  }
  if (method === 'PATCH' || method === 'DELETE') return json({ success: true })
  return json({ error: 'not found' }, 404)
}))

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const list = await import('../app/api/social/automations/route')
const one = await import('../app/api/social/automations/[id]/route')
const setup = await import('../app/api/social/automations/setup/route')
const { pauseAutomationsForPost } = await import('../app/lib/comment-automation')

const post = (body: unknown) => new Request('http://x/api/social/automations', { method: 'POST', body: JSON.stringify(body) })
const ZERNIO_BOOKED = '6abb5843c8ba30684174d977'

beforeEach(() => {
  role = 'account_manager'
  allowedClients = null
  calls.length = 0
  createResponse = { status: 200, body: { success: true, automation: { id: 'za1' } } }
  for (const k of Object.keys(db)) delete db[k]
  tbl('clients').set('c1', { id: 'c1', name: 'Justin Engelke', slug: 'justin-engelke', social_profile_id: 'prof1' })
  tbl('clients').set('c2', { id: 'c2', name: 'No profile', slug: 'no-profile', social_profile_id: null })
  tbl('social_accounts').set('s1', { id: 's1', client_id: 'c1', platform: 'instagram', provider_account_id: 'zacc1', username: 'justin', active: true })
  tbl('social_accounts').set('s2', { id: 's2', client_id: 'c2', platform: 'instagram', provider_account_id: 'zacc2', username: 'np', active: true })
  tbl('social_posts').set('pb', { id: 'pb', client_id: 'c1', stage: 'booked', caption: 'Booked post', channels: ['s1'], slides: [], scheduled_for: '2026-10-02T09:00:00Z', booking: { job_ids: ['j1'], pending: false, at: 'x', for_time: null }, outcomes: {} })
  tbl('social_posts').set('pp', { id: 'pp', client_id: 'c1', stage: 'posted', caption: 'Live post', channels: ['s1'], slides: [], booking: { job_ids: ['j2'], pending: false, at: 'x', for_time: null }, outcomes: { instagram: { status: 'published', url: 'https://www.instagram.com/p/LIVE/', at: '2026-09-29T06:19:20Z' } } })
  tbl('publish_jobs').set('j1', { id: 'j1', status: 'scheduled', provider_post_id: ZERNIO_BOOKED, targets: [{ platform: 'instagram' }] })
  tbl('publish_jobs').set('j2', { id: 'j2', status: 'published', provider_post_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', targets: [{ platform: 'instagram' }] })
})

const created = () => calls.filter(c => c.method === 'POST' && c.path === '/comment-automations')

describe('create', () => {
  it('a live post: platformPostId alone, UTM-tagged link on a tracked button, a row recorded', async () => {
    const res = await list.POST(post({
      client_id: 'c1', social_account_id: 's1', post_key: 'app:pp', dm_message: 'Hi!', button_title: 'Book a call', link: 'https://book.example.com/x?a=1',
    }))
    expect(res.status).toBe(201)
    const [c] = created()
    expect(c.body).toMatchObject({
      profileId: 'prof1', accountId: 'zacc1', trigger: 'comment', platformPostId: '18125559040862013', keywords: ['BOOK'], matchMode: 'word',
      buttons: [{ type: 'url', title: 'Book a call', url: 'https://book.example.com/x?a=1&utm_source=mdmedia&utm_medium=instagram_dm&utm_campaign=justin_engelke&utm_content=book' }],
      linkTracking: true,
    })
    expect(c.body).not.toHaveProperty('postId')
    const rows = [...tbl('comment_automations').values()]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ client_id: 'c1', social_post_id: 'pp', platform_post_id: '18125559040862013', zernio_automation_id: 'za1', created_by: 'u1', active: true })
  })

  it('a booked post: postId (the Zernio post id) alone', async () => {
    const res = await list.POST(post({ client_id: 'c1', social_account_id: 's1', post_key: 'app:pb', dm_message: 'Hi!', link: 'https://x.co' }))
    expect(res.status).toBe(201)
    const [c] = created()
    expect(c.body!.postId).toBe(ZERNIO_BOOKED)
    expect(c.body).not.toHaveProperty('platformPostId')
    // no button: the tagged link rides in the DM text
    expect(c.body!.dmMessage).toBe('Hi!\n\nhttps://x.co?utm_source=mdmedia&utm_medium=instagram_dm&utm_campaign=justin_engelke&utm_content=book')
    expect(c.body).not.toHaveProperty('buttons')
  })

  it('a post on the account not made here: platformPostId from Zernio\'s own list', async () => {
    const res = await list.POST(post({ client_id: 'c1', social_account_id: 's1', post_key: 'ig:18000000000000002', dm_message: 'Hi!' }))
    expect(res.status).toBe(201)
    expect(created()[0].body!.platformPostId).toBe('18000000000000002')
  })

  it('never sends a create with neither binding: no post, or a post not on this account, is refused before Zernio', async () => {
    expect((await list.POST(post({ client_id: 'c1', social_account_id: 's1', dm_message: 'Hi!' }))).status).toBe(400)
    expect((await list.POST(post({ client_id: 'c1', social_account_id: 's1', post_key: 'ig:999', dm_message: 'Hi!' }))).status).toBe(400)
    // a made-up platform id cannot be smuggled in: only a key is read
    expect((await list.POST(post({ client_id: 'c1', social_account_id: 's1', post_key: '', platformPostId: '181', dm_message: 'Hi!' }))).status).toBe(400)
    expect(created()).toHaveLength(0)
    for (const c of calls.filter(x => x.method === 'POST')) {
      expect(Boolean(c.body?.platformPostId) !== Boolean(c.body?.postId)).toBe(true)
    }
  })

  it('refuses a client with no Zernio profile, an account of another client, and a client that is not yours', async () => {
    const noProfile = await list.POST(post({ client_id: 'c2', social_account_id: 's2', post_key: 'ig:1', dm_message: 'Hi' }))
    expect(noProfile.status).toBe(400)
    expect((await noProfile.json()).error).toMatch(/no Zernio profile/)
    expect((await list.POST(post({ client_id: 'c1', social_account_id: 's2', post_key: 'ig:1', dm_message: 'Hi' }))).status).toBe(400)
    allowedClients = ['c2']
    expect((await list.POST(post({ client_id: 'c1', social_account_id: 's1', post_key: 'app:pp', dm_message: 'Hi' }))).status).toBe(403)
    expect(created()).toHaveLength(0)
  })

  it('is an account manager\'s: a scheduler is refused', async () => {
    role = 'scheduler'
    expect((await list.POST(post({ client_id: 'c1', social_account_id: 's1', post_key: 'app:pp', dm_message: 'Hi' }))).status).toBe(403)
    expect((await setup.GET(new Request('http://x/api/social/automations/setup'))).status).toBe(403)
    expect(created()).toHaveLength(0)
  })

  it('passes on Zernio\'s refusal and records nothing', async () => {
    createResponse = { status: 400, body: { error: 'An active automation already exists for this post' } }
    const res = await list.POST(post({ client_id: 'c1', social_account_id: 's1', post_key: 'app:pp', dm_message: 'Hi' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/already exists/)
    expect(tbl('comment_automations').size).toBe(0)
  })
})

describe('setup lists', () => {
  it('clients with a reason when they cannot have one, and the account\'s posts with the app\'s first', async () => {
    const res = await setup.GET(new Request('http://x/api/social/automations/setup'))
    const { clients } = await res.json()
    expect(clients.map((c: { id: string; problem: string | null }) => [c.id, c.problem === null])).toEqual([['c1', true], ['c2', false]])
    const res2 = await setup.GET(new Request('http://x/api/social/automations/setup?client_id=c1&account_id=s1'))
    const { posts } = await res2.json()
    expect(posts.map((p: { key: string }) => p.key)).toEqual(['app:pb', 'app:pp', 'ig:18000000000000002'])
  })
})

describe('list, switch, delete', () => {
  const seed = () => tbl('comment_automations').set('r1', {
    id: 'r1', client_id: 'c1', social_account_id: 's1', provider_account_id: 'zacc1', platform: 'instagram', zernio_automation_id: 'za1',
    social_post_id: 'pp', platform_post_id: '181', zernio_post_id: null, post_title: 'Live post', post_thumb: null, post_date: null,
    name: 'n', keywords: ['BOOK'], match_mode: 'word', dm_message: 'Hi', button_title: null, link: 'https://x.co?utm_source=mdmedia',
    comment_reply: null, active: true, paused_reason: null, created_by: 'u1', created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z',
  })

  it('a scheduler may look: rows with stats and log rows, and the account-wide one flagged', async () => {
    seed()
    role = 'scheduler'
    const res = await list.GET(new Request('http://x/api/social/automations'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.can_manage).toBe(false)
    expect(body.rows[0]).toMatchObject({ id: 'r1', client_name: 'Justin Engelke', active: true, stats: { triggered: 2, dmsSent: 2, linkClicks: 1 } })
    expect(body.rows[0].logs[0]).toMatchObject({ username: 'akmal.ashwin', comment: 'BOOK', status: 'sent' })
    expect(body.outside).toEqual([expect.objectContaining({ id: 'zwide', account_wide: true })])
  })

  it('switches off at Zernio and here; a scheduler cannot', async () => {
    seed()
    role = 'scheduler'
    expect((await one.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ active: false }) }), { params: Promise.resolve({ id: 'r1' }) })).status).toBe(403)
    role = 'account_manager'
    const res = await one.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ active: false }) }), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(200)
    expect(calls.find(c => c.method === 'PATCH')).toMatchObject({ path: '/comment-automations/za1', body: { isActive: false } })
    expect(tbl('comment_automations').get('r1')!.active).toBe(false)
  })

  it('never switches an account-wide automation ON from here', async () => {
    const res = await one.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ active: true }) }), { params: Promise.resolve({ id: 'z:zwide' }) })
    expect(res.status).toBe(400)
    expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(0)
    const off = await one.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ active: false }) }), { params: Promise.resolve({ id: 'z:zwide' }) })
    expect(off.status).toBe(200)
  })

  it('deletes at Zernio and here', async () => {
    seed()
    const res = await one.DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id: 'r1' }) })
    expect(res.status).toBe(200)
    expect(calls.find(c => c.method === 'DELETE')!.path).toBe('/comment-automations/za1')
    expect(tbl('comment_automations').has('r1')).toBe(false)
  })

  it('a cancelled post: its automations are switched off, with the reason', async () => {
    seed()
    await pauseAutomationsForPost('pp')
    expect(calls.find(c => c.method === 'PATCH')).toMatchObject({ path: '/comment-automations/za1', body: { isActive: false } })
    expect(tbl('comment_automations').get('r1')).toMatchObject({ active: false, paused_reason: 'The post was cancelled' })
  })
})
