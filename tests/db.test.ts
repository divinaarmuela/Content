import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { table, withRequestCache, DbError, listTables } from '@/lib/db'
import type { Client, ContentItem } from '@/lib/db-types'

let fake: ReturnType<typeof installFakeRtdb>
const seed = () => ({ mdm: { tables: {
  clients: { c1: { id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' }, c2: { id: 'c2', name: 'Bee' } },
  content_items: {
    i1: { id: 'i1', client_id: 'c1', status: 'draft', title: 'A', updated_at: '2026-01-02T00:00:00Z' },
    i2: { id: 'i2', client_id: 'c1', status: 'approved', title: 'B', updated_at: '2026-01-03T00:00:00Z' },
    i3: { id: 'i3', client_id: 'c2', status: 'draft', title: 'C', updated_at: '2026-01-01T00:00:00Z' },
  },
  team_users: { u1: { id: 'u1', email: 'a@x.com', name: 'A' } },
}, uniq: { team_users: { email: { 'a@x%2Ecom': 'u1' } } } } })

beforeEach(() => { fake = installFakeRtdb(seed()) })
afterEach(() => fake.restore())

describe('table().get / list', () => {
  it('get returns the row with nullable columns normalised to null', async () => {
    const c = await table<Client>('clients').get('c2')
    expect(c?.name).toBe('Bee')
    expect(c?.timezone).toBeNull()
    expect(await table<Client>('clients').get('nope')).toBeNull()
  })
  it('list with by pushes one equality down as an indexed query', async () => {
    const rows = await table<ContentItem>('content_items').list({ by: { client_id: 'c1' } })
    expect(rows.map(r => r.id).sort()).toEqual(['i1', 'i2'])
    expect(fake.calls().at(-1)!.path).toBe('/mdm/tables/content_items')
  })
  it('where, orderBy desc, limit', async () => {
    const rows = await table<ContentItem>('content_items').list({ where: r => r.status === 'draft', orderBy: [['updated_at', 'desc']], limit: 1 })
    expect(rows.map(r => r.id)).toEqual(['i1'])
  })
  it('count', async () => {
    expect(await table<ContentItem>('content_items').count({ by: { status: 'draft' } })).toBe(2)
  })
  it('empty table lists as []', async () => {
    expect(await table('website' as any).list()).toEqual([])
  })
})

describe('table() writes', () => {
  it('insert mints a uuid, strips nulls, returns the row', async () => {
    const row = await table<ContentItem>('content_items').insert({ client_id: 'c2', status: 'draft', title: 'D', due_date: null } as any)
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.tree().mdm.tables.content_items[row.id].due_date).toBeUndefined()
    expect(row.due_date).toBeNull()
  })
  it('update stamps updated_at on trigger tables and returns null for a missing row', async () => {
    const before = Date.now()
    const row = await table<ContentItem>('content_items').update('i1', { title: 'Z' })
    expect(row?.title).toBe('Z')
    expect(Date.parse(row!.updated_at as string)).toBeGreaterThanOrEqual(before - 1000)
    expect(await table<ContentItem>('content_items').update('nope', { title: 'Z' })).toBeNull()
  })
  it('remove and removeWhere', async () => {
    await table('clients').remove('c2')
    expect(fake.tree().mdm.tables.clients.c2).toBeUndefined()
    expect(await table<ContentItem>('content_items').removeWhere(r => r.client_id === 'c1')).toBe(2)
    expect(Object.keys(fake.tree().mdm.tables.content_items)).toEqual(['i3'])
  })
  it('upsert onConflict updates the existing row', async () => {
    const r = await table<Client>('clients').upsert({ name: 'Acme', timezone: 'UTC' } as any, { onConflict: 'name' })
    expect(r.id).toBe('c1')
    expect(fake.tree().mdm.tables.clients.c1.timezone).toBe('UTC')
  })
  it('unique columns are enforced through /uniq', async () => {
    await expect(table('team_users').insert({ email: 'a@x.com', name: 'Dup' } as any)).rejects.toMatchObject({ code: 'unique' })
    const u = await table('team_users').insert({ email: 'b@x.com', name: 'B' } as any)
    expect(fake.tree().mdm.uniq.team_users.email['b@x%2Ecom']).toBe(u.id)
    await table('team_users').remove(u.id)
    expect(fake.tree().mdm.uniq.team_users.email['b@x%2Ecom']).toBeUndefined()
  })
  it('natural-key tables derive their id', async () => {
    const r = await table('team_user_clients').insert({ team_user_id: 'u1', client_id: 'c1' } as any)
    expect(r.id).toBe('u1__c1')
  })
})

describe('withRequestCache', () => {
  it('dedupes reads inside one request and invalidates on write', async () => {
    await withRequestCache(async () => {
      const n0 = fake.calls().length
      await table('clients').list(); await table('clients').list(); await table('clients').get('c1')
      expect(fake.calls().length - n0).toBe(1)
      await table('clients').update('c1', { name: 'New' })
      const c = await table<Client>('clients').get('c1')
      expect(c?.name).toBe('New')
    })
  })
  it('outside a request cache every read hits the network', async () => {
    const n0 = fake.calls().length
    await table('clients').list(); await table('clients').list()
    expect(fake.calls().length - n0).toBe(2)
  })
})

describe('errors and misc', () => {
  it('listTables reads the shallow key list', async () => {
    expect(await listTables()).toEqual(['clients', 'content_items', 'team_users'])
  })
  it('a non-2xx becomes DbError network', async () => {
    fake.restore()
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as any
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://fake.firebasedatabase.app'
    await expect(table('clients').list()).rejects.toBeInstanceOf(DbError)
  })
})
