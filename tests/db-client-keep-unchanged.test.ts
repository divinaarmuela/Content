import { describe, it, expect, vi } from 'vitest'
vi.mock('firebase/app', () => ({ getApp: vi.fn(), getApps: vi.fn(() => []), initializeApp: vi.fn() }))
vi.mock('firebase/database', () => ({ getDatabase: vi.fn(), ref: vi.fn(), query: vi.fn(), orderByChild: vi.fn(), equalTo: vi.fn(), onValue: vi.fn() }))
import { readFileSync } from 'node:fs'
import { keepUnchanged } from '../lib/db-client'

// 28 Oct 2026: "its still slow for my colleague's iMac … her Asana is so quick" — one task autosaving redrew all ~490
describe('a row that did not change stays the same object', () => {
  it('only the changed row is new; a gone row is forgotten', () => {
    const cache = new Map()
    const first = keepUnchanged([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], cache)
    const second = keepUnchanged([{ id: 'a', title: 'A' }, { id: 'b', title: 'B2' }], cache)
    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second[1]).toEqual({ id: 'b', title: 'B2' })
    keepUnchanged([{ id: 'a', title: 'A' }], cache)
    expect(cache.has('b')).toBe(false)
  })
  it('every live list goes through it', () => {
    expect(readFileSync('lib/db-client.ts', 'utf8')).toContain('let r = keepUnchanged(snapshotToRows<T>(name, raw), same.current)')
  })
})
