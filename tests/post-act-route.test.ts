import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * POST /api/posts/<id>/act — the one route that moves a post. Who may do what is decided HERE, on the
 * server, from the person's hats on the post (a hidden button is presentation, not security), and every
 * answer carries the post as it now stands so the page redraws from the server.
 */

const h = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }))

vi.mock('../app/lib/authz', () => {
  class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  }
  return {
    AuthzError,
    authzErrorResponse: (e: unknown) => (e instanceof AuthzError
      ? { error: e.message, status: e.status }
      : { error: e instanceof Error ? e.message : 'error', status: 500 }),
    requireSignedIn: async () => {
      if (!h.user) throw new AuthzError('Not signed in', 401)
      return h.user
    },
  }
})

const route = await import('../app/api/posts/[id]/act/route')
const engine = await import('../app/lib/post-stage')

const CLIENT = 'c1'
const who = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  id, role, email: `${id}@x.invalid`, name: id, clerk_user_id: null, active_status: true, ...extra,
})
const SCHED = who('u-sch', 'scheduler')
const QR = who('u-qr', 'quality_checker')
const AM = who('u-am', 'account_manager')
const EDITOR = who('u-ed', 'editor')

let fake: ReturnType<typeof seedDb>
let undo: () => void
const mayActOnClient = vi.fn(async () => true)

const act = async (id: string, body: unknown) => {
  const res = await route.POST(
    new Request(`https://x.test/api/posts/${id}/act`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  )
  return { status: res.status, body: await res.json() as any }
}

beforeEach(async () => {
  fake = seedDb({
    clients: [{ id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne', share_token: 'tok-1', email: 'owner@acme.invalid' }] as unknown as Row[],
    social_accounts: [{ id: 'acc-ig', client_id: CLIENT, platform: 'instagram', provider_account_id: 'p', name: 'IG', active: true }] as unknown as Row[],
    content_items: [{ id: 'item-1', client_id: CLIENT, title: 'Launch', status: 'approved_for_scheduling' }] as unknown as Row[],
    social_posts: [],
    post_versions: [],
    post_events: [],
  })
  undo = engine.usePostEngineDeps({
    autoBook: false,
    queuePublish: vi.fn(async () => ({ id: 'job-1' })),
    cancelJob: vi.fn(async () => ({ ok: true as const })),
    deliverToClient: vi.fn(async () => ({ delivered: [], failed: [], link: '' })),
    notify: vi.fn(async () => {}),
    announce: vi.fn(),
    mayActOnClient,
  })
  await engine.insertDraftPost({
    id: 'p1', client_id: CLIENT, item_id: 'item-1', created_by: SCHED.id,
    slides: [{ url: 'https://media.mdmmarketing.com.au/a.jpg', name: 'a.jpg', type: 'image' }] as never,
    caption: 'Hi', channels: ['acc-ig'], per_channel: {}, scheduled_for: new Date(Date.now() + 86_400_000).toISOString(),
    timezone: 'Australia/Melbourne',
  })
  h.user = SCHED
})
afterEach(() => { undo(); fake.restore(); mayActOnClient.mockClear() })

describe('POST /api/posts/[id]/act', () => {
  it('moves the post and answers with it, and the words name where it landed', async () => {
    const r = await act('p1', { action: 'send_to_qc', expect_rev: 0 })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, stage: 'quality_check', words: 'Send for quality check — now in Quality check' })
    expect(r.body.post).toMatchObject({ id: 'p1', stage: 'quality_check', rev: 1, sent_version: 1 })
  })

  it('a stale page gets 409 and the fresh post', async () => {
    await act('p1', { action: 'send_to_qc', expect_rev: 0 })
    const r = await act('p1', { action: 'send_to_qc', expect_rev: 0 })
    expect(r.status).toBe(409)
    expect(r.body.ok).toBe(false)
    expect(r.body.post.stage).toBe('quality_check')
  })

  it('403 for a move this person may not make — an account manager passing, an editor at all', async () => {
    await act('p1', { action: 'send_to_qc', expect_rev: 0 })
    h.user = AM
    const am = await act('p1', { action: 'pass', expect_rev: 1, version: 1 })
    expect(am.status).toBe(403)
    expect(am.body.code).toBe('not_allowed')
    h.user = EDITOR
    expect((await act('p1', { action: 'edit', expect_rev: 1 })).status).toBe(403)
    h.user = QR
    const ok = await act('p1', { action: 'pass', expect_rev: 1, version: 1 })
    expect(ok.status).toBe(200)
    expect(ok.body.stage).toBe('ready')
  })

  it('403 for a client this person is not on', async () => {
    mayActOnClient.mockImplementationOnce(async () => false)
    const r = await act('p1', { action: 'send_to_qc', expect_rev: 0 })
    expect(r.status).toBe(403)
    expect(fake.rows('social_posts')[0]).toMatchObject({ stage: 'draft' })
  })

  it('400 for a body that is not a request, and for the client’s or the app’s own moves', async () => {
    expect((await act('p1', { action: 'fly' })).status).toBe(400)
    expect((await act('p1', { action: 'send_to_qc' })).status).toBe(400)
    expect((await act('p1', { action: 'client_approve', expect_rev: 0, version: 1 })).status).toBe(400)
    expect((await act('p1', { action: 'record_posted', expect_rev: 0 })).status).toBe(400)
  })

  it('404 for no such post', async () => {
    const r = await act('nope', { action: 'send_to_qc', expect_rev: 0 })
    expect(r.status).toBe(404)
  })

  it('401 when nobody is signed in', async () => {
    h.user = null
    expect((await act('p1', { action: 'send_to_qc', expect_rev: 0 })).status).toBe(401)
  })
})
