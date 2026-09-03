import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { table, withRequestCache, DbError, listTables, rtdbFetch, encodeKey } from '@/lib/db'
import type { Table } from '@/lib/db'
import type { Client, ContentItem, ClientBrand, ScanMailbox } from '@/lib/db-types'

let fake: ReturnType<typeof installFakeRtdb>
const seed = () => ({ mdm: { tables: {
  clients: { c1: { id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' }, c2: { id: 'c2', name: 'Bee' } },
  content_items: {
    i1: { id: 'i1', client_id: 'c1', status: 'draft', title: 'A', updated_at: '2026-01-02T00:00:00Z' },
    i2: { id: 'i2', client_id: 'c1', status: 'approved', title: 'B', updated_at: '2026-01-03T00:00:00Z' },
    i3: { id: 'i3', client_id: 'c2', status: 'draft', title: 'C', updated_at: '2026-01-01T00:00:00Z' },
  },
  team_users: { u1: { id: 'u1', email: 'a@x.com', name: 'A' } },
  work_kinds: { w1: { id: 'w1', slug: 'edit', name: 'Edit', client_id: 'c1' }, w2: { id: 'w2', slug: 'graphics', name: 'Graphics', client_id: 'c2' } },
  client_brand: { c1: { id: 'c1', client_id: 'c1', profile: { voice: 'friendly' }, docs: ['doc1'], updated_at: '2026-01-01T00:00:00Z', updated_by: 'system' } },
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

  // Regression coverage for the production bug: encodeKey() puts literal `%`
  // escapes INSIDE a path segment (e.g. `.` -> `%2E`), and the real Firebase
  // REST server URL-decodes each segment before resolving it. Unless the
  // transport re-encodes `%` as `%25`, the server's decode undoes encodeKey's
  // escaping and hands back an illegal key (a bare `.`) — 400 "Invalid path".
  it('round-trips a natural-key row whose id is an encoded email', async () => {
    const row = await table<ScanMailbox>('scan_mailboxes').insert({ email: 'a.b@x.com', enabled: true, source: 'gmail' } as any)
    expect(row.id).toBe(encodeKey('a.b@x.com'))
    const back = await table<ScanMailbox>('scan_mailboxes').get(encodeKey('a.b@x.com'))
    expect(back?.email).toBe('a.b@x.com')
    // the wire path must carry the DOUBLY-escaped key (`%` re-encoded to
    // `%25`) so the server's one decode pass lands back on encodeKey's output
    const getCall = fake.calls().find(c => c.method === 'GET' && c.path.includes('scan_mailboxes'))
    expect(getCall?.path).toContain('%25')
  })
  it('a uniq lookup for an email key round-trips and rejects a second claim', async () => {
    const row = await table('team_users').insert({ email: 'a.b@x.com', name: 'First' } as any)
    expect(fake.tree().mdm.uniq.team_users.email[encodeKey('a.b@x.com')]).toBe(row.id)
    await expect(table('team_users').insert({ email: 'a.b@x.com', name: 'Second' } as any)).rejects.toBeInstanceOf(DbError)
    await expect(table('team_users').insert({ email: 'a.b@x.com', name: 'Second' } as any)).rejects.toMatchObject({ code: 'unique' })
    const uniqCall = fake.calls().find(c => c.path.includes('/uniq/team_users/email/'))
    expect(uniqCall?.path).toContain('%25')
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
  it('fresh:true re-reads past the cache, and what it finds replaces it', async () => {
    await withRequestCache(async () => {
      const n0 = fake.calls().length
      expect((await table<Client>('clients').get('c1'))?.name).toBe('Acme')
      // somebody else's write, behind this request's back
      fake.tree().mdm.tables.clients.c1.name = 'Renamed elsewhere'

      // the cached read cannot see it — which is why a guard needs `fresh`
      expect((await table<Client>('clients').get('c1'))?.name).toBe('Acme')
      expect(fake.calls().length - n0).toBe(1)

      expect((await table<Client>('clients').get('c1', { fresh: true }))?.name)
        .toBe('Renamed elsewhere')
      expect(fake.calls().length - n0).toBe(2)

      // and the fresh answer is now the cached one
      expect((await table<Client>('clients').get('c1'))?.name).toBe('Renamed elsewhere')
      expect(fake.calls().length - n0).toBe(2)
    })
  })
  it('fresh:true works for list() too', async () => {
    await withRequestCache(async () => {
      expect((await table<Client>('clients').list()).map(c => c.name).sort())
        .toEqual(['Acme', 'Bee'])
      fake.tree().mdm.tables.clients.c3 = { id: 'c3', name: 'Cee' }

      expect((await table<Client>('clients').list())).toHaveLength(2)
      expect((await table<Client>('clients').list({ fresh: true }))).toHaveLength(3)
      expect((await table<Client>('clients').list())).toHaveLength(3)
    })
  })
})

describe('errors and misc', () => {
  it('listTables reads the shallow key list', async () => {
    expect(await listTables()).toEqual(['client_brand', 'clients', 'content_items', 'team_users', 'work_kinds'])
  })
  it('a non-2xx becomes DbError network', async () => {
    fake.restore()
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as any
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://fake.firebasedatabase.app'
    await expect(table('clients').list()).rejects.toBeInstanceOf(DbError)
  })
})

describe('indexed pushdown', () => {
  it('list({ by: { slug } }) on an unindexed column reads the whole table, no query string', async () => {
    const rows = await table('work_kinds').list({ by: { slug: 'edit' } } as any)
    expect(rows.map((r: any) => r.id)).toEqual(['w1'])
    expect(fake.calls().at(-1)!.query).toBe('')
  })
  it('list({ by: { slug, client_id } }) pushes the indexed client_id down instead of slug', async () => {
    const rows = await table('work_kinds').list({ by: { slug: 'edit', client_id: 'c1' } } as any)
    expect(rows.map((r: any) => r.id)).toEqual(['w1'])
    expect(fake.calls().at(-1)!.query).toContain(encodeURIComponent('"client_id"'))
  })
})

describe('unique-claim atomicity', () => {
  it('a losing write is rejected at the database (401/403), not just by the local pre-check', async () => {
    ;(fake.tree() as any).mdm.uniq = { x: { f: { k: 'owner1' } } }
    await expect(
      rtdbFetch('/mdm', { method: 'PATCH', body: JSON.stringify({ 'uniq/x/f/k': 'owner2' }), table: 'x' }),
    ).rejects.toMatchObject({ code: 'unique', message: expect.stringContaining('x') })
  })
})

describe('natural-key upsert/insert', () => {
  it('upsert on a natural-key table merges into the existing row instead of dropping fields', async () => {
    const r = await table<ClientBrand>('client_brand').upsert({ client_id: 'c1', profile: { voice: 'bold' } } as any)
    expect(r.id).toBe('c1')
    expect(r.profile).toEqual({ voice: 'bold' })
    expect(fake.tree().mdm.tables.client_brand.c1.docs).toEqual(['doc1'])
  })
  it('insert on a natural-key table rejects a row that already exists', async () => {
    await expect(table<ClientBrand>('client_brand').insert({ client_id: 'c1', profile: {} } as any)).rejects.toMatchObject({ code: 'unique' })
  })
})

describe('compare-and-set', () => {
  it('getForUpdate returns the row and an ETag, and a null row for a missing id', async () => {
    const a = await table<Client>('clients').getForUpdate('c1')
    expect(a.row?.name).toBe('Acme')
    expect(a.etag).toBeTruthy()
    const b = await table<Client>('clients').getForUpdate('nope')
    expect(b.row).toBeNull()
    expect(b.etag).toBe('null_etag')
  })
  it('getForUpdate always sees the network, even inside a request cache', async () => {
    await withRequestCache(async () => {
      expect((await table<Client>('clients').get('c1'))?.name).toBe('Acme')
      fake.tree().mdm.tables.clients.c1.name = 'Renamed elsewhere'
      expect((await table<Client>('clients').getForUpdate('c1')).row?.name).toBe('Renamed elsewhere')
      // and what it found replaces the cached copy
      expect((await table<Client>('clients').get('c1'))?.name).toBe('Renamed elsewhere')
    })
  })
  it('compareAndSet writes on a matching etag and stamps updated_at', async () => {
    const items = table<ContentItem>('content_items')
    const { row, etag } = await items.getForUpdate('i1')
    const res = await items.compareAndSet('i1', etag, { ...row!, title: 'CAS' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.row.title).toBe('CAS')
    expect(fake.tree().mdm.tables.content_items.i1.title).toBe('CAS')
    expect(fake.tree().mdm.tables.content_items.i1.updated_at).not.toBe('2026-01-02T00:00:00Z')
  })
  it('compareAndSet loses quietly on a stale etag and hands back the current row', async () => {
    const items = table<ContentItem>('content_items')
    const { row, etag } = await items.getForUpdate('i1')
    // somebody else writes first
    await items.update('i1', { title: 'Theirs' })
    const res = await items.compareAndSet('i1', etag, { ...row!, title: 'Mine' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.current?.title).toBe('Theirs')
      expect(res.etag).toBeTruthy()
      // the handed-back etag is usable: retrying with it wins
      const again = await items.compareAndSet('i1', res.etag, { ...res.current!, title: 'Mine' })
      expect(again.ok).toBe(true)
    }
    expect(fake.tree().mdm.tables.content_items.i1.title).toBe('Mine')
  })
  it('compareAndSet creates a row that does not exist yet, and only one creator wins', async () => {
    const locks = table('claim_locks')
    const { row, etag } = await locks.getForUpdate('publish__i1')
    expect(row).toBeNull()
    const first = await locks.compareAndSet('publish__i1', etag, { id: 'publish__i1', holder: 'a' } as any)
    expect(first.ok).toBe(true)
    const second = await locks.compareAndSet('publish__i1', etag, { id: 'publish__i1', holder: 'b' } as any)
    expect(second.ok).toBe(false)
    expect(fake.tree().mdm.tables.claim_locks.publish__i1.holder).toBe('a')
  })
  it('compareAndSet refuses to move a unique column at all — free value or not', async () => {
    const t = table('team_users')
    const { row, etag } = await t.getForUpdate('u1')
    // nobody holds this address, and it is still refused: the unique key
    // lives in a second node that one conditional PUT cannot cover
    await expect(t.compareAndSet('u1', etag, { ...row!, email: 'nobody@x.com' } as any))
      .rejects.toMatchObject({ code: 'unique', message: expect.stringContaining('cannot change through compareAndSet') })
    // …and one another row already owns is refused too
    await table('team_users').insert({ email: 'b@x.com', name: 'B' } as any)
    const again = await t.getForUpdate('u1')
    await expect(t.compareAndSet('u1', again.etag, { ...again.row!, email: 'b@x.com' } as any))
      .rejects.toMatchObject({ code: 'unique' })
    // clearing one is a change as well
    await expect(t.compareAndSet('u1', again.etag, { ...again.row!, email: null } as any))
      .rejects.toMatchObject({ code: 'unique' })
    // and everything else on the row still writes
    const ok = await t.compareAndSet('u1', again.etag, { ...again.row!, name: 'Renamed' } as any)
    expect(ok.ok).toBe(true)
    expect(fake.tree().mdm.tables.team_users.u1.name).toBe('Renamed')
  })

  it('compareAndSet creating a row may claim a free unique key, but not a taken one', async () => {
    const t = table('team_users')
    const { etag } = await t.getForUpdate('u9')
    const made = await t.compareAndSet('u9', etag, { id: 'u9', email: 'fresh@x.com', name: 'New' } as any)
    expect(made.ok).toBe(true)
    const other = await t.getForUpdate('u8')
    await expect(t.compareAndSet('u8', other.etag, { id: 'u8', email: 'a@x.com', name: 'Thief' } as any))
      .rejects.toMatchObject({ code: 'unique' })
  })

  it('getForUpdate drops the filtered query variants too, not just the whole-table read', async () => {
    await withRequestCache(async () => {
      const rows = await table<ContentItem>('content_items').list({ by: { client_id: 'c1' } })
      expect(rows).toHaveLength(2)
      // an indexed orderBy/equalTo slice is cached under its own key
      fake.tree().mdm.tables.content_items.i9 = { id: 'i9', client_id: 'c1', status: 'draft', title: 'New' }
      expect(await table<ContentItem>('content_items').list({ by: { client_id: 'c1' } })).toHaveLength(2)

      await table<ContentItem>('content_items').getForUpdate('i1')
      // the stale slice is gone, so the next read sees the row written since
      expect(await table<ContentItem>('content_items').list({ by: { client_id: 'c1' } })).toHaveLength(3)
    })
  })
  it('claim runs the mutation on the winning read and reports the loser', async () => {
    const items = table<ContentItem>('content_items')
    const won = await items.claim('i1', cur => cur && cur.status === 'draft' ? { ...cur, status: 'approved' } : null)
    expect(won.claimed).toBe(true)
    const lost = await items.claim('i1', cur => cur && cur.status === 'draft' ? { ...cur, status: 'approved' } : null)
    expect(lost.claimed).toBe(false)
    if (!lost.claimed) expect(lost.current?.status).toBe('approved')
  })
  it('claim re-runs the mutation on the fresh row when it loses the race, and exactly one claimant wins', async () => {
    const items = table<ContentItem>('content_items')
    let mutations = 0
    // a rival takes the seat between this claimant's read and its write, once
    const off = fake.onBeforeWrite('/mdm/tables/content_items/i1', () => {
      off()
      fake.tree().mdm.tables.content_items.i1.owner_id = 'rival'
    })
    const res = await items.claim('i1', cur => {
      mutations++
      return cur && cur.owner_id == null ? { ...cur, owner_id: 'me' } : null
    })
    expect(mutations).toBe(2)              // read, lost, re-read, decided again
    expect(res.claimed).toBe(false)        // the rival holds it — no overwrite
    expect(fake.tree().mdm.tables.content_items.i1.owner_id).toBe('rival')
  })
  it('claim gives up after `attempts` conditional writes rather than spinning', async () => {
    const items = table<ContentItem>('content_items')
    let n = 0
    fake.onBeforeWrite('/mdm/tables/content_items/i1', () => {
      fake.tree().mdm.tables.content_items.i1.title = `moved ${++n}`
    })
    const res = await items.claim('i1', cur => cur ? { ...cur, status: 'approved' } : null, { attempts: 2 })
    expect(res.claimed).toBe(false)
    expect(n).toBe(2)
  })
})

describe('typed write safety', () => {
  it('rejects an unknown property on a typed table at compile time', () => {
    const check = (t: Table<Client>) => {
      // @ts-expect-error 'nmae' is not a key of Client — a full type argument must catch this typo
      t.update('c1', { nmae: 'x' })
    }
    expect(typeof check).toBe('function')
  })
})

describe('update / removeWhere with unique columns', () => {
  it('update clears the old unique claim and claims the new value in one PATCH', async () => {
    const updated = await table('team_users').update('u1', { email: 'c@x.com' } as any)
    expect(updated?.email).toBe('c@x.com')
    expect(fake.tree().mdm.uniq.team_users.email[encodeKey('a@x.com')]).toBeUndefined()
    expect(fake.tree().mdm.uniq.team_users.email[encodeKey('c@x.com')]).toBe('u1')
  })
  it('update rejects when the new unique value is already claimed by another row', async () => {
    await table('team_users').insert({ email: 'b@x.com', name: 'B' } as any)
    await expect(table('team_users').update('u1', { email: 'b@x.com' } as any)).rejects.toMatchObject({ code: 'unique' })
  })
  it('removeWhere clears unique claims for every removed row', async () => {
    await table('team_users').insert({ email: 'b@x.com', name: 'B' } as any)
    const n = await table('team_users').removeWhere(() => true)
    expect(n).toBe(2)
    expect(fake.tree().mdm.uniq).toBeUndefined()
  })
})
