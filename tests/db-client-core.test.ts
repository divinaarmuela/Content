import { describe, it, expect } from 'vitest'
import { snapshotToRows, applyQuery } from '@/lib/db-client'
import { pickPushdown, INDEXED_COLUMNS } from '@/lib/db-indexes'

describe('db-client pure parts', () => {
  it('snapshotToRows normalises nullable columns and injects id', () => {
    const rows = snapshotToRows<any>('content_items', { i1: { title: 'A' }, i2: { id: 'i2', title: 'B', due_date: 'd' } })
    expect(rows.find(r => r.id === 'i1')?.due_date).toBeNull()
    expect(rows.find(r => r.id === 'i2')?.due_date).toBe('d')
    expect(snapshotToRows('content_items', null)).toEqual([])
  })
  it('applyQuery filters, sorts, limits', () => {
    const out = applyQuery([{ n: 2, s: 'x' }, { n: 1, s: 'x' }, { n: 3, s: 'y' }], { where: r => r.s === 'x', orderBy: [['n', 'desc']], limit: 1 })
    expect(out).toEqual([{ n: 2, s: 'x' }])
  })
})

describe('pickPushdown', () => {
  it('returns null when there is no `by`', () => {
    expect(pickPushdown(undefined)).toBeNull()
    expect(pickPushdown(null)).toBeNull()
    expect(pickPushdown({})).toBeNull()
  })
  it('picks the first key that is both non-null and indexed', () => {
    expect(pickPushdown({ title: 'x', client_id: 'c1' })).toEqual({ key: 'client_id', value: 'c1' })
  })
  it('skips a null-valued indexed key and an unindexed key', () => {
    expect(pickPushdown({ client_id: null, title: 'x' })).toBeNull()
    expect(pickPushdown({ client_id: null, status: 'open' })).toEqual({ key: 'status', value: 'open' })
  })
  it('mirrors database.rules.json .indexOn exactly (12 columns)', () => {
    expect([...INDEXED_COLUMNS].sort()).toEqual([
      'batch_id', 'client_id', 'created_at', 'due_date', 'email', 'item_id',
      'owner_id', 'scheduled_for', 'status', 'team_user_id', 'token', 'updated_at',
    ])
  })
})
