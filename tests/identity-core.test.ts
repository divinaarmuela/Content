import { describe, it, expect } from 'vitest'
import {
  parseAllowlist,
  isAllowlistedSuperAdmin,
  roleSatisfies,
  buildDedupeKey,
} from '../app/lib/identity-core'

describe('parseAllowlist', () => {
  it('splits, trims, and lowercases', () => {
    expect(parseAllowlist(' Yusuf@mdmmarketing.com.au , TECH@mdmmarketing.com.au ')).toEqual([
      'yusuf@mdmmarketing.com.au',
      'tech@mdmmarketing.com.au',
    ])
  })
  it('handles undefined and empty', () => {
    expect(parseAllowlist(undefined)).toEqual([])
    expect(parseAllowlist('')).toEqual([])
    expect(parseAllowlist(', ,')).toEqual([])
  })
})

describe('isAllowlistedSuperAdmin', () => {
  const list = parseAllowlist('yusuf@mdmmarketing.com.au,hello@mdmmarketing.com.au')
  it('matches case-insensitively with whitespace tolerance', () => {
    expect(isAllowlistedSuperAdmin('YUSUF@mdmmarketing.com.au', list)).toBe(true)
    expect(isAllowlistedSuperAdmin('  hello@mdmmarketing.com.au ', list)).toBe(true)
  })
  it('rejects non-members and near-misses', () => {
    expect(isAllowlistedSuperAdmin('yusuf@gmail.com', list)).toBe(false)
    expect(isAllowlistedSuperAdmin('xhello@mdmmarketing.com.au', list)).toBe(false)
    expect(isAllowlistedSuperAdmin('', list)).toBe(false)
  })
})

describe('roleSatisfies', () => {
  it('super_admin passes everything', () => {
    for (const req of ['super_admin', 'account_manager', 'editor', 'scheduler', 'client'] as const) {
      expect(roleSatisfies('super_admin', req)).toBe(true)
    }
  })
  it('team hierarchy: AM ≥ editor ≥ scheduler', () => {
    expect(roleSatisfies('account_manager', 'editor')).toBe(true)
    expect(roleSatisfies('account_manager', 'scheduler')).toBe(true)
    expect(roleSatisfies('editor', 'scheduler')).toBe(true)
    expect(roleSatisfies('editor', 'account_manager')).toBe(false)
    expect(roleSatisfies('scheduler', 'editor')).toBe(false)
    expect(roleSatisfies('scheduler', 'super_admin')).toBe(false)
  })
  it('client is its own axis in both directions', () => {
    expect(roleSatisfies('client', 'client')).toBe(true)
    expect(roleSatisfies('client', 'scheduler')).toBe(false)
    expect(roleSatisfies('client', 'account_manager')).toBe(false)
    expect(roleSatisfies('editor', 'client')).toBe(false)
    expect(roleSatisfies('account_manager', 'client')).toBe(false)
  })
})

describe('buildDedupeKey', () => {
  it('is deterministic and canonicalizes the recipient', () => {
    const a = buildDedupeKey('item_submitted', 'content_item', 'abc-123', 'AM@mdm.com')
    const b = buildDedupeKey('item_submitted', 'content_item', 'abc-123', ' am@mdm.com ')
    expect(a).toBe(b)
    expect(a).toBe('item_submitted::content_item::abc-123::am@mdm.com')
  })
  it('differs across event, entity, and recipient', () => {
    const base = buildDedupeKey('e', 't', '1', 'a@b.c')
    expect(buildDedupeKey('e2', 't', '1', 'a@b.c')).not.toBe(base)
    expect(buildDedupeKey('e', 't2', '1', 'a@b.c')).not.toBe(base)
    expect(buildDedupeKey('e', 't', '2', 'a@b.c')).not.toBe(base)
    expect(buildDedupeKey('e', 't', '1', 'x@b.c')).not.toBe(base)
  })
})
