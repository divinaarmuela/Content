import { describe, it, expect } from 'vitest'
import {
  GRANTABLE_PAGES, canSeePage, canSeeSubpage, defaultAllows, isGrantablePage,
  normaliseGrantedPages, subpageKey, visiblePages,
} from '../app/lib/page-access-core'
import type { Role } from '../app/lib/identity-core'

describe('subpageKey — an id must not become a permission', () => {
  it('maps a real client tab to its permission key', () => {
    expect(subpageKey('/dashboard/clients/b871b7d8-1b97/brand'))
      .toBe('/dashboard/clients/:id/brand')
    expect(subpageKey('/dashboard/clients/abc/credentials'))
      .toBe('/dashboard/clients/:id/credentials')
  })

  it('is null for anything that is not a client tab', () => {
    for (const p of [
      '/dashboard/clients', '/dashboard/clients/abc', '/dashboard/leads',
      '/dashboard/clients/abc/intake/form-1',
    ]) expect(subpageKey(p)).toBeNull()
  })
})

describe('canSeeSubpage — a tab needs its parent AND itself', () => {
  const BRAND = '/dashboard/clients/:id/brand'
  const CREDS = '/dashboard/clients/:id/credentials'

  it('refuses a granted tab when the parent page is not granted', () => {
    // Brand without Clients is a tab on a page they cannot open
    expect(canSeeSubpage('editor', BRAND, [BRAND])).toBe(false)
  })

  it('allows it once both are granted', () => {
    expect(canSeeSubpage('editor', BRAND, ['/dashboard/clients', BRAND])).toBe(true)
  })

  it('grants one tab without granting its neighbours', () => {
    const granted = ['/dashboard/clients', BRAND]
    expect(canSeeSubpage('editor', CREDS, granted)).toBe(false)
  })

  it('account managers and super admins keep every tab with no grants', () => {
    for (const role of ['account_manager', 'super_admin'] as Role[]) {
      expect(canSeeSubpage(role, BRAND, [])).toBe(true)
      expect(canSeeSubpage(role, CREDS, [])).toBe(true)
    }
  })

  it('a client is refused however it is configured', () => {
    expect(canSeeSubpage('client', BRAND, ['/dashboard/clients', BRAND])).toBe(false)
    expect(canSeeSubpage(null, BRAND, ['/dashboard/clients', BRAND])).toBe(false)
  })
})

const NAV = [
  { href: '/dashboard' },
  { href: '/dashboard/leads' },
  { href: '/dashboard/production' },
  { href: '/dashboard/scheduler' },
  { href: '/dashboard/settings' },
]

const TEAM_ROLES: Role[] = ['scheduler', 'editor', 'account_manager', 'super_admin']

describe('defaultAllows — the ladder as it always was', () => {
  it('keeps an editor on their own pages and the production board only', () => {
    expect(defaultAllows('editor', '/dashboard')).toBe(true)
    expect(defaultAllows('editor', '/dashboard/production')).toBe(true)
    for (const href of ['/dashboard/leads', '/dashboard/clients', '/dashboard/scheduler']) {
      expect(defaultAllows('editor', href)).toBe(false)
    }
  })

  it('keeps a scheduler on their own pages, scheduler, calendar and social', () => {
    expect(defaultAllows('scheduler', '/dashboard')).toBe(true)
    expect(defaultAllows('scheduler', '/dashboard/scheduler')).toBe(true)
    expect(defaultAllows('scheduler', '/dashboard/calendar')).toBe(true)
    expect(defaultAllows('scheduler', '/dashboard/production')).toBe(false)
  })

  it('every team role gets Notifications and Settings — their own feed and prefs', () => {
    for (const role of TEAM_ROLES) {
      expect(defaultAllows(role, '/dashboard/notifications')).toBe(true)
      expect(defaultAllows(role, '/dashboard/settings')).toBe(true)
    }
  })

  it('every team role sees the overview — it shapes itself to the role', () => {
    for (const role of TEAM_ROLES) expect(defaultAllows(role, '/dashboard')).toBe(true)
  })

  it('gives super admins every page', () => {
    for (const { href } of GRANTABLE_PAGES) {
      expect(defaultAllows('super_admin', href)).toBe(true)
    }
  })

  it('account managers get everything except business development', () => {
    const excluded = ['/dashboard/leads', '/dashboard/audience', '/dashboard/reports']
    for (const href of excluded) expect(defaultAllows('account_manager', href)).toBe(false)
    for (const { href } of GRANTABLE_PAGES) {
      if (excluded.includes(href)) continue
      expect(defaultAllows('account_manager', href)).toBe(true)
    }
    // and a grant can still open them for a specific person
    expect(canSeePage('account_manager', '/dashboard/leads', ['/dashboard/leads'])).toBe(true)
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
    expect(canSeePage('editor', '/dashboard/reports', granted)).toBe(false)
  })

  it('cannot take away what the ladder already gave', () => {
    expect(canSeePage('editor', '/dashboard/production', [])).toBe(true)
    expect(canSeePage('scheduler', '/dashboard/scheduler', [])).toBe(true)
    expect(canSeePage('account_manager', '/dashboard/clients', [])).toBe(true)
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
    expect(seen.map(s => s.href)).toEqual(['/dashboard', '/dashboard/leads', '/dashboard/production', '/dashboard/settings'])
  })

  it('an editor with no grants sees only their own pages and production', () => {
    expect(visiblePages('editor', NAV, []).map(s => s.href)).toEqual(['/dashboard', '/dashboard/production', '/dashboard/settings'])
  })

  it('an unresolved role sees nothing, grants or not', () => {
    expect(visiblePages(null, NAV, ['/dashboard'])).toEqual([])
  })

  it('two people with the same role can differ', () => {
    const manal = visiblePages('editor', NAV, ['/dashboard/leads'])
    const other = visiblePages('editor', NAV, [])
    expect(manal.length).toBe(4)
    expect(other.length).toBe(3)
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
    expect(normaliseGrantedPages(['/dashboard/clients'], 'account_manager')).toEqual([])
    // leads is NOT an AM default anymore, so a leads grant survives cleaning
    expect(normaliseGrantedPages(['/dashboard/leads'], 'account_manager')).toEqual(['/dashboard/leads'])
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
