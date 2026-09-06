import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The share-link portal's actions, at the seam where the token's scope is
 * the authority. A card offers only what portal-core says; this route
 * refuses the rest in the client's words — so a client cannot approve a
 * piece that is not with them, or a shoot plan nobody shared, by guessing an
 * id. Another client's item is simply not found.
 */

const TOKEN = '3ae353c7-c879-4db7-bf71-dec9657d40e3'

const performTransition = vi.fn(async (
  _actor: unknown, item: { status: string }, to: string,
) => ({ ...item, status: to }))
vi.mock('../app/lib/workflow', () => ({ performTransition, logActivity: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn() }))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(),
  renderEmail: (h: string, b: string) => `${h}${b}`,
  escapeHtml: (s: string) => s,
}))

const { POST } = await import('../app/api/portal/act/route')
const { NOT_WITH_YOU } = await import('../app/lib/portal-core')

const post = async (body: unknown) => {
  const res = await POST(new Request('https://x.test/api/portal/act', {
    method: 'POST', body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  performTransition.mockClear()
  fake = seedDb({
    clients: [{ id: 'client-1', name: 'ZZ TEST', share_token: TOKEN }] as unknown as Row[],
    work_kinds: [{ id: 'k-brief', slug: 'shoot_brief', name: 'Shoot brief' }] as unknown as Row[],
    batches: [
      { id: 'b-shared', client_id: 'client-1', title: 'Shared shoot', status: 'brief', shared_with_client: true },
      { id: 'b-private', client_id: 'client-1', title: 'Private shoot', status: 'brief', shared_with_client: false },
    ] as unknown as Row[],
    content_items: [
      { id: 'with-them', client_id: 'client-1', title: 'Reel', status: 'client_review' },
      { id: 'approved', client_id: 'client-1', title: 'Reel', status: 'approved_for_scheduling' },
      { id: 'draft', client_id: 'client-1', title: 'Reel', status: 'draft_uploaded' },
      { id: 'brief-shared', client_id: 'client-1', title: 'Plan', status: 'client_review', work_kind_id: 'k-brief', batch_id: 'b-shared' },
      { id: 'brief-private', client_id: 'client-1', title: 'Plan', status: 'client_review', work_kind_id: 'k-brief', batch_id: 'b-private' },
      { id: 'theirs', client_id: 'client-2', title: 'Someone else’s', status: 'client_review' },
    ] as unknown as Row[],
    team_users: [{
      id: 'portal-1', email: 'portal+client-1@mdmmarketing.com.au',
      name: 'ZZ TEST (client portal)', role: 'client', active_status: false,
    }] as unknown as Row[],
    team_user_clients: [],
    item_comments: [],
  })
})
afterEach(() => fake.restore())

describe('POST /api/portal/act — the card decides, and so does the route', () => {
  it('approves the card that is with them, with no note', async () => {
    const { status } = await post({ token: TOKEN, item_id: 'with-them', action: 'approve' })
    expect(status).toBe(200)
    expect(performTransition).toHaveBeenCalledTimes(1)
    expect(performTransition.mock.calls[0][2]).toBe('approved_for_scheduling')
  })

  it('refuses to approve a card that is not with them, in plain words', async () => {
    for (const id of ['approved', 'draft']) {
      const { status, json } = await post({ token: TOKEN, item_id: id, action: 'approve' })
      expect(status).toBe(403)
      expect(json.error).toBe(NOT_WITH_YOU)
    }
    expect(performTransition).not.toHaveBeenCalled()
  })

  it('refuses a comment on a draft nobody has checked', async () => {
    const { status } = await post({ token: TOKEN, item_id: 'draft', action: 'comment', comment: 'hello?' })
    expect(status).toBe(403)
  })

  it('approves a SHARED shoot plan at client_review, and refuses one that was never shared', async () => {
    expect((await post({ token: TOKEN, item_id: 'brief-shared', action: 'approve' })).status).toBe(200)
    const refused = await post({ token: TOKEN, item_id: 'brief-private', action: 'approve' })
    expect(refused.status).toBe(403)
    expect(refused.json.error).toBe(NOT_WITH_YOU)
    expect(performTransition).toHaveBeenCalledTimes(1)
  })

  it('cannot reach another client’s card at all', async () => {
    expect((await post({ token: TOKEN, item_id: 'theirs', action: 'approve' })).status).toBe(404)
  })

  it('asking for a change needs the words, and nothing else', async () => {
    expect((await post({ token: TOKEN, item_id: 'with-them', action: 'request_changes', comment: '' })).status).toBe(400)
    const ok = await post({ token: TOKEN, item_id: 'with-them', action: 'request_changes', comment: 'Tighter intro' })
    expect(ok.status).toBe(200)
    expect(performTransition.mock.calls[0][2]).toBe('client_changes_requested')
    expect(fake.rows('item_comments')).toHaveLength(1)
    expect(fake.rows('item_comments')[0]).toMatchObject({ item_id: 'with-them', visibility: 'client', body: 'Tighter intro' })
  })
})
