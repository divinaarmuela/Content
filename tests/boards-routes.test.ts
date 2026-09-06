import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The canvas's server half against a real `@/lib/db` on the in-memory
 * database. What is pinned: a board is scoped to its client; the board
 * behind a card is made once however many people open it; a resize below
 * the floor is clamped on the way in; a client's comment reaches the
 * account manager and never the editor; and deleting a board is a
 * manager's act.
 */

type Who = { id: string; name: string; role: string; client_id?: string | null }
let who: Who = { id: 'am-1', name: 'Manal', role: 'account_manager' }

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => ({ ...who, email: `${who.id}@x.invalid`, active_status: true }),
  requireRole: async () => ({ ...who, email: `${who.id}@x.invalid`, active_status: true }),
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
const notified = vi.fn<(o: unknown) => Promise<void>>(async () => {})
vi.mock('../app/lib/portal-actor', () => ({ notifyManagersOfComment: (o: unknown) => notified(o) }))

import { GET as listBoards, POST as postBoard } from '../app/api/boards/route'
import { DELETE as deleteBoard, GET as getBoard } from '../app/api/boards/[id]/route'
import { POST as postItem } from '../app/api/boards/[id]/items/route'
import { PATCH as patchItem } from '../app/api/boards/[id]/items/[itemId]/route'
import { GET as getComments, POST as postComment } from '../app/api/boards/[id]/items/[itemId]/comments/route'
import { addBoardComment } from '../app/lib/board-comments'
import { MIN_SIZE } from '../app/lib/board-canvas-core'

const rows = () => ({
  clients: [{ id: 'c1', name: 'Pure Allure' }, { id: 'c2', name: 'Sui Kitchen' }] as unknown as Row[],
  team_user_clients: [
    { id: 'am-1__c1', team_user_id: 'am-1', client_id: 'c1' },
    { id: 'ed-1__c1', team_user_id: 'ed-1', client_id: 'c1' },
  ] as unknown as Row[],
  content_items: [{ id: 'it-1', client_id: 'c1', title: 'Spring reel', status: 'draft_uploaded', owner_id: 'ed-1' }] as unknown as Row[],
  boards: [
    { id: 'b1', client_id: 'c1', parent_board_id: null, item_id: null, name: 'Golf Day', icon: 'folder', colour: 'blue', created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z' },
    { id: 'b2', client_id: 'c2', parent_board_id: null, item_id: null, name: 'Other client', icon: 'folder', colour: 'blue', created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z' },
  ] as unknown as Row[],
  board_items: [
    { id: 'n1', board_id: 'b1', kind: 'note', x: 0, y: 0, w: 288, h: 176, z: 1, text: '<p>hi</p>', created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z' },
  ] as unknown as Row[],
  board_comments: [] as Row[],
})

const json = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const params = (id: string, itemId?: string) => ({ params: Promise.resolve({ id, itemId: itemId ?? '' }) })

let fake: ReturnType<typeof seedDb>
beforeEach(() => { fake = seedDb(rows()); who = { id: 'am-1', name: 'Manal', role: 'account_manager' }; notified.mockClear() })
afterEach(() => fake.restore())

describe('a board is scoped to its client', () => {
  it('opens for the manager who holds the client', async () => {
    const res = await getBoard(new Request('http://x'), params('b1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.board.name).toBe('Golf Day')
    expect(body.crumbs).toEqual([{ id: 'b1', name: 'Golf Day' }])
    expect(body.items).toHaveLength(1)
  })
  it('refuses another client\'s board in plain words', async () => {
    const res = await getBoard(new Request('http://x'), params('b2'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not one of yours/)
  })
  it('says when a board is gone', async () => {
    const res = await getBoard(new Request('http://x'), params('nope'))
    expect(res.status).toBe(404)
  })
  it('lists a client\'s boards with what each holds', async () => {
    const res = await listBoards(new Request('http://x/api/boards?clientId=c1'))
    const body = await res.json()
    expect(body.boards.map((b: { id: string }) => b.id)).toEqual(['b1'])
    expect(body.inside.b1).toEqual({ cards: 1, boards: 0 })
  })
})

describe('one button makes a board', () => {
  it('inside another, with a tile on the parent canvas', async () => {
    const res = await postBoard(json({ client_id: 'c1', name: 'Models', icon: 'users', colour: 'amber', parent_board_id: 'b1', at: { x: 300, y: 100 } }))
    expect(res.status).toBe(200)
    const { board, tile } = await res.json()
    expect(board).toMatchObject({ client_id: 'c1', parent_board_id: 'b1', name: 'Models', icon: 'users', colour: 'amber' })
    expect(tile).toMatchObject({ board_id: 'b1', kind: 'board', child_board_id: board.id, label: 'Models', colour: 'amber', x: 304, y: 96 })
    const open = await (await getBoard(new Request('http://x'), params(board.id))).json()
    expect(open.crumbs.map((c: { name: string }) => c.name)).toEqual(['Golf Day', 'Models'])
  })
  it('refuses a nameless board', async () => {
    const res = await postBoard(json({ client_id: 'c1', name: '  ' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Give the board a name')
  })
  it('makes exactly one board behind a card, however many open it', async () => {
    const [a, b] = await Promise.all([
      postBoard(json({ item_id: 'it-1' })), postBoard(json({ item_id: 'it-1' })),
    ])
    const ba = (await a.json()).board
    const bb = (await b.json()).board
    expect(ba.id).toBe('item-it-1')
    expect(bb.id).toBe('item-it-1')
    expect(ba).toMatchObject({ item_id: 'it-1', client_id: 'c1', name: 'Spring reel' })
    expect(fake.rows('boards').filter(r => (r as { item_id?: string }).item_id === 'it-1')).toHaveLength(1)
  })
})

describe('items', () => {
  it('clamps a resize below the floor and snaps a move', async () => {
    const res = await patchItem(json({ w: 5, h: 5, x: 33, y: 21 }), params('b1', 'n1'))
    expect(res.status).toBe(200)
    expect((await res.json()).item).toMatchObject({ ...MIN_SIZE.note, x: 32, y: 16, text: '<p>hi</p>' })
  })
  it('keeps a heading\'s dragged width, and a chosen colour', async () => {
    const made = await postItem(json({ kind: 'heading', text: 'SHOOT CONCEPTS', x: 0, y: 400, w: 1400, h: 64, colour: 'green' }), params('b1'))
    expect(made.status).toBe(200)
    expect((await made.json()).item).toMatchObject({ w: 1408, colour: 'green', text: 'SHOOT CONCEPTS' })
  })
  it('refuses a link that is not a link', async () => {
    const res = await postItem(json({ kind: 'link', url: 'javascript:alert(1)' }), params('b1'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/https:\/\//)
  })
  it('will not put a board tile here — that is the New board button', async () => {
    const res = await postItem(json({ kind: 'board', child_board_id: 'b2' }), params('b1'))
    expect(res.status).toBe(400)
  })
  it('stacks an item dropped into a column', async () => {
    const col = (await (await postItem(json({ kind: 'column', column_title: 'Day 1', x: 500, y: 0 }), params('b1'))).json()).item
    const dropped = await patchItem(json({ x: 520, y: 100, parent_item_id: col.id }), params('b1', 'n1'))
    expect(dropped.status).toBe(200)
    const after = fake.rows('board_items').find(r => r.id === 'n1') as unknown as { x: number; y: number; w: number; parent_item_id: string }
    expect(after.parent_item_id).toBe(col.id)
    expect(after.x).toBe(col.x + 12)
    expect(after.y).toBe(col.y + 56)
    expect(after.w).toBe(col.w - 24)
  })
  it('is the team\'s to draw on, not a client\'s', async () => {
    who = { id: 'cl-1', name: 'Pure Allure (client portal)', role: 'client', client_id: 'c1' }
    const res = await patchItem(json({ x: 0, y: 0 }), params('b1', 'n1'))
    expect(res.status).toBe(403)
  })
})

describe('a comment belongs to one item', () => {
  it('carries who and when, and is refused empty', async () => {
    const empty = await postComment(json({ body: ' ' }), params('b1', 'n1'))
    expect(empty.status).toBe(400)
    const res = await postComment(json({ body: 'Use the second shot' }), params('b1', 'n1'))
    expect(res.status).toBe(200)
    const { comment } = await res.json()
    expect(comment).toMatchObject({ item_id: 'n1', board_id: 'b1', author_name: 'Manal', author_role: 'account_manager', body: 'Use the second shot' })
    expect(comment.created_at).toMatch(/^\d{4}-/)
    expect(notified).not.toHaveBeenCalled()
  })
  it('a client\'s words reach the manager, and never the editor', async () => {
    await addBoardComment({
      boardId: 'b1', itemId: 'n1', body: 'Love this one',
      author: { id: 'cl-1', name: 'Pure Allure', role: 'client' },
    })
    expect(notified).toHaveBeenCalledTimes(1)
    expect(notified.mock.calls[0][0]).toMatchObject({ clientId: 'c1', speaker: 'Pure Allure', dashboardPath: '/dashboard/boards/b1?item=n1' })

    const asManager = await (await getComments(new Request('http://x'), params('b1', 'n1'))).json()
    expect(asManager.comments.map((c: { body: string }) => c.body)).toEqual(['Love this one'])

    who = { id: 'ed-1', name: 'Jess', role: 'editor' }
    const asEditor = await (await getComments(new Request('http://x'), params('b1', 'n1'))).json()
    expect(asEditor.comments).toEqual([])
    const snapshot = await (await getBoard(new Request('http://x'), params('b1'))).json()
    expect(snapshot.comments).toEqual([])
  })
  it('is refused on an item that is not on the board', async () => {
    const res = await postComment(json({ body: 'x' }), params('b1', 'ghost'))
    expect(res.status).toBe(404)
  })
})

describe('deleting a board', () => {
  it('is a manager\'s act', async () => {
    who = { id: 'ed-1', name: 'Jess', role: 'editor' }
    const res = await deleteBoard(new Request('http://x'), params('b1'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/account manager/)
  })
  it('takes everything inside with it, and the tile that pointed at it', async () => {
    const { board } = await (await postBoard(json({ client_id: 'c1', name: 'Models', parent_board_id: 'b1' }))).json()
    await postItem(json({ kind: 'note', text: 'inner' }), params(board.id))
    const res = await deleteBoard(new Request('http://x'), params(board.id))
    expect(res.status).toBe(200)
    expect(fake.rows('boards').map(r => r.id)).toEqual(['b1', 'b2'])
    expect(fake.rows('board_items').map(r => r.id)).toEqual(['n1'])
  })
})
