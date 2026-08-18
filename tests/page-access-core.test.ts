import { describe, it, expect } from 'vitest'
import {
  GRANTABLE_PAGES, canSeePage, defaultAllows, isGrantablePage,
  normaliseGrantedPages, visiblePages,
} from '../app/lib/page-access-core'
import type { Role } from '../app/lib/identity-core'

const NAV = [
  { href: '/dashboard' },
  { href: '/dashboard/leads' },
  { href: '/dashboard/production' },
  { href: '/dashboard/scheduler' },
  { href: '/dashboard/settings' },
]

const TEAM_ROLES: Role[] = ['scheduler', 'editor', 'account_manager', 'super_admin']

describe('defaultAllows — the ladder as it always was', () => {
  it('keeps an editor on the production board only', () => {
    expect(defaultAllows('editor', '/dashboard/production')).toBe(true)
    for (const href of ['/dashboard', '/dashboard/leads', '/dashboard/settings']) {
      expect(defaultAllows('editor', href)).toBe(false)
    }
  })

  it('keeps a scheduler on the scheduler and calendar only', () => {
    expect(defaultAllows('scheduler', '/dashboard/scheduler')).toBe(true)
    expect(defaultAllows('scheduler', '/dashboard/calendar')).toBe(true)
    expect(defaultAllows('scheduler', '/dashboard/production')).toBe(false)
  })

  it('gives account managers and super admins every page', () => {
    for (const { href } of GRANTABLE_PAGES) {
      expect(defaultAllows('account_manager', href)).toBe(true)
      expect(defaultAllows('super_admin', href)).toBe(true)
    }
  })

  it('shows nothing to a client or an unresolved identity', () => {
    expect(defaultAllows('client', '/dashboard')).toBe(false)
    expect(defaultAllows(null, '/dashboard')).toBe(false)
  })
})

describe('canSeePage — a grant is per person and only ever adds', () => {
  it('opens a page to someone who would not normally see it', () => {
    expect(canSeePage('editor', '/dashboard/leads', [])).toBe(false)
    expect(canSeePage('editor', '/dashboard/leads', ['/dashboard/leads'])).toBe(true)
  })

  it('grants one page without granting the neighbours', () => {
    const granted = ['/dashboard/leads']
    expect(canSeePage('editor', '/dashboard/clients', granted)).toBe(false)
    expect(canSeePage('editor', '/dashboard/settings', granted)).toBe(false)
  })

  it('cannot take away what the ladder already gave', () => {
    expect(canSeePage('editor', '/dashboard/production', [])).toBe(true)
    expect(canSeePage('scheduler', '/dashboard/scheduler', [])).toBe(true)
    expect(canSeePage('account_manager', '/dashboard/leads', [])).toBe(true)
  })

  it('never lets a client or an unknown identity in, however it is configured', () => {
    expect(canSeePage('client', '/dashboard/leads', ['/dashboard/leads'])).toBe(false)
    expect(canSeePage(null, '/dashboard/leads', ['/dashboard/leads'])).toBe(false)
  })

  it('a super admin sees everything with no grants at all', () => {
    for (const { href } of GRANTABLE_PAGES) expect(canSeePage('super_admin', href, [])).toBe(true)
  })
})

describe('visiblePages', () => {
  it('filters to what the person may see and preserves nav order', () => {
    const seen = visiblePages('editor', NAV, ['/dashboard/leads'])
    expect(seen.map(s => s.href)).toEqual(['/dashboard/leads', '/dashboard/production'])
  })

  it('an editor with no grants still sees only production', () => {
    expect(visiblePages('editor', NAV, []).map(s => s.href)).toEqual(['/dashboard/production'])
  })

  it('an unresolved role sees nothing, grants or not', () => {
    expect(visiblePages(null, NAV, ['/dashboard'])).toEqual([])
  })

  it('two people with the same role can differ', () => {
    const manal = visiblePages('editor', NAV, ['/dashboard/leads'])
    const other = visiblePages('editor', NAV, [])
    expect(manal.length).toBe(2)
    expect(other.length).toBe(1)
  })
})

describe('isGrantablePage', () => {
  it('accepts every page offered in the UI', () => {
    for (const { href } of GRANTABLE_PAGES) expect(isGrantablePage(href)).toBe(true)
  })

  it('refuses anything invented, mistyped, or outside the dashboard', () => {
    for (const href of ['/dashboard/nope', '/dashboard/leads/', '/portal/abc', '', '/', 'dashboard/leads']) {
      expect(isGrantablePage(href)).toBe(false)
    }
  })
})

describe('normaliseGrantedPages', () => {
  it('keeps known pages, deduped', () => {
    expect(normaliseGrantedPages(['/dashboard/leads', '/dashboard/leads', '/dashboard/clients'], 'editor'))
      .toEqual(['/dashboard/leads', '/dashboard/clients'])
  })

  it('drops pages the person already has by default', () => {
    // storing these would let a later role change silently keep access
    expect(normaliseGrantedPages(['/dashboard/production', '/dashboard/leads'], 'editor'))
      .toEqual(['/dashboard/leads'])
    expect(normaliseGrantedPages(['/dashboard/leads'], 'account_manager')).toEqual([])
  })

  it('drops invented pages and rubbish', () => {
    expect(normaliseGrantedPages(['/dashboard/wizard', '', null, 42, {}], 'editor')).toEqual([])
    expect(normaliseGrantedPages(null, 'editor')).toEqual([])
    expect(normaliseGrantedPages('/dashboard/leads', 'editor')).toEqual([])
  })

  it('a granted page always survives the round trip it was cleaned for', () => {
    for (const role of TEAM_ROLES) {
      for (const { href } of GRANTABLE_PAGES) {
        const cleaned = normaliseGrantedPages([href], role)
        expect(canSeePage(role, href, cleaned)).toBe(true)
      }
    }
  })
})
