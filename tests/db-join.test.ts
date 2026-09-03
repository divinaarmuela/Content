import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { attachOne, attachMany } from '@/lib/db-join'

let fake: ReturnType<typeof installFakeRtdb>
beforeEach(() => { fake = installFakeRtdb({ mdm: { tables: {
  clients: { c1: { id: 'c1', name: 'Acme', timezone: 'UTC', secret: 'x' } },
  schedule_entries: { s1: { id: 's1', item_id: 'i1', published_at: 'p1' }, s2: { id: 's2', item_id: 'i1' }, s3: { id: 's3', item_id: 'i2' } },
} } }) })
afterEach(() => fake.restore())

describe('attachOne', () => {
  it('attaches the picked columns under the table name, null when missing', async () => {
    const rows = await attachOne([{ id: 'i1', client_id: 'c1' }, { id: 'i2', client_id: 'zz' }, { id: 'i3', client_id: null }], 'client_id', 'clients', ['name', 'timezone'])
    expect(rows[0].clients).toEqual({ name: 'Acme', timezone: 'UTC' })
    expect(rows[1].clients).toBeNull()
    expect(rows[2].clients).toBeNull()
  })
  it('reads the target table once', async () => {
    const n0 = fake.calls().length
    await attachOne([{ client_id: 'c1' }, { client_id: 'c1' }], 'client_id', 'clients', ['name'], 'client')
    expect(fake.calls().length - n0).toBe(1)
  })
})
describe('attachMany', () => {
  it('attaches arrays keyed by the foreign key', async () => {
    const rows = await attachMany([{ id: 'i1' }, { id: 'i9' }], 'id', 'schedule_entries', 'item_id', ['published_at'])
    expect(rows[0].schedule_entries).toEqual([{ published_at: 'p1' }, { published_at: null }])
    expect(rows[1].schedule_entries).toEqual([])
  })
})
