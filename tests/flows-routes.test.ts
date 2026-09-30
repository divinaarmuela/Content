import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE FLOW BUILDER'S ROUTES, with Zernio's fetch mocked (30 Sep 2026). What is pinned:
 * schedulers look and account managers save; a client that is not yours is refused;
 * a create goes to POST /v1/workflows with the profile, account and platform from OUR
 * rows (never the browser's) and no status; one draft key makes one workflow; a flow
 * that is ON is never changed; a DM-keyword start is refused as the owner's call; a
 * Zernio step cannot be slipped in; and NO request ever reaches /activate, /pause,
 * a DELETE or a run start — whatever the browser sends.
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
    claim: async (id: string, mutate: (cur: R | null) => R | null) => {
      const cur = tbl(name).get(id) ?? null
      const next = mutate(cur)
      if (!next) return { claimed: false, current: cur }
      tbl(name).set(id, next)
      return { claimed: true, row: next }
    },
  }),
}))

vi.stubEnv('PUBLISH_DRY_RUN', '')
vi.stubEnv('ZERNIO_API_KEY', 'test-key')

type Call = { method: string; path: string; body: Record<string, unknown> | null }
const calls: Call[] = []
const allCalls: Call[] = []
let created = 0
const zernioFlows: Record<string, Record<string, unknown>> = {}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  const u = new URL(url)
  const path = u.pathname.replace(/^\/api\/v1/, '')
  const method = init?.method ?? 'GET'
  const call = { method, path: path + u.search, body: init?.body ? JSON.parse(String(init.body)) : null }
  calls.push(call); allCalls.push(call)
  if (method === 'GET' && path === '/workflows') return json({ workflows: Object.values(zernioFlows) })
  if (method === 'POST' && path === '/workflows') {
    const id = `wfnew${++created}`
    zernioFlows[id] = { _id: id, status: 'draft', ...call.body }
    return json({ workflow: zernioFlows[id] }, 200)
  }
  if (method === 'GET' && /^\/workflows\/[^/]+\/executions$/.test(path)) return json({ success: true, executions: [
    { id: 'r1', status: 'completed', stepCount: 3 }, { id: 'r2', status: 'waiting', currentNodeId: 'm' }, { id: 'rbad', status: 'failed' },
  ], pagination: { total: 40 } })
  const ev = path.match(/^\/workflows\/[^/]+\/executions\/([^/]+)\/events$/)
  if (method === 'GET' && ev) {
    if (ev[1] === 'rbad') return json({ error: 'gone' }, 404)
    return json({ success: true, events: [
      { action: 'node_completed', nodeId: 't' }, { action: 'node_started', nodeId: 'm' },
      ...(ev[1] === 'r1' ? [{ action: 'node_completed', nodeId: 'm' }] : []),
    ] })
  }
  const m = path.match(/^\/workflows\/([^/]+)$/)
  if (m && method === 'GET') return zernioFlows[m[1]] ? json({ workflow: zernioFlows[m[1]] }) : json({ error: 'not found' }, 404)
  if (m && method === 'PATCH') return json({ workflow: { ...zernioFlows[m[1]], ...call.body } })
  return json({ error: 'not found' }, 404)
}))

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const list = await import('../app/api/social/flows/route')
const one = await import('../app/api/social/flows/[id]/route')
const stats = await import('../app/api/social/flows/[id]/stats/route')
const { starterFlow, toZernio } = await import('../app/lib/flow-core')
const { getPublisher } = await import('../app/lib/publisher')

const graph = (over: Partial<ReturnType<typeof starterFlow>> = {}) => {
  const f = { ...starterFlow('instagram', 'Guide'), ...over }
  return { name: f.name, description: '', ...toZernio(f) }
}
const post = (body: unknown) => list.POST(new Request('http://x/api/social/flows', { method: 'POST', body: JSON.stringify(body) }))
const patch = (id: string, body: unknown) =>
  one.PATCH(new Request(`http://x/api/social/flows/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })
const getOne = (id: string) => one.GET(new Request(`http://x/api/social/flows/${id}`), { params: Promise.resolve({ id }) })
const writes = () => calls.filter(c => c.method !== 'GET')

const PAUSED_GRAPH = {
  nodes: [
    { id: 't', type: 'trigger', config: { triggerType: 'api_call' } },
    { id: 'm', type: 'send_message', config: { messageType: 'text', text: 'Hello' } },
    { id: 'h', type: 'webhook', config: { url: 'https://hooks.invalid/a', method: 'POST' } },
  ],
  edges: [{ id: 'e1', source: 't', target: 'm' }, { id: 'e2', source: 'm', target: 'h' }],
  entryNodeId: 't',
}

beforeEach(() => {
  role = 'account_manager'
  allowedClients = null
  calls.length = 0
  for (const k of Object.keys(db)) delete db[k]
  for (const k of Object.keys(zernioFlows)) delete zernioFlows[k]
  tbl('clients').set('c1', { id: 'c1', name: 'ZZ E2E', slug: 'zz', social_profile_id: 'zprof1' })
  tbl('clients').set('c2', { id: 'c2', name: 'Other', slug: 'o', social_profile_id: 'zprof2' })
  tbl('social_accounts').set('a1', { id: 'a1', client_id: 'c1', platform: 'instagram', provider_account_id: 'zacc1', username: 'zz', name: null, active: true })
  tbl('social_accounts').set('a2', { id: 'a2', client_id: 'c2', platform: 'facebook', provider_account_id: 'zacc2', username: 'other', name: null, active: true })
  tbl('social_accounts').set('a3', { id: 'a3', client_id: 'c1', platform: 'tiktok', provider_account_id: 'zacc3', username: 'tt', name: null, active: true })
  zernioFlows.wfpaused = { _id: 'wfpaused', name: 'Paused one', status: 'paused', platform: 'instagram', accountId: 'zacc1', profileId: 'zprof1', ...PAUSED_GRAPH }
  zernioFlows.wflive = { _id: 'wflive', name: 'Live one', status: 'active', platform: 'instagram', accountId: 'zacc1', profileId: 'zprof1', ...PAUSED_GRAPH }
  zernioFlows.wfother = { _id: 'wfother', name: 'Other client', status: 'draft', platform: 'facebook', accountId: 'zacc2', profileId: 'zprof2', ...PAUSED_GRAPH }
})

describe('who may do what', () => {
  it('a scheduler may look but not save', async () => {
    role = 'scheduler'
    const res = await list.GET(new Request('http://x/api/social/flows'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.can_manage).toBe(false)
    // the tiktok account cannot hold a Zernio workflow, so it is not offered
    expect(body.clients.find((c: { id: string }) => c.id === 'c1').accounts.map((a: { id: string }) => a.id)).toEqual(['a1'])
    expect((await post({ draft_key: 'k', client_id: 'c1', account_id: 'a1', flow: graph() })).status).toBe(403)
    expect((await patch('wfpaused', { flow: graph() })).status).toBe(403)
    expect(writes()).toEqual([])
  })

  it('an editor may not even look', async () => {
    role = 'editor'
    expect((await list.GET(new Request('http://x/api/social/flows'))).status).toBe(403)
    expect((await getOne('wfpaused')).status).toBe(403)
  })

  it('an account manager is refused another client\'s flows, list, read, create and save', async () => {
    allowedClients = ['c1']
    expect((await list.GET(new Request('http://x/api/social/flows?client_id=c2'))).status).toBe(403)
    expect((await getOne('wfother')).status).toBe(403)
    expect((await post({ draft_key: 'k', client_id: 'c2', account_id: 'a2', flow: graph() })).status).toBe(403)
    expect((await patch('wfother', { flow: graph() })).status).toBe(403)
    expect(writes()).toEqual([])
  })

  it('lists only the flows on this client\'s own accounts', async () => {
    const res = await list.GET(new Request('http://x/api/social/flows?client_id=c1'))
    const body = await res.json()
    expect(body.rows.map((r: { id: string }) => r.id).sort()).toEqual(['wflive', 'wfpaused'])
    expect(calls.find(c => c.path.startsWith('/workflows?'))?.path).toContain('profileId=zprof1')
  })
})

describe('saving', () => {
  it('a create sends OUR profile, account and platform, no status, and comes back a draft', async () => {
    const res = await post({
      draft_key: 'k1', client_id: 'c1', account_id: 'a1', status: 'active', activate: true,
      // the browser's own claims about platform and status are ignored
      flow: { ...graph(), platform: 'whatsapp', status: 'active', isActive: true, profileId: 'zprof2', accountId: 'zacc2' },
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: 'wfnew1', status: 'draft' })
    const sent = writes()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/workflows' })
    expect(sent[0].body).toMatchObject({ profileId: 'zprof1', accountId: 'zacc1', platform: 'instagram', name: 'Guide', entryNodeId: 'start' })
    expect(Object.keys(sent[0].body!).sort()).toEqual(['accountId', 'description', 'edges', 'entryNodeId', 'name', 'nodes', 'platform', 'profileId'])
  })

  it('one draft key makes one workflow — a second click gets the first one\'s id', async () => {
    const a = await post({ draft_key: 'same', client_id: 'c1', account_id: 'a1', flow: graph() })
    const b = await post({ draft_key: 'same', client_id: 'c1', account_id: 'a1', flow: graph() })
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect((await b.json()).id).toBe((await a.json()).id)
    expect(writes().filter(c => c.method === 'POST')).toHaveLength(1)
  })

  it('a DM-keyword start is refused as the owner\'s decision, and nothing reaches Zernio', async () => {
    const f = starterFlow('instagram', 'DM one')
    const t = f.steps[0]
    if (t.kind === 'trigger') t.trigger = { ...t.trigger, kind: 'dm_keyword', keywords: ['guide'], matchType: 'contains' }
    const res = await post({ draft_key: 'k2', client_id: 'c1', account_id: 'a1', flow: { name: f.name, ...toZernio(f) } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/owner/)
    expect(body.issues.some((i: { needsOwner?: boolean }) => i.needsOwner)).toBe(true)
    expect(writes()).toEqual([])
  })

  it('a new flow cannot carry a Zernio-only step (a webhook)', async () => {
    const res = await post({ draft_key: 'k3', client_id: 'c1', account_id: 'a1', flow: { name: 'x', ...PAUSED_GRAPH } })
    expect(res.status).toBe(400)
    expect(writes()).toEqual([])
  })

  it('a flow that does not validate is refused with its problems', async () => {
    const g = graph()
    const res = await post({ draft_key: 'k4', client_id: 'c1', account_id: 'a1', flow: { ...g, edges: [] } })
    expect(res.status).toBe(400)
    expect((await res.json()).issues.some((i: { code: string }) => i.code === 'orphan')).toBe(true)
    expect(writes()).toEqual([])
  })

  it('a paused flow is saved with PATCH, keeping its Zernio step, and never a status', async () => {
    const res = await patch('wfpaused', { status: 'active', flow: { name: 'Renamed', description: '', ...PAUSED_GRAPH, status: 'active' } })
    expect(res.status).toBe(200)
    const sent = writes()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ method: 'PATCH', path: '/workflows/wfpaused' })
    expect(Object.keys(sent[0].body!).sort()).toEqual(['description', 'edges', 'entryNodeId', 'name', 'nodes'])
    expect(sent[0].body!.nodes).toEqual(PAUSED_GRAPH.nodes)
  })

  it('a Zernio step cannot be changed from here', async () => {
    const nodes = PAUSED_GRAPH.nodes.map(n => n.id === 'h' ? { ...n, config: { url: 'https://evil.invalid', method: 'POST' } } : n)
    const res = await patch('wfpaused', { flow: { name: 'x', ...PAUSED_GRAPH, nodes } })
    expect(res.status).toBe(400)
    expect(writes()).toEqual([])
  })

  it('a flow that is ON is never changed (and never paused to change it)', async () => {
    const res = await patch('wflive', { flow: { name: 'x', ...PAUSED_GRAPH } })
    expect(res.status).toBe(409)
    expect(writes()).toEqual([])
  })

  it('reading a live flow says it cannot be edited', async () => {
    const res = await getOne('wflive')
    const body = await res.json()
    expect(body).toMatchObject({ status: 'active', editable: false })
    expect(body.summary[0]).toMatch(/taps its button/)
  })
})

describe('the numbers', () => {
  const getStats = (id: string) => stats.GET(new Request(`http://x/api/social/flows/${id}/stats`), { params: Promise.resolve({ id }) })

  it('a scheduler reads a flow\'s totals and per-step counts, and only GETs are made', async () => {
    role = 'scheduler'
    zernioFlows.wflive = { ...zernioFlows.wflive, totalStarted: 40, totalCompleted: 30, totalExited: 5 }
    const res = await getStats('wflive')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totals).toEqual({ started: 40, completed: 30, exited: 5, completionRate: 75 })
    expect(body).toMatchObject({ runs_total: 40, sampled: 3, unread: 1 })
    expect(body.steps.m).toEqual({ reached: 2, completed: 1, failed: 0, waiting: 1, branches: { next: 1 } })
    expect(writes()).toEqual([])
    expect(calls.find(c => c.path.includes('/executions?'))?.path).toContain('limit=25')
  })

  it('another client\'s flow\'s numbers are refused, and an editor may not read any', async () => {
    allowedClients = ['c1']
    expect((await getStats('wfother')).status).toBe(403)
    role = 'editor'
    expect((await getStats('wflive')).status).toBe(403)
  })
})

describe('nothing ever switches a flow on', () => {
  it('the publisher has no way to activate, pause, delete or start a workflow', () => {
    const p = getPublisher() as unknown as Record<string, unknown>
    const names = new Set<string>()
    for (let o: object | null = p; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) if (typeof p[k] === 'function') names.add(k)
    }
    expect([...names].filter(n => /workflow/i.test(n)).sort()).toEqual([
      'createWorkflow', 'getWorkflow', 'listWorkflows', 'updateWorkflow', 'workflowRunEvents', 'workflowRuns',
    ])
    expect([...names].filter(n => /activate|pause/i.test(n) && /workflow|flow/i.test(n))).toEqual([])
  })

  it('across every request these tests made, none went to activate, pause, a run or a delete', () => {
    expect(allCalls.length).toBeGreaterThan(5)
    // reading runs (GET …/executions) is allowed; starting one (POST …/executions) never
    const bad = allCalls.filter(c => /\/activate|\/pause|\/duplicate|\/restore/.test(c.path) || c.method === 'DELETE'
      || (c.method !== 'GET' && /\/executions/.test(c.path)))
    expect(allCalls.some(c => c.method === 'GET' && /\/executions/.test(c.path))).toBe(true)
    expect(bad).toEqual([])
    for (const c of allCalls) {
      if (c.body) expect(Object.keys(c.body)).not.toEqual(expect.arrayContaining(['status']))
    }
  })
})
