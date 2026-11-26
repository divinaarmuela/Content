import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * CREATOR CAMPAIGNS — the team's routes and the server half behind them, against the real `@/lib/db` on the
 * in-memory database (the owner, 25 Nov 2026: "super admins can create for any client and AM can join in … or AM
 * create theirs"). Pinned: who sees and makes a campaign; a campaign that is not yours looks like one that is not
 * there; a change made on a stale page is refused and changes nothing; the client's answer is theirs alone, only on
 * their own campaign, only while the list is open.
 */

type Who = { id: string; name: string; role: string }
let who: Who | null = { id: 'sa', name: 'Sam', role: 'super_admin' }

vi.mock('../app/lib/authz', () => {
  class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  }
  return {
    requireSignedIn: async () => {
      if (!who) throw new AuthzError('Sign in', 401)
      return { ...who, email: `${who.id}@x.invalid`, active_status: true }
    },
    AuthzError,
    authzErrorResponse: (e: unknown) => ({ error: e instanceof Error ? e.message : 'error', status: (e as { status?: number })?.status ?? 500 }),
  }
})

import { GET as LIST, POST as CREATE } from '../app/api/creators/route'
import { DELETE as DROP, GET as ONE, PATCH as CHANGE } from '../app/api/creators/[id]/route'
import { POST as ADD } from '../app/api/creators/[id]/creators/route'
import { DELETE as TAKE_OFF, PATCH as EDIT } from '../app/api/creators/[id]/creators/[rowId]/route'
import { POST as MOVE } from '../app/api/creators/[id]/creators/[rowId]/move/route'
import { GET as DIRECTORY } from '../app/api/creators/directory/route'
import { moveCreator } from '../app/lib/creator-campaigns'

const person = (id: string, name: string, role: string) => ({ id, name, role, email: `${id}@x.invalid`, active_status: true })
const seed = () => ({
  clients: [{ id: 'c1', name: 'Alia Fragrance', status: 'active', share_token: '11111111-1111-4111-8111-111111111111' }, { id: 'c2', name: 'MGMT', status: 'active' },
    { id: 'c9', name: 'A lead', status: 'lead' }] as unknown as Row[],
  team_users: [person('sa', 'Sam', 'super_admin'), person('ama', 'Ama', 'account_manager'), person('amb', 'Amb', 'account_manager'), person('ed', 'Ed', 'editor')] as unknown as Row[],
  team_user_clients: [{ id: 'ama__c1', team_user_id: 'ama', client_id: 'c1' }, { id: 'amb__c2', team_user_id: 'amb', client_id: 'c2' }] as unknown as Row[],
  creator_campaigns: [] as Row[], creators: [] as Row[], campaign_creators: [] as Row[], campaign_creator_events: [] as Row[],
})

const req = (body?: unknown, method = 'POST', url = 'http://x/api/creators') =>
  new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) })
const at = (id: string) => ({ params: Promise.resolve({ id }) })
const row = (id: string, rowId: string) => ({ params: Promise.resolve({ id, rowId }) })
const as = (id: string | null, role = 'super_admin') => { who = id ? { id, role, name: id } : null }
const out = async (res: Response) => ({ status: res.status, body: await res.json() })

const make = async (extra: Record<string, unknown> = {}) => (await out(await CREATE(req({ client_id: 'c1', title: 'Teta’s table lunch', seats: 2, ...extra })))).body.campaign
const add = async (id: string, extra: Record<string, unknown> = {}) => (await out(await ADD(req({ name: 'Lydia', instagram: '@Lydia.Eats', instagram_followers: 17900, ...extra }), at(id)))).body.creator
const move = async (id: string, rowId: string, to: string, rev: number) => out(await MOVE(req({ to, expect_rev: rev }), row(id, rowId)))

let fake: ReturnType<typeof seedDb>
// the stored rows, loosely typed: these tables' columns are read by name below
const stored = (t: Parameters<ReturnType<typeof seedDb>['rows']>[0]) => fake.rows(t) as unknown as Record<string, unknown>[]
beforeEach(() => { fake = seedDb(seed()); as('sa') })
afterEach(() => fake.restore())

describe('who makes a campaign, and for whom', () => {
  it('a super admin for any client; it starts as a draft the client cannot see', async () => {
    const c = await make({ client_id: 'c2' })
    expect(c).toMatchObject({ client_id: 'c2', status: 'draft', client_visible: false, created_by: 'sa', rev: 1, seats: 2 })
  })
  it('an account manager for their own client only', async () => {
    as('ama', 'account_manager')
    expect((await out(await CREATE(req({ client_id: 'c1', title: 'Mine' })))).status).toBe(201)
    expect((await out(await CREATE(req({ client_id: 'c2', title: 'Not mine' })))).status).toBe(403)
  })
  it('nobody else, and nobody who is not signed in', async () => {
    as('ed', 'editor')
    expect((await out(await CREATE(req({ client_id: 'c1', title: 'x' })))).status).toBe(403)
    as(null)
    expect((await LIST()).status).toBe(401)
    expect((await out(await CREATE(req({ client_id: 'c1', title: 'x' })))).status).toBe(401)
  })
  it('a client login is not let on to the team’s page at all', async () => {
    as('cl', 'client')
    expect((await LIST()).status).toBe(403)
  })
  it('it needs a client and a name', async () => {
    expect((await out(await CREATE(req({ title: 'No client' })))).body.error).toBe('Choose the client')
    expect((await out(await CREATE(req({ client_id: 'c1' })))).body.error).toBe('Give the campaign a name')
  })
})

describe('who sees a campaign', () => {
  it('the list: all of them for a super admin, their clients’ for a manager, none for an editor', async () => {
    await make(); await make({ client_id: 'c2', title: 'MGMT night' })
    const titles = async () => ((await (await LIST()).json()).campaigns as { title: string }[]).map(c => c.title).sort()
    expect(await titles()).toEqual(['MGMT night', 'Teta’s table lunch'])
    as('ama', 'account_manager'); expect(await titles()).toEqual(['Teta’s table lunch'])
    as('amb', 'account_manager'); expect(await titles()).toEqual(['MGMT night'])
    as('ed', 'editor'); expect(await titles()).toEqual([])
  })
  it('a manager is given only their own clients to choose from (never a lead)', async () => {
    as('ama', 'account_manager')
    const body = await (await LIST()).json()
    expect(body.clients).toEqual([{ id: 'c1', name: 'Alia Fragrance' }])
    expect(body.me.mayCreate).toBe(true)
    as('ed', 'editor')
    expect((await (await LIST()).json()).me.mayCreate).toBe(false)
  })
  it('a campaign that is not yours looks exactly like one that is not there — to read, change, add to or delete', async () => {
    const c = await make()
    const r = await add(c.id)
    as('amb', 'account_manager')
    expect((await ONE(req(undefined, 'GET'), at(c.id))).status).toBe(404)
    expect((await CHANGE(req({ expect_rev: 1, title: 'Hijacked' }, 'PATCH'), at(c.id))).status).toBe(404)
    expect((await ADD(req({ name: 'Sneak' }), at(c.id))).status).toBe(404)
    expect((await move(c.id, r.id, 'with_client', 1)).status).toBe(404)
    expect((await EDIT(req({ expect_rev: 1, why: 'x' }, 'PATCH'), row(c.id, r.id))).status).toBe(404)
    expect((await TAKE_OFF(req(undefined, 'DELETE'), row(c.id, r.id))).status).toBe(404)
    expect((await DROP(req(undefined, 'DELETE'), at(c.id))).status).toBe(404)
    expect(stored('creator_campaigns')[0]).toMatchObject({ title: 'Teta’s table lunch', rev: 1 })
  })
  it('a manager added to a campaign by name gets in, whoever the client is; an editor added to one may look, not change', async () => {
    const c = await make()
    const added = await out(await CHANGE(req({ expect_rev: 1, member_ids: ['amb', 'ed', 'nobody-real'] }, 'PATCH'), at(c.id)))
    expect(added.body.campaign.member_ids).toEqual(['amb', 'ed'])
    as('amb', 'account_manager')
    const seen = await out(await ONE(req(undefined, 'GET'), at(c.id)))
    expect(seen.status).toBe(200)
    expect(seen.body.may).toEqual({ edit: true, remove: false })
    expect(seen.body.portal_token).toBe('11111111-1111-4111-8111-111111111111')
    as('ed', 'editor')
    expect((await out(await ONE(req(undefined, 'GET'), at(c.id)))).body.may).toEqual({ edit: false, remove: false })
    expect((await CHANGE(req({ expect_rev: 2, title: 'x' }, 'PATCH'), at(c.id))).status).toBe(403)
    expect((await DIRECTORY(req(undefined, 'GET', 'http://x/api/creators/directory?q='))).status).toBe(403)
  })
  // Review Focus 1: a manager taken off the client loses the campaigns they made for it
  it('a manager taken off the client loses the campaign they made, unless somebody keeps them on it by name', async () => {
    as('ama', 'account_manager')
    const c = await make()
    fake.restore(); fake = seedDb({ ...seed(), team_user_clients: [] as Row[], creator_campaigns: [c] as Row[] })
    expect((await ONE(req(undefined, 'GET'), at(c.id))).status).toBe(404)
    fake.restore(); fake = seedDb({ ...seed(), team_user_clients: [] as Row[], creator_campaigns: [{ ...c, member_ids: ['ama'] }] as Row[] })
    expect((await ONE(req(undefined, 'GET'), at(c.id))).status).toBe(200)
  })
})

describe('changing a campaign', () => {
  it('the client it is for never changes', async () => {
    const c = await make()
    const res = await out(await CHANGE(req({ expect_rev: 1, client_id: 'c2', status: 'live', client_visible: true }, 'PATCH'), at(c.id)))
    expect(res.body.campaign).toMatchObject({ client_id: 'c1', status: 'live', client_visible: true, rev: 2 })
  })
  // Review Focus 2
  it('a change made on a stale page is refused with the campaign as it stands, and changes nothing', async () => {
    const c = await make()
    await CHANGE(req({ expect_rev: 1, title: 'First' }, 'PATCH'), at(c.id))
    const late = await out(await CHANGE(req({ expect_rev: 1, title: 'Second' }, 'PATCH'), at(c.id)))
    expect(late.status).toBe(409)
    expect(late.body.fresh).toMatchObject({ title: 'First', rev: 2 })
    expect(stored('creator_campaigns')[0]).toMatchObject({ title: 'First', rev: 2 })
  })
  it('a manager deletes their own draft; a live one, or somebody else’s, is a super admin’s to delete', async () => {
    as('ama', 'account_manager')
    const mine = await make()
    await add(mine.id)
    await CHANGE(req({ expect_rev: 1, status: 'live' }, 'PATCH'), at(mine.id))
    expect((await DROP(req(undefined, 'DELETE'), at(mine.id))).status).toBe(403)
    await CHANGE(req({ expect_rev: 2, status: 'draft' }, 'PATCH'), at(mine.id))
    expect((await DROP(req(undefined, 'DELETE'), at(mine.id))).status).toBe(200)
    expect(stored('creator_campaigns')).toEqual([])
    expect(stored('campaign_creators')).toEqual([])
    as('sa'); const theirs = await make()
    as('ama', 'account_manager')
    expect((await DROP(req(undefined, 'DELETE'), at(theirs.id))).status).toBe(403)
  })
})

describe('creators on a campaign', () => {
  it('a creator typed in is an idea on the campaign and is kept in the agency’s list', async () => {
    const c = await make()
    const r = await add(c.id, { why: 'Lebanese food, Melbourne', terms: 'paid', rate: '$300', samples: ['https://instagram.com/p/abc', 'javascript:alert(1)'] })
    expect(r).toMatchObject({ campaign_id: c.id, client_id: 'c1', name: 'Lydia', instagram: 'lydia.eats', instagram_followers: 17900, stage: 'idea', terms: 'paid', rate: '$300', rev: 1 })
    expect(r.samples).toEqual(['https://instagram.com/p/abc'])
    expect(r.id).toBe(`${c.id}__${r.creator_id}`)
    const found = await (await DIRECTORY(req(undefined, 'GET', 'http://x/api/creators/directory?q=@lydia'))).json()
    expect(found.creators.map((x: { name: string }) => x.name)).toEqual(['Lydia'])
  })
  it('the same person typed again is one entry in the list, and cannot be put on the same campaign twice', async () => {
    const c = await make()
    await add(c.id)
    const again = await out(await ADD(req({ name: 'Lydia H', instagram: 'lydia.eats' }), at(c.id)))
    expect(again.status).toBe(409)
    expect(stored('creators')).toHaveLength(1)
    const other = await make({ title: 'Second campaign' })
    const picked = await out(await ADD(req({ creator_id: stored('creators')[0].id, why: 'Again' }), at(other.id)))
    expect(picked.body.creator).toMatchObject({ name: 'Lydia H', instagram: 'lydia.eats', why: 'Again', stage: 'idea' })
  })
  it('a creator needs a name', async () => {
    const c = await make()
    expect((await out(await ADD(req({ instagram: 'someone' }), at(c.id)))).body.error).toBe('Type the creator’s name')
  })
  it('the stage is never changed by editing — only by a move', async () => {
    const c = await make(); const r = await add(c.id)
    const res = await out(await EDIT(req({ expect_rev: 1, stage: 'confirmed', why: 'New why' }, 'PATCH'), row(c.id, r.id)))
    expect(res.body.creator).toMatchObject({ stage: 'idea', why: 'New why', rev: 2 })
  })
  it('the team walks a creator along, each move leaving a line of history; a move the rules do not allow is refused', async () => {
    const c = await make(); const r = await add(c.id)
    expect((await move(c.id, r.id, 'confirmed', 1)).status).toBe(409)
    expect((await move(c.id, r.id, 'with_client', 1)).body.creator).toMatchObject({ stage: 'with_client', rev: 2 })
    const yes = await move(c.id, r.id, 'approved', 2)
    expect(yes.body.creator).toMatchObject({ stage: 'approved', decided_by: 'sa' })
    expect((await move(c.id, r.id, 'invited', 3)).body.creator.stage).toBe('invited')
    expect((await move(c.id, r.id, 'confirmed', 4)).body.creator.stage).toBe('confirmed')
    expect(stored('campaign_creator_events').map(e => `${e.from}>${e.to}:${e.actor}`).sort())
      .toEqual(['approved>invited:team', 'idea>with_client:team', 'invited>confirmed:team', 'with_client>approved:team'])
  })
  // Review Focus 2, on a creator
  it('two people moving the same creator: one wins, the other is handed the row as it stands', async () => {
    const c = await make(); const r = await add(c.id)
    await move(c.id, r.id, 'with_client', 1)
    const late = await move(c.id, r.id, 'with_client', 1)
    expect(late.status).toBe(409)
    expect(late.body.fresh).toMatchObject({ stage: 'with_client', rev: 2 })
    expect(stored('campaign_creator_events')).toHaveLength(1)
  })
  it('a creator the client has seen is not taken off the list; an idea is', async () => {
    const c = await make(); const r = await add(c.id); const idea = await add(c.id, { name: 'Zed', instagram: 'zed' })
    await move(c.id, r.id, 'with_client', 1)
    expect((await TAKE_OFF(req(undefined, 'DELETE'), row(c.id, r.id))).status).toBe(409)
    expect((await TAKE_OFF(req(undefined, 'DELETE'), row(c.id, idea.id))).status).toBe(200)
    expect(stored('campaign_creators').map(x => x.name)).toEqual(['Lydia'])
  })
  it('the card on the list counts seats and who is waiting on the client', async () => {
    const c = await make(); const a = await add(c.id); const b = await add(c.id, { name: 'Zed', instagram: 'zed' })
    await move(c.id, a.id, 'with_client', 1); await move(c.id, b.id, 'with_client', 1)
    await move(c.id, a.id, 'approved', 2); await move(c.id, a.id, 'invited', 3); await move(c.id, a.id, 'confirmed', 4)
    const card = (await (await LIST()).json()).campaigns[0]
    expect(card).toMatchObject({ client_name: 'Alia Fragrance', with_client: 1, creators: 2 })
    expect(card.counts).toMatchObject({ seats: 2, confirmed: 1, waiting: 0, open: 1, over: false })
  })
})

describe('the client’s answer', () => {
  const client = (clientId = 'c1') => ({ kind: 'client' as const, clientId, actorId: 'portal-c1' })
  const open = async () => {
    const c = await make(); const r = await add(c.id)
    await CHANGE(req({ expect_rev: 1, status: 'live', client_visible: true }, 'PATCH'), at(c.id))
    await move(c.id, r.id, 'with_client', 1)
    return { c, r }
  }
  it('approves or passes on a creator put in front of them, with a note, and may change a no to a yes', async () => {
    const { c, r } = await open()
    const no = await moveCreator(client(), c.id, r.id, 'passed', 2, '  Not our audience ')
    expect(no).toMatchObject({ ok: true, value: { stage: 'passed', client_note: 'Not our audience', decided_by: 'portal-c1' } })
    const yes = await moveCreator(client(), c.id, r.id, 'approved', 3)
    expect(yes).toMatchObject({ ok: true, value: { stage: 'approved' } })
    expect((await moveCreator(client(), c.id, r.id, 'passed', 4))).toMatchObject({ ok: false, status: 409 })
    expect(stored('campaign_creator_events').filter(e => e.actor === 'client')).toHaveLength(2)
  })
  it('never moves an idea the team has not shown them', async () => {
    const { c } = await open(); const idea = await add(c.id, { name: 'Zed', instagram: 'zed' })
    expect(await moveCreator(client(), c.id, idea.id, 'approved', 1)).toMatchObject({ ok: false, status: 409 })
  })
  // Review Focus 5
  it('another client’s campaign is not there, and nothing about it comes back', async () => {
    const { c, r } = await open()
    const res = await moveCreator(client('c2'), c.id, r.id, 'approved', 2)
    expect(res).toEqual({ ok: false, status: 404, reason: 'That campaign is not here' })
    expect(stored('campaign_creators')[0].stage).toBe('with_client')
  })
  // Review Focus 3
  it('no answer is taken once the team hides the campaign, closes it, or the closing day has passed', async () => {
    const { c, r } = await open()
    await CHANGE(req({ expect_rev: 2, client_visible: false }, 'PATCH'), at(c.id))
    expect(await moveCreator(client(), c.id, r.id, 'approved', 2)).toMatchObject({ ok: false, status: 403, reason: 'This list is not open' })
    await CHANGE(req({ expect_rev: 3, client_visible: true, closes_on: '2020-01-01' }, 'PATCH'), at(c.id))
    const late = await moveCreator(client(), c.id, r.id, 'approved', 2)
    expect(late).toMatchObject({ ok: false, status: 403 })
    expect((late as { reason: string }).reason).toMatch(/^This list closed on /)
    expect(stored('campaign_creators')[0].stage).toBe('with_client')
  })
})
