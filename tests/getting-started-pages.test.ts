import { describe, it, expect } from 'vitest'
import {
  dismissKey, panelForPage, panelForRole, shouldShowPagePanel, type GettingStartedPage,
} from '../app/lib/getting-started-core'
import type { Role } from '../app/lib/identity-core'

const PAGES: GettingStartedPage[] = ['overview', 'editor', 'scheduler', 'production', 'item']
const STAFF: Role[] = ['editor', 'scheduler', 'account_manager', 'super_admin']

/** the words the owner banned from every screen */
const JARGON = /\b(batch|kind|hat|ad-hoc|reconcile|uses_media|brief task|asset)\b/i

describe('Getting started, per page', () => {
  it('every staff role gets a panel on the overview and on the item page', () => {
    for (const role of STAFF) {
      expect(panelForPage('overview', role)).toBe(panelForRole(role))
      expect(panelForPage('item', role)).not.toBeNull()
    }
  })

  it('the work pages explain themselves in the role’s own words', () => {
    expect(panelForPage('editor', 'editor')).toBe(panelForRole('editor'))
    expect(panelForPage('editor', 'account_manager')?.heading).toMatch(/reviewers/)
    expect(panelForPage('scheduler', 'scheduler')).toBe(panelForRole('scheduler'))
    expect(panelForPage('production', 'account_manager')?.steps[0].title).toBe('Make a shoot plan')
    expect(panelForPage('production', 'editor')?.steps[0].title).toBe('A card is one thing to make')
    expect(panelForPage('production', 'editor')?.steps[2].body).toMatch(/New card/)
  })

  it('clients and nobody get nothing', () => {
    for (const page of PAGES) {
      expect(panelForPage(page, 'client')).toBeNull()
      expect(panelForPage(page, null)).toBeNull()
    }
  })

  it('every step is three real things: a title, a body, a link', () => {
    for (const page of PAGES) for (const role of STAFF) {
      const panel = panelForPage(page, role)
      if (!panel) continue
      expect(panel.steps).toHaveLength(3)
      for (const s of panel.steps) {
        expect(s.title.length).toBeGreaterThan(3)
        expect(s.body.length).toBeGreaterThan(20)
        // a step's link is optional — a purely explanatory step (one that
        // would only point at the page it is already on) carries neither
        // href nor label; when it has one, both are present and real
        if (s.href !== undefined || s.linkLabel !== undefined) {
          expect(s.href).toMatch(/^(\/dashboard|#)/)
          expect(s.linkLabel!.length).toBeGreaterThan(3)
        }
        expect(`${s.title} ${s.body}`, `${page}/${role}: ${s.title}`).not.toMatch(JARGON)
      }
    }
  })

  it('dismissal is per role AND per page; the overview keeps the wave-1 key', () => {
    expect(dismissKey('overview', 'editor')).toBe('editor')
    expect(dismissKey('editor', 'account_manager')).toBe('account_manager:editor')

    expect(shouldShowPagePanel('editor', 'editor', null, [])).toBe(true)
    expect(shouldShowPagePanel('editor', 'editor', null, ['editor:editor'])).toBe(false)
    // a promotion re-earns the page
    expect(shouldShowPagePanel('editor', 'account_manager', null, ['editor:editor'])).toBe(true)
    // the overview reads the role column, not the pages list
    expect(shouldShowPagePanel('overview', 'editor', 'editor', [])).toBe(false)
    expect(shouldShowPagePanel('overview', 'editor', null, ['editor'])).toBe(true)
    // a missing list is "never dismissed"
    expect(shouldShowPagePanel('item', 'scheduler', null, undefined)).toBe(true)
  })
})
