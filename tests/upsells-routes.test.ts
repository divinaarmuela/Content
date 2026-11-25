import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE UPSELL TRACKER'S SERVER HALF, against the real `@/lib/db` on the in-memory database (Divina, 25 Nov 2026:
 * "shared only between Manal, Karly, Yusuf, Renee"; the owner: "super admins can log or these people can log").
 * Pinned: the tracker refuses anyone it is not opened to; a person logs for their own clients and changes their
 * own rows; only a super admin says the client has paid; a row somebody else changed is not overwritten.
 */

type Who = { id: string; name: string; role: string }
let who: Who = { id: 'manal', name: 'Manal', role: 'account_manager' }

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => ({ ...who, email: `${who.id}@x.invalid`, active_status: true }),
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({ error: e instanceof Error ? e.message : 'error', status: (e as { status?: number })?.status ?? 500 }),
}))

import { GET, POST } from '../app/api/upsells/route'
import { DELETE, PATCH } from '../app/api/upsells/[id]/route'

const PAGE = '/dashboard/upsells'
const person = (id: string, name: string, role: string) => ({ id, name, role, email: `${id}@x.invalid`, active_status: true })
const seed = () => ({
  clients: [{ id: 'c1', name: 'Alia Fragrance', status: 'active' }, { id: 'c2', name: 'MGMT', status: 'active' }, { id: 'c9', name: 'A lead', status: 'lead' }] as unknown as Row[],
  team_users: [person('divina', 'Divina', 'super_admin'), person('manal', 'Manal', 'account_manager'), person('karly', 'Karly', 'account_manager'),
    person('james', 'James', 'account_manager'), person('ed', 'Ed', 'editor')] as unknown as Row[],
  team_user_clients: [{ id: 'manal__c1', team_user_id: 'manal', client_id: 'c1' }, { id: 'karly__c2', team_user_id: 'karly', client_id: 'c2' },
    { id: 'james__c1', team_user_id: 'james', client_id: 'c1' }] as unknown as Row[],
  // the page is opened to Manal and Karly by name; James is an account manager without it
  user_page_access: [{ id: 'manal__u', team_user_id: 'manal', href: PAGE }, { id: 'karly__u', team_user_id: 'karly', href: PAGE }] as unknown as Row[],
  upsells: [] as Row[],
})

const json = (body: unknown, method = 'POST') => new Request('http://x/api/upsells', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const at = (id: string) => ({ params: Promise.resolve({ id }) })
const as = (id: string, role: string, name = id) => { who = { id, role, name } }
const log = async (body: Record<string, unknown>) => { const res = await POST(json(body)); return { status: res.status, body: await res.json() } }
const VIDEO = { client_id: 'c1', service_key: 'extra_half_day_video', amount: 2385 }

let fake: ReturnType<typeof seedDb>
beforeEach(() => { fake = seedDb(seed()); as('manal', 'account_manager', 'Manal') })
afterEach(() => fake.restore())

describe('who the tracker opens for', () => {
  it('a super admin, and a person it is opened to by name', async () => {
    expect((await GET()).status).toBe(200)
    as('divina', 'super_admin')
    expect((await GET()).status).toBe(200)
  })
  it('not an account manager it was never opened to, and not an editor — reading or logging', async () => {
    for (const [id, role] of [['james', 'account_manager'], ['ed', 'editor']] as const) {
      as(id, role)
      expect((await GET()).status, id).toBe(403)
      expect((await log(VIDEO)).status, id).toBe(403)
      expect((await PATCH(json({ expect_rev: 1, stage: 'won' }, 'PATCH'), at('any'))).status, id).toBe(403)
      expect((await DELETE(new Request('http://x'), at('any'))).status, id).toBe(403)
    }
  })
  it('the list comes with the person\'s own clients (never a lead) and who is on the tracker', async () => {
    const body = await (await GET()).json()
    expect(body.clients).toEqual([{ id: 'c1', name: 'Alia Fragrance' }])
    expect(body.people.map((p: { name: string }) => p.name)).toEqual(['Divina', 'Karly', 'Manal'])
    expect(body.me).toMatchObject({ id: 'manal', mayMarkPaid: false })
    as('divina', 'super_admin')
    expect((await (await GET()).json()).clients.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2'])
  })
})

describe('logging an upsell', () => {
  it('is yours, starts as an idea, and carries the service\'s own name and billing', async () => {
    const { status, body } = await log(VIDEO)
    expect(status).toBe(201)
    expect(body.row).toMatchObject({ client_name: 'Alia Fragrance', service_name: 'Extra half-day video shoot', billing: 'one_off', amount: 2385,
      stage: 'logged', paid: false, months_paid: 0, pitched_by: 'manal', pitched_by_name: 'Manal', created_by: 'manal', rev: 1 })
  })
  it('logged straight as pitched keeps the day it was pitched', async () => {
    const { body } = await log({ ...VIDEO, stage: 'pitched' })
    expect(body.row.stage).toBe('pitched')
    expect(body.row.pitched_at).toBeTruthy()
  })
  it('needs a client, a service and an amount — each said plainly', async () => {
    expect((await log({ service_key: 'extra_half_day_video', amount: 2385 })).body.error).toBe('Choose the client')
    expect((await log({ client_id: 'c1', amount: 2385 })).body.error).toBe('Choose the service')
    expect((await log({ client_id: 'c1', service_key: 'extra_half_day_video', amount: 'lots' })).body.error).toBe('Enter the amount, in dollars')
  })
  it('is refused for a client that is not yours', async () => {
    const { status, body } = await log({ ...VIDEO, client_id: 'c2' })
    expect(status).toBe(403)
    expect(body.error).toBe('That client is not one of yours')
  })
  it('only a super admin logs one for somebody else — and only for somebody on the tracker', async () => {
    expect((await log({ ...VIDEO, pitched_by: 'karly' })).status).toBe(403)
    as('divina', 'super_admin', 'Divina')
    expect((await log({ ...VIDEO, pitched_by: 'karly' })).body.row).toMatchObject({ pitched_by: 'karly', pitched_by_name: 'Karly', created_by: 'divina' })
    expect((await log({ ...VIDEO, pitched_by: 'james' })).body.error).toBe('That person is not on the upsell tracker')
  })
})

describe('changing a row', () => {
  const patch = async (id: string, body: Record<string, unknown>) => { const res = await PATCH(json(body, 'PATCH'), at(id)); return { status: res.status, body: await res.json() } }
  const made = async () => (await log({ ...VIDEO, stage: 'pitched' })).body.row as { id: string; rev: number }

  it('its own person moves it to Won, and the version moves on', async () => {
    const row = await made()
    const { status, body } = await patch(row.id, { expect_rev: 1, stage: 'won' })
    expect(status).toBe(200)
    expect(body.row).toMatchObject({ stage: 'won', rev: 2 })
    expect(body.row.won_at).toBeTruthy()
  })
  it('a teammate on the tracker reads it and cannot change it', async () => {
    const row = await made()
    as('karly', 'account_manager', 'Karly')
    expect((await patch(row.id, { expect_rev: 1, amount: 1 })).status).toBe(403)
  })
  it('the person on commission cannot tick their own paid; a super admin can, once it is won', async () => {
    const row = await made()
    expect((await patch(row.id, { expect_rev: 1, paid: true })).status).toBe(403)
    as('divina', 'super_admin')
    expect((await patch(row.id, { expect_rev: 1, paid: true })).body.error).toBe('Mark it Won before marking it paid')
    expect((await patch(row.id, { expect_rev: 1, stage: 'won', paid: true })).body.row).toMatchObject({ stage: 'won', paid: true, rev: 2 })
  })
  it('a monthly fee is paid month by month, three at most', async () => {
    as('divina', 'super_admin', 'Divina')
    const row = (await log({ client_id: 'c1', service_key: 'meta_ads_management', amount: 1850, stage: 'won' })).body.row
    expect((await patch(row.id, { expect_rev: 1, months_paid: 4 })).status).toBe(400)
    expect((await patch(row.id, { expect_rev: 1, months_paid: 2 })).body.row).toMatchObject({ months_paid: 2, paid: false, rev: 2 })
    expect((await patch(row.id, { expect_rev: 2, months_paid: 3 })).body.row).toMatchObject({ months_paid: 3, paid: true })
  })
  it('a win that falls through is no longer paid', async () => {
    as('divina', 'super_admin')
    const row = (await log({ ...VIDEO, stage: 'won' })).body.row
    await patch(row.id, { expect_rev: 1, paid: true })
    expect((await patch(row.id, { expect_rev: 2, stage: 'lost' })).body.row).toMatchObject({ stage: 'lost', paid: false, paid_at: null })
  })
  it('a row somebody else changed in the meantime is not overwritten — the fresh row comes back', async () => {
    const row = await made()
    await patch(row.id, { expect_rev: 1, amount: 2500 })
    const stale = await patch(row.id, { expect_rev: 1, amount: 2000 })
    expect(stale.status).toBe(409)
    expect(stale.body.row).toMatchObject({ amount: 2500, rev: 2 })
  })
  it('a row that is gone says so', async () => {
    expect((await patch('nope', { expect_rev: 1, stage: 'won' })).status).toBe(404)
  })
})

describe('deleting a row', () => {
  it('its own person, before it is won; after that only a super admin', async () => {
    const a = (await log({ ...VIDEO, stage: 'pitched' })).body.row
    const b = (await log({ ...VIDEO, stage: 'won' })).body.row
    expect((await DELETE(new Request('http://x'), at(b.id))).status).toBe(403)
    expect((await DELETE(new Request('http://x'), at(a.id))).status).toBe(200)
    as('divina', 'super_admin')
    expect((await DELETE(new Request('http://x'), at(b.id))).status).toBe(200)
    expect((await (await GET()).json()).rows).toEqual([])
  })
})
