import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { roleSatisfies, type Role } from '../app/lib/identity-core'
import {
  canvasCardLabel, commentSubject, commentsOnCard, countByCard, findCanvasCard, onCardLine,
  shootCommentPath,
} from '../app/lib/canvas-comments-core'

/**
 * COMMENTS ON THE CARDS OF THE PLANNING BOARD, both ways through the glass.
 *
 * The client picks any card on their shoot board and says something about
 * it; the team sees it on the same card on their shoot page and replies
 * there; the reply is on the client's card. One row, one table
 * (batch_comments + card_id), no copy. And when the client speaks, the
 * account manager AND whoever created the shoot are told — once each,
 * with the card's name in it and a link that opens that card — and nobody
 * else: not the editor on the client, not the scheduler, never the client.
 */

const TOKEN = '3ae353c7-c879-4db7-bf71-dec9657d40e3'
const emails: Record<string, unknown>[] = []

/** who the team-side route thinks is signed in — set per test */
let who: { id: string; name: string; role: Role; client_id: string | null } =
  { id: 'am-1', name: 'Priya Patel', role: 'account_manager', client_id: null }

vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { emails.push(m) }),
  renderEmail: (h: string, b: string, _cta: string, href: string) => `${h}${b}${href}`,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/workflow', () => ({ logActivity: vi.fn(), performTransition: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../app/lib/post-analytics', () => ({
  analyticsForItems: async () => new Map(),
  refreshStaleAnalyticsInBackground: vi.fn(),
}))
vi.mock('../app/lib/authz', () => ({
  requireRole: async (required: Role) => {
    if (!roleSatisfies(who.role, required)) {
      const e = new Error('Insufficient permissions') as Error & { status: number }
      e.status = 403
      throw e
    }
    return { ...who, email: `${who.id}@x.invalid`, active_status: true }
  },
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))

const { POST: portalPost } = await import('../app/api/portal/comment/route')
const { POST: teamPost, GET: teamGet } = await import('../app/api/production/batches/[id]/comments/route')
const { getPortalData } = await import('../app/lib/portal-data')
const { getPortalShootDetail } = await import('../app/lib/portal-thread')

const CARDS = [
  { id: 'c1', kind: 'image', name: 'Hero reel image', url: 'https://cdn.test/hero.jpg', x: 0, y: 0, w: 240, z: 1 },
  { id: 'n1', kind: 'note', text: 'Golden hour on the pier\nthen the clubhouse', x: 0, y: 0, w: 208, z: 2 },
  { id: 'b1', kind: 'board', name: 'Concepts', x: 0, y: 0, w: 176, z: 3 },
  { id: 'a1', kind: 'arrow', from: 'c1', to: 'n1', x: 0, y: 0, w: 0, z: 4 },
]

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  emails.length = 0
  who = { id: 'am-1', name: 'Priya Patel', role: 'account_manager', client_id: null }
  fake = seedDb({
    clients: [{ id: 'client-1', name: 'ZZ TEST', share_token: TOKEN, timezone: 'Australia/Melbourne' }] as unknown as Row[],
    work_kinds: [], content_items: [], monthly_commitments: [], client_brand: [], intake_forms: [],
    asset_versions: [], schedule_entries: [], item_comments: [], workflow_activity: [],
    batches: [{
      id: 'b-1', client_id: 'client-1', title: 'Golf Day', status: 'brief', shared_with_client: true,
      share_board: false, owner_id: 'creator-1', canvas_cards: CARDS, created_at: '2026-09-01T00:00:00.000Z',
    }, {
      id: 'b-private', client_id: 'client-1', title: 'Private', status: 'brief', shared_with_client: false,
      owner_id: 'creator-1', canvas_cards: CARDS,
    }] as unknown as Row[],
    team_users: [
      { id: 'am-1', name: 'Priya Patel', email: 'am@zz.invalid', role: 'account_manager', active_status: true },
      { id: 'creator-1', name: 'Sam Editor', email: 'sam@zz.invalid', role: 'editor', active_status: true },
      { id: 'ed-1', name: 'Another Editor', email: 'ed@zz.invalid', role: 'editor', active_status: true },
      { id: 'sc-1', name: 'Sched', email: 'sc@zz.invalid', role: 'scheduler', active_status: true },
      { id: 'cl-1', name: 'Dana Client', email: 'dana@zz.invalid', role: 'client', client_id: 'client-1', active_status: true },
      { id: 'portal-1', email: 'portal+client-1@mdmmarketing.com.au', name: 'ZZ TEST (client portal)', role: 'client', client_id: 'client-1', active_status: false },
    ] as unknown as Row[],
    team_user_clients: [
      { id: 'l1', team_user_id: 'am-1', client_id: 'client-1' },
      { id: 'l2', team_user_id: 'ed-1', client_id: 'client-1' },
      { id: 'l3', team_user_id: 'sc-1', client_id: 'client-1' },
    ] as unknown as Row[],
    batch_comments: [],
  })
})
afterEach(() => fake.restore())

const portal = async (body: unknown) => {
  const res = (await portalPost(new Request('https://x.test/api/portal/comment', { method: 'POST', body: JSON.stringify(body) })))!
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}
const team = async (id: string, body: unknown) => {
  const res = (await teamPost(new Request(`https://x.test/api/production/batches/${id}/comments`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }))!
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}
const recipients = () => emails.map(e => e.recipientId as string).sort()

describe('the words for a card', () => {
  it('names a card the way a person would', () => {
    expect(canvasCardLabel(CARDS[0] as never)).toBe('Hero reel image')
    expect(canvasCardLabel(CARDS[1] as never)).toBe('Golden hour on the pier')
    expect(canvasCardLabel(CARDS[2] as never)).toBe('Concepts (board)')
    expect(canvasCardLabel({ kind: 'link', url: 'https://www.youtube.com/watch?v=1' } as never)).toBe('youtube.com')
    expect(canvasCardLabel({ kind: 'mockup', platform: 'ig_reel' } as never)).toBe('Post mock-up')
    expect(canvasCardLabel({ kind: 'note', text: '' } as never)).toBe('Note')
    expect(canvasCardLabel(null)).toMatch(/removed/)
  })

  it('never lets an id, an arrow or a missing card be commented on', () => {
    expect(findCanvasCard(CARDS as never, 'c1')?.id).toBe('c1')
    expect(findCanvasCard(CARDS as never, 'a1')).toBeNull()
    expect(findCanvasCard(CARDS as never, 'nope')).toBeNull()
    expect(findCanvasCard(CARDS as never, null)).toBeNull()
  })

  it('counts and lists per card, and says which card in the thread', () => {
    const rows = [
      { id: '1', card_id: 'c1', created_at: '2026-09-02T10:00:00Z' },
      { id: '2', card_id: null, created_at: '2026-09-02T09:00:00Z' },
      { id: '3', card_id: 'c1', created_at: '2026-09-02T08:00:00Z' },
    ]
    expect(countByCard(rows)).toEqual({ c1: 2 })
    expect(commentsOnCard('c1', rows).map(r => r.id)).toEqual(['3', '1'])
    expect(commentSubject('Golf Day', 'Hero reel image')).toBe('Golf Day — on: Hero reel image')
    expect(commentSubject('Golf Day', null)).toBe('Golf Day')
    expect(onCardLine('Hero reel image')).toBe('on: Hero reel image')
    expect(onCardLine(null)).toBeNull()
    expect(shootCommentPath('b-1', 'c1')).toBe('/dashboard/production/shoots/b-1?card=c1')
    expect(shootCommentPath('b-1', null)).toBe('/dashboard/production/shoots/b-1')
  })
})

describe('the client comments on a card of their board', () => {
  it('pins the comment to the card and tells the manager and the creator, once each, with the card named', async () => {
    const r = await portal({ token: TOKEN, kind: 'shoot', id: 'b-1', card_id: 'c1', body: 'Love this one', author_name: 'Dana' })
    expect(r.status).toBe(200)
    const rows = fake.rows('batch_comments') as unknown as { card_id: string | null; body: string; author_id: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].card_id).toBe('c1')
    expect(rows[0].body).toContain('Love this one')
    expect(rows[0].body).toContain('— Dana')

    // the account manager and the shoot's creator — exactly one each; the
    // editor and the scheduler on the client hear nothing, and no client does
    expect(recipients()).toEqual(['am-1', 'creator-1'])
    expect(emails.every(e => e.toClient !== true)).toBe(true)
    for (const e of emails) {
      expect(e.subject).toBe('Client comment on Golf Day — on: Hero reel image')
      expect(String(e.bodyHtml)).toContain('/dashboard/production/shoots/b-1?card=c1')
      expect(String(e.bodyHtml)).toContain('Dana')
    }
  })

  it('a creator who is also the manager is told once', async () => {
    await fake.restore()
    fake = seedDb({
      clients: [{ id: 'client-1', name: 'ZZ TEST', share_token: TOKEN }] as unknown as Row[],
      batches: [{ id: 'b-1', client_id: 'client-1', title: 'Golf Day', status: 'brief', shared_with_client: true, owner_id: 'am-1', canvas_cards: CARDS }] as unknown as Row[],
      team_users: [
        { id: 'am-1', name: 'Priya', email: 'am@zz.invalid', role: 'account_manager', active_status: true },
        { id: 'portal-1', email: 'portal+client-1@mdmmarketing.com.au', name: 'ZZ TEST (client portal)', role: 'client', active_status: false },
      ] as unknown as Row[],
      team_user_clients: [{ id: 'l1', team_user_id: 'am-1', client_id: 'client-1' }] as unknown as Row[],
      batch_comments: [],
    })
    const r = await portal({ token: TOKEN, kind: 'shoot', id: 'b-1', card_id: 'n1', body: 'Morning is better' })
    expect(r.status).toBe(200)
    expect(recipients()).toEqual(['am-1'])
    expect(emails[0].subject).toBe('Client comment on Golf Day — on: Golden hour on the pier')
  })

  it('refuses a card that is not on the board, and writes nothing', async () => {
    const r = await portal({ token: TOKEN, kind: 'shoot', id: 'b-1', card_id: 'ghost', body: 'hello' })
    expect(r.status).toBe(404)
    expect(fake.rows('batch_comments')).toHaveLength(0)
    expect(emails).toHaveLength(0)
    // an arrow is not a card either
    expect((await portal({ token: TOKEN, kind: 'shoot', id: 'b-1', card_id: 'a1', body: 'hello' })).status).toBe(404)
  })

  it('a comment with no card is the shoot’s general thread, told to the same people', async () => {
    const r = await portal({ token: TOKEN, kind: 'shoot', id: 'b-1', body: 'Looks great overall' })
    expect(r.status).toBe(200)
    const rows = fake.rows('batch_comments') as unknown as { card_id?: string | null }[]
    expect(rows[0].card_id ?? null).toBeNull()
    expect(recipients()).toEqual(['am-1', 'creator-1'])
    expect(emails[0].subject).toBe('Client comment on Golf Day')
  })

  it('an unshared shoot is not there to comment on', async () => {
    expect((await portal({ token: TOKEN, kind: 'shoot', id: 'b-private', card_id: 'c1', body: 'x' })).status).toBe(404)
  })

  it('shows on the client’s own board card, with the card named, however share_board was set', async () => {
    await portal({ token: TOKEN, kind: 'shoot', id: 'b-1', card_id: 'c1', body: 'Love this one', author_name: 'Dana' })
    const data = (await getPortalData('client-1'))!
    const shoot = data.cards.find(c => c.kind === 'shoot' && c.id === 'b-1')!
    // the board is there, share_board: false notwithstanding
    expect(shoot.shoot?.canvas_cards.map(c => c.id)).toEqual(expect.arrayContaining(['c1', 'n1', 'b1']))
    expect(shoot.shoot?.board_name ?? null).toBeNull()
    expect(shoot.comments).toHaveLength(1)
    expect(shoot.comments[0]).toMatchObject({ card_id: 'c1', card_label: 'Hero reel image', from_team: false, author_name: 'ZZ TEST' })
    // …and on the shoot's own page
    const detail = (await getPortalShootDetail(TOKEN, 'b-1'))!
    expect(detail.comments[0]).toMatchObject({ card_id: 'c1', card_label: 'Hero reel image' })
  })
})

describe('the team comments on the same card from their shoot page', () => {
  it('writes the same row shape, and the client sees it on their card with the team member’s name', async () => {
    const r = await team('b-1', { body: 'Swapped for the wider shot', card_id: 'c1' })
    expect(r.status).toBe(200)
    expect((r.json.comment as { card_id: string }).card_id).toBe('c1')
    // a team comment is not a client notification — none is sent (paused by
    // design); the comment simply appears on the portal
    expect(emails).toHaveLength(0)

    const data = (await getPortalData('client-1'))!
    const shoot = data.cards.find(c => c.kind === 'shoot' && c.id === 'b-1')!
    expect(shoot.comments).toHaveLength(1)
    expect(shoot.comments[0]).toMatchObject({ card_id: 'c1', card_label: 'Hero reel image', from_team: true, author_name: 'Priya Patel' })
  })

  it('and the client replies under it — one thread, both directions', async () => {
    await team('b-1', { body: 'Swapped for the wider shot', card_id: 'c1' })
    await portal({ token: TOKEN, kind: 'shoot', id: 'b-1', card_id: 'c1', body: 'Perfect, thanks', author_name: 'Dana' })
    const res = (await teamGet(new Request('https://x.test/api/production/batches/b-1/comments'), { params: Promise.resolve({ id: 'b-1' }) }))!
    const json = await res.json() as { comments: { card_id: string | null; body: string; team_users: { role: string } }[] }
    const onCard = json.comments.filter(c => c.card_id === 'c1')
    expect(onCard).toHaveLength(2)
    expect(onCard.map(c => c.team_users.role)).toEqual(['account_manager', 'client'])
    expect(onCard[1].body).toContain('Perfect, thanks')
  })

  it('refuses a card that is not on the board', async () => {
    expect((await team('b-1', { body: 'x', card_id: 'ghost' })).status).toBe(404)
    expect(fake.rows('batch_comments')).toHaveLength(0)
  })
})

describe('the signed-in client, through the same route', () => {
  it('may write their own shared shoot’s thread, and the same people are told', async () => {
    who = { id: 'cl-1', name: 'Dana Client', role: 'client', client_id: 'client-1' }
    const r = await team('b-1', { body: 'Can we start after nine?', card_id: 'n1', mention_ids: ['ed-1'] })
    expect(r.status).toBe(200)
    const rows = fake.rows('batch_comments') as unknown as { card_id: string | null; assigned_to: string | null; author_id: string }[]
    expect(rows[0]).toMatchObject({ card_id: 'n1', author_id: 'cl-1' })
    // a client tags nobody, whatever the request says
    expect(rows[0].assigned_to ?? null).toBeNull()
    expect(recipients()).toEqual(['am-1', 'creator-1'])
    expect(emails[0].subject).toBe('Client comment on Golf Day — on: Golden hour on the pier')
  })

  it('cannot reach an unshared shoot, or another client’s', async () => {
    who = { id: 'cl-1', name: 'Dana Client', role: 'client', client_id: 'client-1' }
    expect((await team('b-private', { body: 'x' })).status).toBe(404)
    who = { id: 'cl-2', name: 'Other', role: 'client', client_id: 'client-2' }
    expect((await team('b-1', { body: 'x' })).status).toBe(404)
  })
})
