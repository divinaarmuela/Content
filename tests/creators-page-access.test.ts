import { describe, expect, it } from 'vitest'
import { GRANTABLE_PAGES, defaultAllows } from '../app/lib/page-access-core'
import { NAV_MAIN as NAV, GROUPS } from '../app/dashboard/ui/Shell'

describe('Creator campaigns in the sidebar', () => {
  const PAGE = '/dashboard/creators'
  it('is a super admin and account manager page by default, nobody else', () => {
    expect(defaultAllows('super_admin', PAGE)).toBe(true)
    expect(defaultAllows('account_manager', PAGE)).toBe(true)
    for (const role of ['editor', 'scheduler', 'general', 'designer'] as const) expect(defaultAllows(role as never, PAGE), role).toBe(false)
  })
  it('can be opened to a person by name, and sits with Clients in the sidebar', () => {
    expect(GRANTABLE_PAGES.some(p => p.href === PAGE)).toBe(true)
    expect(NAV.some(n => n.href === PAGE && n.label === 'Creator campaigns')).toBe(true)
    expect(GROUPS.find(g => g.label === 'General')?.hrefs).toContain(PAGE)
  })
})
