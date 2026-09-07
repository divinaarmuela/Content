import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  askedIdsOf, askedPatch, askedWords, isAsked, nameList, waitingOnViewer, NOBODY_ASKED,
} from '../app/lib/asked-core'
import { whoseTurn, STATUS_TURN } from '../app/lib/workflow-core'
import { cardLines, matchesShow, overviewTiles } from '../app/lib/board-view-core'

/**
 * ASKING SOMEONE IS ASSIGNING THEM — and one person acting clears it for all.
 *
 * Picking reviewers used to narrow the email and nothing else: a card in
 * Internal check read "your turn" to every manager on the client and sat on
 * every one of their Overviews until the status moved. Now the people asked
 * are ON the card, and the next thing that happens to it takes them off —
 * in the same write, so it can never be left stale.
 */

const NAMES = new Map([['u-am', 'Divina'], ['u-am2', 'Yusuf'], ['u-sc', 'Sam']])

describe('who was asked, read off the card', () => {
  it('reads the ids, and shrugs off anything that is not a list of them', () => {
    expect(askedIdsOf({ asked_ids: ['u-am', 'u-am2'] })).toEqual(['u-am', 'u-am2'])
    expect(askedIdsOf({ asked_ids: null })).toEqual([])
    expect(askedIdsOf({})).toEqual([])
    expect(askedIdsOf(undefined)).toEqual([])
    // a column that read back as an object, or holds junk
    expect(askedIdsOf({ asked_ids: { 0: 'u-am' } })).toEqual([])
    expect(askedIdsOf({ asked_ids: ['u-am', '', 7, null] as unknown })).toEqual(['u-am'])
  })

  it('nobody asked means the old rule still decides — everyone passes', () => {
    expect(isAsked({ asked_ids: null })).toBe(false)
    expect(waitingOnViewer({ asked_ids: null }, 'u-am')).toBe(true)
    expect(waitingOnViewer({}, 'anyone-at-all')).toBe(true)
  })

  it('somebody asked means those people, and nobody else', () => {
    const card = { asked_ids: ['u-am', 'u-am2'] }
    expect(waitingOnViewer(card, 'u-am')).toBe(true)
    expect(waitingOnViewer(card, 'u-am2')).toBe(true)
    expect(waitingOnViewer(card, 'u-sc')).toBe(false)
  })
})

describe('the words beside Who', () => {
  it('says who and what for, in the stage’s own words', () => {
    expect(askedWords({ asked_ids: ['u-am'], status: 'internal_review' }, NAMES, STATUS_TURN))
      .toBe('With Divina to check')
    expect(askedWords({ asked_ids: ['u-sc'], status: 'approved_for_scheduling' }, NAMES, STATUS_TURN))
      .toBe('With Sam to post')
  })

  it('names two people properly, and three', () => {
    expect(nameList(['u-am', 'u-am2'], NAMES)).toBe('Divina and Yusuf')
    expect(nameList(['u-am', 'u-am2', 'u-sc'], NAMES)).toBe('Divina, Yusuf and Sam')
    // an id nobody can name is still a person, not an id on the screen
    expect(nameList(['u-ghost'], NAMES)).toBe('someone')
  })

  it('draws nothing when nobody was asked', () => {
    expect(askedWords({ asked_ids: null, status: 'internal_review' }, NAMES, STATUS_TURN)).toBeNull()
  })

  it('the card says it beside Who, never instead of it', () => {
    const lines = cardLines({
      id: 'i1', title: 'Hero reel', status: 'internal_review', client_id: 'c1',
      owner_id: 'u-ed', due_date: null, asked_ids: ['u-am'],
    }, { names: new Map([...NAMES, ['u-ed', 'Eden']]), today: '2026-09-07' })
    expect(lines.assignee).toBe('Eden')
    expect(lines.asked).toBe('With Divina to check')
  })

  it('…and says "you" to the person who was asked', () => {
    const lines = cardLines({
      id: 'i1', title: 'Hero reel', status: 'internal_review', client_id: 'c1',
      owner_id: 'u-ed', due_date: null, asked_ids: ['u-am'],
    }, { names: NAMES, today: '2026-09-07', viewerId: 'u-am' })
    expect(lines.asked).toBe('With you to check')
  })
})

describe('whose turn it is', () => {
  const AM = { id: 'u-am', role: 'account_manager' as const }
  const AM2 = { id: 'u-am2', role: 'account_manager' as const }
  const SUPER = { id: 'u-boss', role: 'super_admin' as const }

  it('with nobody asked, every manager on the client still holds the turn', () => {
    const card = { owner_id: 'u-ed' }
    expect(whoseTurn('internal_review', card, AM).mine).toBe(true)
    expect(whoseTurn('internal_review', card, AM2).mine).toBe(true)
  })

  it('with one manager asked, it is theirs and not the other’s', () => {
    const card = { owner_id: 'u-ed', asked_ids: ['u-am'] }
    expect(whoseTurn('internal_review', card, AM).mine).toBe(true)
    expect(whoseTurn('internal_review', card, AM2).mine).toBe(false)
    // not even the super admin, who may still DO anything
    expect(whoseTurn('internal_review', card, SUPER).mine).toBe(false)
  })

  it('a stage that is nobody’s turn stays nobody’s, asked or not', () => {
    expect(whoseTurn('published', { owner_id: 'u-ed', asked_ids: ['u-am'] }, AM).mine).toBe(false)
  })
})

describe('the Overview counts it for the people asked, and nobody else', () => {
  const today = '2026-09-07'
  const card = (asked: string[] | null) => ({
    id: `i-${asked?.join('-') ?? 'none'}`, title: 'Hero reel', status: 'internal_review' as const,
    client_id: 'c1', owner_id: 'u-ed', due_date: null, asked_ids: asked,
  })

  const decideCount = (viewerId: string, cards: ReturnType<typeof card>[]) => {
    const tiles = overviewTiles({
      viewer: { id: viewerId, role: 'account_manager' }, cards, today, clientCount: 0,
    })
    return tiles.find(t => t.key === 'decide')!.stats[0].value
  }

  it('two managers asked: it is on both Overviews', () => {
    const cards = [card(['u-am', 'u-am2'])]
    expect(decideCount('u-am', cards)).toBe(1)
    expect(decideCount('u-am2', cards)).toBe(1)
  })

  it('…and on nobody else’s', () => {
    expect(decideCount('u-am3', [card(['u-am', 'u-am2'])])).toBe(0)
  })

  it('with nobody asked it behaves exactly as it did — everyone counts it', () => {
    const cards = [card(null)]
    expect(decideCount('u-am', cards)).toBe(1)
    expect(decideCount('u-am3', cards)).toBe(1)
  })

  it('the same rule runs the board’s lens', () => {
    const ctx = { viewer: { id: 'u-am2', role: 'account_manager' as const }, today }
    expect(matchesShow(card(['u-am']), 'decide', ctx)).toBe(false)
    expect(matchesShow(card(null), 'decide', ctx)).toBe(true)
  })

  it('a scheduler’s queue narrows the same way', () => {
    const ready = (asked: string[] | null) => ({
      id: `r-${asked?.join('-') ?? 'none'}`, title: 'Hero reel',
      status: 'approved_for_scheduling' as const, client_id: 'c1',
      owner_id: null, due_date: null, asked_ids: asked,
    })
    const toBookIn = (viewerId: string, cards: ReturnType<typeof ready>[]) =>
      overviewTiles({ viewer: { id: viewerId, role: 'scheduler' }, cards, today })
        .find(t => t.key === 'ready')!.stats[0].value
    expect(toBookIn('u-sc', [ready(['u-sc'])])).toBe(1)
    expect(toBookIn('u-sc2', [ready(['u-sc'])])).toBe(0)
    expect(toBookIn('u-sc2', [ready(null)])).toBe(1)
  })
})

describe('the fields that get written', () => {
  it('a list of people becomes the ask, stamped', () => {
    const p = askedPatch(['u-am', 'u-am2'], '2026-09-07T00:00:00Z')
    expect(p).toEqual({ asked_ids: ['u-am', 'u-am2'], asked_at: '2026-09-07T00:00:00Z' })
  })

  it('nobody becomes the clear — a removal, not an empty list', () => {
    expect(askedPatch(null)).toEqual(NOBODY_ASKED)
    expect(askedPatch([])).toEqual(NOBODY_ASKED)
    expect(askedPatch(['', null as unknown as string])).toEqual(NOBODY_ASKED)
  })

  it('the same person twice is one person', () => {
    expect(askedPatch(['u-am', 'u-am'], 'x').asked_ids).toEqual(['u-am'])
  })
})

/* ── the round trip: asked, then answered ─────────────────────────── */

const ITEM = 'cccccccc-0000-4000-8000-000000000001'
const ED = { id: 'u-ed', role: 'editor' as const, email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const AM = { id: 'u-am', role: 'account_manager' as const, email: 'am@x.invalid', name: 'Divina', clerk_user_id: null }
const AM2 = { id: 'u-am2', role: 'account_manager' as const, email: 'am2@x.invalid', name: 'Yusuf', clerk_user_id: null }

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  emails: [] as Record<string, unknown>[],
  /** every write the fake database saw, in order */
  writes: [] as { table: string; id: string; patch: Record<string, unknown> }[],
}))

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  requireRole: async () => h.user,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    const row = await table('content_items').get(id)
    if (!row) throw Object.assign(new Error('Item not found'), { status: 404 })
    return row
  },
  shapeItemDetail: (_u: unknown, item: unknown) => item,
}))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { h.emails.push(m); return 'sent' }),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(),
  mirrorRawAssets: vi.fn(), newRawAssets: () => [], itemMirrorProgress: async () => null,
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { POST: TRANSITION } = await import('../app/api/production/items/[id]/transition/route')

const move = async (to: string, notifyIds?: string[]) => {
  const res = await TRANSITION(
    new Request(`https://x.test/api/production/items/${ITEM}/transition`, {
      method: 'POST', body: JSON.stringify({ to, ...(notifyIds ? { notify_ids: notifyIds } : {}) }),
    }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

const drain = () => new Promise(r => setTimeout(r, 20))

let fake: ReturnType<typeof seedDb> | null = null
const item = () => fake!.rows('content_items')[0] as Record<string, unknown>

const seed = (status: string, asked: string[] | null = null) => seedDb({
  clients: [{ id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
  team_users: [ED, AM, AM2].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [
    { id: `${AM.id}__c1`, team_user_id: AM.id, client_id: 'c1' },
    { id: `${AM2.id}__c1`, team_user_id: AM2.id, client_id: 'c1' },
  ] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Hero reel', status, content_type: 'reel',
    owner_id: ED.id, scheduler_ids: [], current_version_number: 1, batch_id: null,
    work_kind_id: null, client_approval_required: false, due_date: null,
    link_url: 'https://drive.google.com/file/d/x/view', link_kind: 'drive',
    asked_ids: asked, asked_at: asked ? '2026-09-06T00:00:00Z' : null,
  }] as unknown as Row[],
})

beforeEach(() => { h.user = AM; h.emails = []; h.writes = [] })
afterEach(() => { fake?.restore(); fake = null })

describe('asked, then answered — the round trip', () => {
  it('picking who to ask records them ON the card, not just in the email', async () => {
    fake = seed('draft_uploaded')
    h.user = ED    // the editor submits, and picks who to ask
    const r = await move('internal_review', [AM.id, AM2.id])
    await drain()
    expect(r.status).toBe(200)
    expect(item().asked_ids).toEqual([AM.id, AM2.id])
    expect(typeof item().asked_at).toBe('string')
  })

  it('one of them approves — and it is gone for BOTH, in the same write as the move', async () => {
    fake = seed('internal_review', [AM.id, AM2.id])
    // Yusuf never opens it; Divina approves
    const r = await move('approved_for_scheduling')
    await drain()
    expect(r.status).toBe(200)
    expect(item().status).toBe('approved_for_scheduling')
    expect(item().asked_ids ?? null).toBeNull()
    expect(item().asked_at ?? null).toBeNull()
    // …so neither of them still has it waiting on them
    const card = item() as never
    expect(whoseTurn('approved_for_scheduling', card, AM).mine).toBe(false)
    expect(matchesShow(card, 'decide', { viewer: AM2, today: '2026-09-07' })).toBe(false)
  })

  it('a card nobody was asked about behaves exactly as it did', async () => {
    fake = seed('draft_uploaded')
    h.user = ED
    const r = await move('internal_review')
    await drain()
    expect(r.status).toBe(200)
    expect(item().status).toBe('internal_review')
    expect(item().asked_ids ?? null).toBeNull()
    // the role rule is back in charge: both managers hold the turn
    expect(whoseTurn('internal_review', item() as never, AM).mine).toBe(true)
    expect(whoseTurn('internal_review', item() as never, AM2).mine).toBe(true)
  })

  it('the move and the clear are ONE write — never a second round trip', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'app', 'lib', 'workflow.ts'), 'utf8')
    expect(src).toMatch(/update\(item\.id, \{ status: to, \.\.\.asked \}\)/)
  })

  it('sending a card back clears the ask too', async () => {
    fake = seed('internal_review', [AM.id, AM2.id])
    const { POST: SEND_BACK } = await import('../app/api/production/items/[id]/send-back/route')
    const res = await SEND_BACK(
      new Request(`https://x.test/api/production/items/${ITEM}/send-back`, {
        method: 'POST', body: JSON.stringify({ note: 'Trim the intro' }),
      }),
      { params: Promise.resolve({ id: ITEM }) },
    )
    await drain()
    expect(res.status).toBe(200)
    expect(item().asked_ids ?? null).toBeNull()
  })

  it('handing a card over makes the person handed to the one being asked', async () => {
    fake = seed('draft_uploaded')
    const { PATCH } = await import('../app/api/production/items/[id]/route')
    const res = await PATCH(
      new Request(`https://x.test/api/production/items/${ITEM}`, {
        method: 'PATCH',
        body: JSON.stringify({ owner_id: AM2.id, hand_over: 'cut a 30s version' }),
      }),
      { params: Promise.resolve({ id: ITEM }) },
    )
    await drain()
    expect(res.status).toBe(200)
    expect(item().asked_ids).toEqual([AM2.id])
  })

  it('an ordinary change of Who is not an ask — it clears whatever stood', async () => {
    fake = seed('draft_uploaded', [AM.id])
    const { PATCH } = await import('../app/api/production/items/[id]/route')
    const res = await PATCH(
      new Request(`https://x.test/api/production/items/${ITEM}`, {
        method: 'PATCH', body: JSON.stringify({ owner_id: AM2.id }),
      }),
      { params: Promise.resolve({ id: ITEM }) },
    )
    await drain()
    expect(res.status).toBe(200)
    expect(item().asked_ids ?? null).toBeNull()
  })
})
