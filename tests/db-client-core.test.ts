import { describe, it, expect } from 'vitest'
import { snapshotToRows, applyQuery } from '@/lib/db-client'

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
