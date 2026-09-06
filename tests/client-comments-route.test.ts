import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { canReadClientComments, clientCommentsFor, visibleComments } from '../app/lib/comment-access-core'
import type { Role } from '../app/lib/identity-core'

/**
 * THE CLIENT IS TALKING TO THEIR MANAGER, NOT TO THE ROOM.
 *
 * The pure rule per role, and the route that enforces it: an account
 * manager or a super admin reads a card's client comments; an editor or a
 * scheduler gets nothing — not a filtered list, a refusal.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000001'
const h = vi.hoisted(() => ({ user: null as unknown as Record<string, unknown> }))

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    return table('content_items').get(id)
  },
}))

const { GET } = await import('../app/api/production/items/[id]/client-comments/route')

const get = async () => {
  const res = await GET(new Request('https://x.test'), { params: Promise.resolve({ id: ITEM }) })
  return { status: res.status, json: await res.json() as any }
}

const who = (role: Role, id = `u-${role}`) => ({ id, role, email: `${role}@x.invalid`, name: role, clerk_user_id: null })

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  fake = seedDb({
    team_users: [
      { id: 'u-client', role: 'client', name: 'Cleo', email: 'cleo@x.invalid', client_id: 'c1' },
      { id: 'u-account_manager', role: 'account_manager', name: 'Ada', email: 'am@x.invalid' },
    ] as unknown as Row[],
    content_items: [{
      id: ITEM, client_id: 'c1', title: 'Winter reel', status: 'client_review',
      owner_id: 'u-editor', scheduler_ids: [], change_note: 'Tighten the intro',
    }] as unknown as Row[],
    item_comments: [
      { id: 'cm-1', item_id: ITEM, author_id: 'u-client', visibility: 'client', body: 'Logo is too small', created_at: '2026-09-06T01:00:00Z', resolved: false },
      { id: 'cm-2', item_id: ITEM, author_id: 'u-account_manager', visibility: 'internal', body: 'AM to AM', created_at: '2026-09-06T02:00:00Z', resolved: false },
      { id: 'cm-3', item_id: ITEM, author_id: 'u-client', visibility: 'client', body: 'And the music', created_at: '2026-09-06T03:00:00Z', resolved: false },
    ] as unknown as Row[],
  })
})
afterEach(() => fake.restore())

describe('the pure rule', () => {
  it('only the account manager and the super admin read client comments', () => {
    expect(canReadClientComments('account_manager')).toBe(true)
    expect(canReadClientComments('super_admin')).toBe(true)
    for (const r of ['editor', 'scheduler', 'client', null, undefined] as const) {
      expect(canReadClientComments(r), String(r)).toBe(false)
    }
  })
  it('clientCommentsFor gives the client rows to a manager and nothing to anyone else', () => {
    const rows = [
      { id: '1', visibility: 'client' }, { id: '2', visibility: 'internal' }, { id: '3', visibility: 'client' },
    ]
    expect(clientCommentsFor('account_manager', rows).map(r => r.id)).toEqual(['1', '3'])
    expect(clientCommentsFor('super_admin', rows).map(r => r.id)).toEqual(['1', '3'])
    expect(clientCommentsFor('editor', rows)).toEqual([])
    expect(clientCommentsFor('scheduler', rows)).toEqual([])
    expect(clientCommentsFor('client', rows)).toEqual([])
  })
  it('the item page thread agrees: an editor or scheduler never sees a client row', () => {
    const rows = [
      { id: '1', author_id: 'u-client', visibility: 'client', assigned_to: 'u-editor', parent_id: null },
      { id: '2', author_id: 'u-am', visibility: 'internal', assigned_to: 'u-editor', parent_id: null },
    ]
    expect(visibleComments('editor', 'u-editor', rows).map(r => r.id)).toEqual(['2'])
    expect(visibleComments('scheduler', 'u-editor', rows).map(r => r.id)).toEqual(['2'])
  })
})

describe('GET /api/production/items/[id]/client-comments', () => {
  it('an account manager reads the client thread, named, oldest first, with the last note sent back', async () => {
    h.user = who('account_manager')
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.json.comments.map((c: { id: string }) => c.id)).toEqual(['cm-1', 'cm-3'])
    expect(r.json.comments[0]).toMatchObject({ author_name: 'Cleo', body: 'Logo is too small' })
    expect(r.json.change_note).toBe('Tighten the intro')
  })
  it('a super admin reads it too', async () => {
    h.user = who('super_admin')
    expect((await get()).status).toBe(200)
  })
  it('an editor — even the one assigned — is refused, in plain words', async () => {
    h.user = who('editor')
    const r = await get()
    expect(r.status).toBe(403)
    expect(r.json).toEqual({ error: "The client's comments go to their account manager" })
  })
  it('a scheduler is refused', async () => {
    h.user = who('scheduler')
    expect((await get()).status).toBe(403)
  })
})
