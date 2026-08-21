import { describe, expect, it } from 'vitest'
import {
  isValidOwner, orderAssignees, resolveKindForWrite, validateKindInput, type WorkKind,
} from '../app/lib/work-kinds-core'

describe('validateKindInput', () => {
  it('accepts a clean kind and normalises the slug', () => {
    const r = validateKindInput({ slug: ' Motion-GFX ', name: 'Motion graphics', default_roles: ['editor'], color: 'violet' })
    expect(r).toEqual({ ok: true, value: { slug: 'motion-gfx', name: 'Motion graphics', default_roles: ['editor'], uses_media: true, color: 'violet' } })
  })

  it('rejects bad slugs, client role, invented colours — with reasons', () => {
    const r = validateKindInput({ slug: 'has spaces!', name: '', default_roles: ['client', 'editor'], color: 'hotpink' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(4)
  })
})

const members = [
  { id: 'a', name: 'Akmal', email: 'a@x.co', role: 'editor' },
  { id: 'b', name: 'Manal', email: 'm@x.co', role: 'account_manager' },
  { id: 'c', name: 'Yusuf', email: 'y@x.co', role: 'super_admin' },
  { id: 'd', name: 'Shanny', email: 's@x.co', role: 'scheduler' },
  { id: 'e', name: 'Client', email: 'c@x.co', role: 'client' },
  { id: 'f', name: 'Gone', email: 'g@x.co', role: 'editor', active_status: false },
]

describe('orderAssignees', () => {
  it('suggests by the kind role, groups the rest, excludes clients and inactive, no duplicates', () => {
    const { suggested, rest } = orderAssignees({ default_roles: ['account_manager', 'super_admin'] }, members)
    expect(suggested.map(m => m.id)).toEqual(['b', 'c'])
    expect(rest.map(m => m.id)).toEqual(['a', 'd'])
    expect([...suggested, ...rest].some(m => m.role === 'client')).toBe(false)
  })

  it('null kind: everyone eligible in role order', () => {
    const { suggested, rest } = orderAssignees(null, members)
    expect(suggested).toEqual([])
    expect(rest.map(m => m.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

const kinds: WorkKind[] = [
  { id: 'k1', slug: 'edit', name: 'Video edit', default_roles: ['editor'], uses_media: true, color: 'zinc', active: true, sort_order: 0 },
  { id: 'k2', slug: 'copy', name: 'Copywriting', default_roles: ['account_manager'], uses_media: false, color: 'sky', active: true, sort_order: 2 },
  { id: 'k3', slug: 'old', name: 'Retired', default_roles: [], uses_media: true, color: 'zinc', active: false, sort_order: 9 },
]

describe('resolveKindForWrite', () => {
  it('defaults to edit when nothing is asked for', () => {
    expect(resolveKindForWrite(kinds, undefined)).toEqual({ ok: true, id: 'k1' })
    expect(resolveKindForWrite(kinds, null)).toEqual({ ok: true, id: 'k1' })
  })
  it('honours a real active choice, refuses archived and unknown', () => {
    expect(resolveKindForWrite(kinds, 'k2')).toEqual({ ok: true, id: 'k2' })
    expect(resolveKindForWrite(kinds, 'k3')).toMatchObject({ ok: false })
    expect(resolveKindForWrite(kinds, 'nope')).toMatchObject({ ok: false })
  })
  it('falls back to first active by sort order when edit is archived', () => {
    const noEdit = kinds.map(k => (k.slug === 'edit' ? { ...k, active: false } : k))
    expect(resolveKindForWrite(noEdit, undefined)).toEqual({ ok: true, id: 'k2' })
  })
})

describe('isValidOwner', () => {
  it('any active team member; never a client, inactive, or missing person', () => {
    expect(isValidOwner({ role: 'scheduler' })).toBe(true)
    expect(isValidOwner({ role: 'account_manager', active_status: true })).toBe(true)
    expect(isValidOwner({ role: 'client' })).toBe(false)
    expect(isValidOwner({ role: 'editor', active_status: false })).toBe(false)
    expect(isValidOwner(null)).toBe(false)
  })
})
