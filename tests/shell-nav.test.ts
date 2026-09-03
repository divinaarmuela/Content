import { describe, expect, it } from 'vitest'
import {
  GROUPS, NAV_MAIN, NAV_SOCIAL_CHILDREN, NAV_TOOLS, PINNED_BOTTOM,
  activeNavHref, pageTitle, resolveNav,
} from '@/app/dashboard/ui/Shell'
import type { Role } from '@/app/lib/identity-core'

/**
 * The sidebar draws NAV_MAIN and NAV_TOOLS through GROUPS, which is a hand
 * written list of hrefs. An entry added to the nav but not to a group is
 * simply never drawn — no error, no warning, and the page is only reachable
 * by typing its URL. The first block below is the whole reason this file
 * exists; the rest pins what each role actually sees.
 */

const hrefs = (items: { href: string }[]) => items.map(i => i.href)

describe('GROUPS covers the nav', () => {
  const grouped = new Set(GROUPS.flatMap(g => g.hrefs))

  it('draws every NAV_MAIN and NAV_TOOLS entry somewhere', () => {
    const missing = [...hrefs(NAV_MAIN), ...hrefs(NAV_TOOLS)]
      .filter(h => !grouped.has(h) && h !== PINNED_BOTTOM)
    expect(missing).toEqual([])
  })

  it('lists nothing that is not in the nav', () => {
    const known = new Set([...hrefs(NAV_MAIN), ...hrefs(NAV_TOOLS)])
    const stray = [...grouped].filter(h => !known.has(h))
    expect(stray).toEqual([])
  })

  it('puts each entry in exactly one group', () => {
    const all = GROUPS.flatMap(g => g.hrefs)
    expect(all.length).toBe(new Set(all).size)
  })

  it('keeps Settings pinned and out of the groups', () => {
    expect(hrefs(NAV_TOOLS)).toContain(PINNED_BOTTOM)
    expect(grouped.has(PINNED_BOTTOM)).toBe(false)
  })

  it('leaves the Social children to Social — they are drawn nested, not grouped', () => {
    for (const child of hrefs(NAV_SOCIAL_CHILDREN)) expect(grouped.has(child)).toBe(false)
  })
})

/* ── what each role sees ────────────────────────────────────────────────── */

const seen = (role: Role | null, granted: string[] = [], hidden: string[] = [], path = '/dashboard') =>
  [...resolveNav(role, granted, hidden, path).allowed.keys()]

describe('resolveNav by role', () => {
  it('gives a super admin everything except the grant-only page', () => {
    const list = seen('super_admin')
    for (const h of [...hrefs(NAV_MAIN), ...hrefs(NAV_TOOLS)]) {
      if (h === '/dashboard/bookings') continue  // grant-only: nobody holds it by role
      expect(list, h).toContain(h)
    }
    expect(list).not.toContain('/dashboard/bookings')
  })

  it('keeps leads and audience out of an account manager world', () => {
    const list = seen('account_manager')
    expect(list).not.toContain('/dashboard/leads')
    expect(list).not.toContain('/dashboard/audience')
    expect(list).toContain('/dashboard/clients')
    expect(list).toContain('/dashboard/reports')
  })

  it('gives an editor their board, the shoots feeding it and where it lands', () => {
    expect(seen('editor').sort()).toEqual([
      '/dashboard',
      '/dashboard/editor',
      '/dashboard/notifications',
      '/dashboard/production',
      '/dashboard/scheduler',
      '/dashboard/settings',
    ].sort())
  })

  it('gives a scheduler the queue, social and the board their posts came from', () => {
    const list = seen('scheduler')
    expect(list).toContain('/dashboard/scheduler')
    expect(list).toContain('/dashboard/social')
    expect(list).toContain('/dashboard/editor')
    expect(list).toContain('/dashboard/production')
    expect(list).not.toContain('/dashboard/clients')
    expect(list).not.toContain('/dashboard/team')
  })

  it('gives a client nothing — the portal is a different app', () => {
    expect(seen('client')).toEqual([])
    // and a grant cannot smuggle a team page to them
    expect(seen('client', ['/dashboard/leads'])).toEqual([])
  })

  it('shows nothing at all until the identity is known', () => {
    expect(seen(null)).toEqual([])
  })

  it('adds a granted page to one person, in its usual place', () => {
    const list = seen('editor', ['/dashboard/leads'])
    expect(list).toContain('/dashboard/leads')
    // order is the nav order, not "appended at the end"
    expect(list.indexOf('/dashboard/leads')).toBeLessThan(list.indexOf('/dashboard/editor'))
  })

  it('lets someone hide a page they hold, even a super admin', () => {
    expect(seen('super_admin', [], ['/dashboard/website'])).not.toContain('/dashboard/website')
    // hiding also removes it from an editor short list
    expect(seen('editor', [], ['/dashboard/editor'])).not.toContain('/dashboard/editor')
  })

  it('opens the Social children only when Social itself is visible', () => {
    expect(resolveNav('super_admin', [], [], '/dashboard').children).toHaveLength(4)
    expect(resolveNav('editor', [], [], '/dashboard').children).toEqual([])
    expect(resolveNav('super_admin', [], ['/dashboard/social'], '/dashboard').children).toEqual([])
  })
})

/* ── where the sidebar thinks you are ───────────────────────────────────── */

describe('activeNavHref', () => {
  const all = [...hrefs(NAV_MAIN), ...hrefs(NAV_SOCIAL_CHILDREN), ...hrefs(NAV_TOOLS)]

  it('prefers an exact match', () => {
    expect(activeNavHref('/dashboard/team', all)).toBe('/dashboard/team')
  })

  it('keeps a detail page highlighted under its section', () => {
    expect(activeNavHref('/dashboard/clients/abc-123/brand', all)).toBe('/dashboard/clients')
    expect(activeNavHref('/dashboard/production/shoots/xyz', all)).toBe('/dashboard/production')
  })

  it('lets the longest prefix win, so Team activity is not swallowed by Team', () => {
    expect(activeNavHref('/dashboard/team/activity/anything', all)).toBe('/dashboard/team/activity')
  })

  it('never lets bare /dashboard swallow the pages under it', () => {
    expect(activeNavHref('/dashboard/social/inbox', all)).toBe('/dashboard/social/inbox')
    expect(activeNavHref('/dashboard', all)).toBe('/dashboard')
  })

  it('highlights nothing for a page that is not in the nav at all', () => {
    expect(activeNavHref('/somewhere/else', all)).toBeNull()
  })

  it('only offers entries the person can see', () => {
    // a super admin opening a client lands on Clients
    expect(resolveNav('super_admin', [], [], '/dashboard/clients/abc-123').current)
      .toBe('/dashboard/clients')
    // an editor cannot see Clients at all, so the only prefix left that they
    // hold is the Overview — the rail falls back to it rather than going blank
    expect(resolveNav('editor', [], [], '/dashboard/clients/abc-123').current)
      .toBe('/dashboard')
  })
})

describe('pageTitle', () => {
  it('names every nav entry', () => {
    for (const h of [...hrefs(NAV_MAIN), ...hrefs(NAV_SOCIAL_CHILDREN), ...hrefs(NAV_TOOLS)]) {
      expect(pageTitle(h), h).not.toBe('Dashboard')
    }
  })

  it('falls back to the section for a page underneath one', () => {
    expect(pageTitle('/dashboard/clients/abc-123')).toBe('Clients')
    expect(pageTitle('/dashboard/production/shoots/xyz')).toBe('Production')
    // the longest prefix wins here too
    expect(pageTitle('/dashboard/team/activity/x')).toBe('Team activity')
    expect(pageTitle('/dashboard/production/proposals')).toBe('Proposals')
  })

  it('falls back to the Overview for an unknown page under /dashboard', () => {
    // '/dashboard' is itself a prefix of everything below it, so an unnamed
    // page reads "Overview" rather than going blank
    expect(pageTitle('/dashboard/nothing-like-this')).toBe('Overview')
  })

  it('says "Dashboard" only when the path is not the dashboard at all', () => {
    expect(pageTitle('/somewhere/else')).toBe('Dashboard')
  })
})
