import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * READING AND RENAMING A CHANNEL ARE BOTH SCOPED BY CLIENT, NOT BY JOB TITLE.
 *
 * `PATCH /api/social/accounts/[id]` exists so a scheduler can call a channel
 * "Acme — main" rather than reading the platform's handle twice on one tile.
 * It arrived with `requireRole('scheduler')` and nothing else, and a role says
 * what somebody may DO — never whose work they may do it to. So a scheduler on
 * one client could rename any account in the system by id, including another
 * agency client's, and the rename shows up on that client's screens.
 *
 * The real `@/lib/db` over an in-memory Realtime Database, because the answer
 * depends on rows: who is assigned to which client, and which client the
 * account belongs to.
 */

const h = vi.hoisted(() => ({
  user: { id: '', role: '', email: '', name: '', clerk_user_id: null } as Record<string, unknown>,
}))

vi.mock('../app/lib/authz', () => {
  class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  }
  const ORDER = ['scheduler', 'editor', 'account_manager', 'super_admin']
  const ok = (actual: string, required: string) => {
    if (actual === 'super_admin') return true
    if (required === 'client') return actual === 'client'
    if (actual === 'client') return false
    return ORDER.indexOf(actual) >= ORDER.indexOf(required)
  }
  return {
    AuthzError,
    authzErrorResponse: (e: unknown) => (e instanceof AuthzError
      ? { error: e.message, status: e.status }
      : { error: e instanceof Error ? e.message : 'error', status: 500 }),
    requireRole: async (required: string) => {
      if (!ok(String(h.user.role), required)) throw new AuthzError('Insufficient permissions', 403)
      return h.user
    },
    requireSignedIn: async () => h.user,
  }
})
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(), renderEmail: () => '', escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/workflow', () => ({
  logActivity: vi.fn(), sanitiseRawAssets: (v: unknown) => (Array.isArray(v) ? v : []),
}))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))
/** the provider, with the network taken out — the GET fans out to seven of its
 *  endpoints and none of them is what this file is about */
vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({
    configured: () => true,
    accountHealth: async () => ({ status: 'healthy' }),
    accountInsights: async () => null,
    dailyMetrics: async () => null,
    followerStats: async () => null,
    listPosts: async () => [],
    postAnalytics: async () => [],
    listComments: async () => [],
  }),
  isPublishDryRun: () => true,
}))

const route = await import('../app/api/social/accounts/[id]/route')

const MINE = 'c1'
const THEIRS = 'c2'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }
/** an editor assigned to the OTHER client only */
const OUTSIDER = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Kit', clerk_user_id: null }

const as = (who: typeof AM) => { Object.assign(h.user, who) }

let fake: ReturnType<typeof seedDb>

const account = (id: string, clientId: string, name: string) => ({
  id, client_id: clientId, platform: 'instagram', provider_account_id: `prov-${id}`,
  name, username: 'acme', avatar_url: null, active: true,
  connected_at: '2026-09-01T00:00:00.000Z', last_synced_at: '2026-09-01T00:00:00.000Z',
})

beforeEach(() => {
  as(SCHEDULER)
  fake = seedDb({
    clients: [
      { id: MINE, name: 'Acme', timezone: 'Australia/Melbourne' },
      { id: THEIRS, name: 'Other', timezone: 'Australia/Melbourne' },
    ] as unknown as Row[],
    social_accounts: [
      account('acc-mine', MINE, 'Acme on Instagram'),
      account('acc-theirs', THEIRS, 'Other on Instagram'),
    ] as unknown as Row[],
    team_users: [AM, SCHEDULER, OUTSIDER].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: null,
    })) as unknown as Row[],
    team_user_clients: [
      { id: `${AM.id}__${MINE}`, team_user_id: AM.id, client_id: MINE },
      { id: `${OUTSIDER.id}__${THEIRS}`, team_user_id: OUTSIDER.id, client_id: THEIRS },
    ] as unknown as Row[],
    content_items: [],
  })
})
afterEach(() => {
  fake.restore()
  vi.clearAllMocks()
})

const rename = async (id: string, name: string) => {
  const res = await route.PATCH(
    new Request(`https://x.test/api/social/accounts/${id}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ id }) },
  )
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

const nameOf = (id: string) =>
  (fake.rows('social_accounts') as Record<string, unknown>[]).find(a => a.id === id)?.name

describe('PATCH /api/social/accounts/[id]', () => {
  it('lets the client’s own account manager rename their channel', async () => {
    as(AM)
    const out = await rename('acc-mine', 'Acme — main')
    expect(out.status).toBe(200)
    expect(nameOf('acc-mine')).toBe('Acme — main')
  })

  it('refuses somebody who is not on that client, however senior their role', async () => {
    as(AM)                                   // an account manager, but not THEIRS
    const out = await rename('acc-theirs', 'Renamed by a stranger')
    expect(out.status).toBe(403)
    expect(out.body.error).toBe('That client is not one of yours')
    expect(nameOf('acc-theirs')).toBe('Other on Instagram')
  })

  it('refuses the editor on the other client our own channel', async () => {
    as(OUTSIDER)
    const out = await rename('acc-mine', 'Not yours')
    expect(out.status).toBe(403)
    expect(nameOf('acc-mine')).toBe('Acme on Instagram')
  })

  it('lets a scheduler through, because a scheduler is scoped by status', async () => {
    // `accessibleClientIds` answers null for the roles scoped by STATUS rather
    // than by client — the same answer the production board acts on
    as(SCHEDULER)
    expect((await rename('acc-mine', 'Acme — main')).status).toBe(200)
  })

  it('answers a channel that is gone the same way as one nobody may touch', async () => {
    as(AM)
    const out = await rename('acc-nowhere', 'Ghost')
    expect(out.status).toBe(404)
    expect(out.body.error).toBe('That account is no longer connected')
  })

  it('still asks for a name', async () => {
    as(AM)
    const res = await route.PATCH(
      new Request('https://x.test/api/social/accounts/acc-mine', {
        method: 'PATCH', body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'acc-mine' }) },
    )
    expect(res.status).toBe(400)
    expect(nameOf('acc-mine')).toBe('Acme on Instagram')
  })
})

/**
 * THE READ IS THE WIDER SURFACE OF THE TWO.
 *
 * A rename changes a label. This response carries the handle, the connection
 * date, the token's health, the follower history, the last twenty posts,
 * per-post analytics and the inbox comments — and it was gated on the ROLE
 * alone, so anybody with it could paste another client's account uuid and read
 * the lot. The PATCH beside it had been fixed; this had not.
 */
describe('GET /api/social/accounts/[id]', () => {
  const read = async (id: string) => {
    const res = await route.GET(
      new Request(`https://x.test/api/social/accounts/${id}`),
      { params: Promise.resolve({ id }) },
    )
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }

  it('hands the client’s own account manager their account', async () => {
    as(AM)
    const out = await read('acc-mine')
    expect(out.status).toBe(200)
    expect((out.body.account as { id: string }).id).toBe('acc-mine')
  })

  it('refuses another client’s account, and hands over none of it', async () => {
    as(AM)
    const out = await read('acc-theirs')
    expect(out.status).toBe(403)
    expect(out.body.error).toBe('That client is not one of yours')
    // not the handle, not the analytics, not the comments
    expect(out.body.account).toBeUndefined()
    expect(out.body.analytics).toBeUndefined()
    expect(out.body.comments).toBeUndefined()
  })

  it('refuses the editor on the other client ours', async () => {
    as(OUTSIDER)
    expect((await read('acc-mine')).status).toBe(403)
  })

  it('404s an account with no client on it, rather than letting it through', async () => {
    // a row nobody owns must not become the same hole by another door
    await (await import('@/lib/db')).table('social_accounts')
      .update('acc-mine', { client_id: null })
    as(AM)
    const out = await read('acc-mine')
    expect(out.status).toBe(404)
    expect(out.body.account).toBeUndefined()
  })

  it('is a 404 for an account that never existed', async () => {
    as(AM)
    expect((await read('acc-nowhere')).status).toBe(404)
  })
})
