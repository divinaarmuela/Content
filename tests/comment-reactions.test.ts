import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { REACTION_EMOJIS, reactionChips, reactionsOf, toggleReaction } from '../app/lib/comment-reactions-core'

/**
 * REACTIONS ON A COMMENT (the owner, 22 Oct 2026: "also in comments can u
 * please add reactions"): the pure toggle, and the route that stores only
 * the seven choices for a team member who can read the comment.
 */

describe('the toggle', () => {
  it('adds me when absent and takes me away when present, dropping an empty emoji', () => {
    const one = toggleReaction(null, '👍', 'u1')
    expect(one).toEqual({ '👍': ['u1'] })
    const two = toggleReaction(one, '👍', 'u2')
    expect(two).toEqual({ '👍': ['u1', 'u2'] })
    expect(toggleReaction(two, '👍', 'u1')).toEqual({ '👍': ['u2'] })
    expect(toggleReaction({ '👍': ['u1'] }, '👍', 'u1')).toEqual({})
    expect(toggleReaction({ '👍': ['u1'] }, '🔥', 'u1')).toEqual({ '👍': ['u1'], '🔥': ['u1'] })
  })
  it('reads what RTDB hands back: unknown emojis dropped, object-lists read, duplicates folded', () => {
    expect(reactionsOf({ '👍': { 0: 'a', 1: 'a', 2: 'b' }, '💩': ['x'], '🔥': [] })).toEqual({ '👍': ['a', 'b'] })
    expect(reactionsOf('nope')).toEqual({})
  })
  it('chips follow the picker order and light mine', () => {
    const chips = reactionChips({ '🔥': ['u2'], '👍': ['u1', 'u2'] }, 'u1')
    expect(chips.map(c => [c.emoji, c.count, c.mine])).toEqual([['👍', 2, true], ['🔥', 1, false]])
    expect(REACTION_EMOJIS).toHaveLength(7)
  })
})

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000001'
const h = vi.hoisted(() => ({ user: null as unknown as Record<string, unknown> }))
vi.mock('../app/lib/authz', () => ({
  requireRole: async () => h.user,
  authzErrorResponse: (e: unknown) => ({ error: e instanceof Error ? e.message : 'error', status: (e as { status?: number })?.status ?? 500 }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    return table('content_items').get(id)
  },
}))

const { POST } = await import('../app/api/production/items/[id]/comments/[commentId]/react/route')
const react = async (commentId: string, emoji: unknown) => {
  const res = await POST(new Request('https://x.test', { method: 'POST', body: JSON.stringify({ emoji }) }),
    { params: Promise.resolve({ id: ITEM, commentId }) })
  return { status: res.status, json: await res.json() as any }
}

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  h.user = { id: 'u-editor', role: 'editor', email: 'e@x.invalid', name: 'Eddie', active_status: true }
  fake = seedDb({
    content_items: [{ id: ITEM, client_id: 'c1', title: 'Winter reel', status: 'draft_uploaded' }] as unknown as Row[],
    item_comments: [
      { id: 'cm-1', item_id: ITEM, author_id: 'u-am', visibility: 'internal', body: 'Tighten the intro', created_at: '2026-10-22T01:00:00Z', resolved: false },
      { id: 'cm-2', item_id: 'other-item', author_id: 'u-am', visibility: 'internal', body: 'elsewhere', created_at: '2026-10-22T01:00:00Z', resolved: false },
    ] as unknown as Row[],
  })
})
afterEach(() => fake.restore())

describe('POST …/comments/[commentId]/react', () => {
  it('refuses an emoji that is not one of the seven, and stores nothing', async () => {
    for (const bad of ['💩', '👍👍', '', 'x', null, 42]) {
      const r = await react('cm-1', bad)
      expect(r.status, String(bad)).toBe(400)
    }
    expect((fake.rows('item_comments').find(r => r.id === 'cm-1') as any).reactions).toBeUndefined()
  })
  it('toggles my reaction on and off', async () => {
    const on = await react('cm-1', '🔥')
    expect(on.status).toBe(200)
    expect(on.json.reactions).toEqual({ '🔥': ['u-editor'] })
    expect((fake.rows('item_comments').find(r => r.id === 'cm-1') as any).reactions).toEqual({ '🔥': ['u-editor'] })
    const off = await react('cm-1', '🔥')
    expect(off.json.reactions).toEqual({})
  })
  it('never reacts to a comment on another card', async () => {
    expect((await react('cm-2', '👍')).status).toBe(404)
    expect((await react('missing', '👍')).status).toBe(404)
  })
})
