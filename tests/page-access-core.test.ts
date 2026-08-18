import { describe, it, expect } from 'vitest'
import {
  GRANTABLE_ROLES, canSeePage, defaultAllows, normaliseGrantRoles, visiblePages,
} from '../app/lib/page-access-core'

const NAV = [
  { href: '/dashboard' },
  { href: '/dashboard/leads' },
  { href: '/dashboard/production' },
  { href: '/dashboard/scheduler' },
]

describe('defaultAllows — the ladder as it always was', () => {
  it('keeps an editor on the production board', () => {
    expect(defaultAllows('editor', '/dashboard/production')).toBe(true)
    expect(defaultAllows('editor', '/dashboard/leads')).toBe(false)
  })

  it('keeps a scheduler on the scheduler and calendar', () => {
    expect(defaultAllows('scheduler', '/dashboard/scheduler')).toBe(true)
    expect(defaultAllows('scheduler', '/dashboard/calendar')).toBe(true)
    expect(defaultAllows('scheduler', '/dashboard/production')).toBe(false)
  })

  it('gives account managers and super admins everything', () => {
    for (const href of NAV.map(n => n.href)) {
      expect(defaultAllows('account_manager', href)).toBe(true)
      expect(defaultAllows('super_admin', href)).toBe(true)
    }
  })

  it('shows nothing to a client or an unresolved identity', () => {
    expect(defaultAllows('client', '/dashboard')).toBe(false)
    expect(defaultAllows(null, '/dashboard')).toBe(false)
  })
})

describe('canSeePage — a grant only ever adds', () => {
  it('opens a page to a role that would not normally see it', () => {
    expect(canSeePage('editor', '/dashboard/leads', {})).toBe(false)
    expect(canSeePage('editor', '/dashboard/leads', { '/dashboard/leads': ['editor'] })).toBe(true)
  })

  it('grants one role without granting another', () => {
    const access = { '/dashboard/leads': ['editor'] }
    expect(canSeePage('scheduler', '/dashboard/leads', access)).toBe(false)
  })

  it('cannot take away what the ladder already gave', () => {
    // an empty grant list on a page an editor owns by default changes nothing
    expect(canSeePage('editor', '/dashboard/production', { '/dashboard/production': [] })).toBe(true)
    expect(canSeePage('account_manager', '/dashboard/leads', { '/dashboard/leads': [] })).toBe(true)
  })

  it('never lets a client or an unknown identity in, however it is configured', () => {
    const access = { '/dashboard/leads': ['client', 'editor', 'super_admin'] }
    expect(canSeePage('client', '/dashboard/leads', access)).toBe(false)
    expect(canSeePage(null, '/dashboard/leads', access)).toBe(false)
  })
})

describe('visiblePages', () => {
  it('filters to what the role may see and preserves nav order', () => {
    const seen = visiblePages('editor', NAV, { '/dashboard/leads': ['editor'] })
    expect(seen.map(s => s.href)).toEqual(['/dashboard/leads', '/dashboard/production'])
  })

  it('an editor with no grants still sees only production', () => {
    expect(visiblePages('editor', NAV, {}).map(s => s.href)).toEqual(['/dashboard/production'])
  })

  it('an unresolved role sees nothing', () => {
    expect(visiblePages(null, NAV, { '/dashboard': ['editor'] })).toEqual([])
  })
})

describe('normaliseGrantRoles', () => {
  it('keeps known team roles, deduped', () => {
    expect(normaliseGrantRoles(['editor', 'editor', 'scheduler'])).toEqual(['editor', 'scheduler'])
  })

  it('drops client, super_admin and anything invented', () => {
    expect(normaliseGrantRoles(['client', 'super_admin', 'wizard', '', null]))
      .toEqual([])
  })

  it('survives rubbish input', () => {
    expect(normaliseGrantRoles(null)).toEqual([])
    expect(normaliseGrantRoles('editor')).toEqual([])
  })

  it('offers only the roles worth granting', () => {
    expect(GRANTABLE_ROLES).not.toContain('super_admin')
    expect(GRANTABLE_ROLES).not.toContain('client')
  })
})
