import { describe, expect, it } from 'vitest'
import {
  cardHref, chipCount, linkAllowed, mayBookPosts, mayCreatePost, overviewChips, overviewLinksFor, pageOf, shootHref,
} from '../app/lib/overview-links-core'
import { defaultAllows } from '../app/lib/page-access-core'
import { TEAM_ROLES, type Role } from '../app/lib/identity-core'

/**
 * THE OVERVIEW SENDS EVERY ROLE ONLY WHERE THEY MAY GO (the owner, 13 Sep
 * 2026: "the button pages are wrong … for every role"; "that page doesn't
 * exist anymore"). Table-driven over every team role.
 */

describe('every Overview link lands on a page the role has', () => {
  for (const role of TEAM_ROLES) {
    it(`${role}`, () => {
      const links = overviewLinksFor(role)
      expect(links.length).toBeGreaterThan(0)
      for (const href of links) {
        expect(defaultAllows(role, pageOf(href)), `${role} → ${href}`).toBe(true)
        expect(linkAllowed(role, href), `${role} → ${href}`).toBe(true)
        // the retired full-card page is never a destination
        expect(href, href).not.toMatch(/^\/dashboard\/production\/[^/s][^/]*$/)
      }
    })
  }
})

describe('a card opens on a board the role has', () => {
  it('editor: the Editor board, whatever the stage', () => {
    expect(cardHref('editor', { id: 'c1', status: 'draft_uploaded' })).toBe('/dashboard/editor?card=c1')
    expect(cardHref('editor', { id: 'c1', status: 'published' })).toBe('/dashboard/editor?card=c1')
  })
  it('scheduler and quality checker: Post approval', () => {
    expect(cardHref('scheduler', { id: 'c1', status: 'approved_for_scheduling' })).toBe('/dashboard/scheduler?card=c1')
    expect(cardHref('quality_checker', { id: 'c1', status: 'quality_check' })).toBe('/dashboard/scheduler?card=c1')
  })
  it('managers and general: the Editor board while being made, Post approval after', () => {
    for (const role of ['account_manager', 'super_admin', 'general'] as Role[]) {
      expect(cardHref(role, { id: 'c1', status: 'draft_uploaded' })).toBe('/dashboard/editor?card=c1')
      expect(cardHref(role, { id: 'c1', status: 'quality_check' })).toBe('/dashboard/editor?card=c1')
      expect(cardHref(role, { id: 'c1', status: 'client_review' })).toBe('/dashboard/scheduler?card=c1')
      expect(cardHref(role, { id: 'c1', status: 'scheduled' })).toBe('/dashboard/scheduler?card=c1')
    }
  })
  it('a shoot opens on its own page under Shoots', () => {
    expect(shootHref('s1')).toBe('/dashboard/production/shoots/s1')
    expect(pageOf(shootHref('s1'))).toBe('/dashboard/production')
  })
})

describe('the stage chips are the role’s own columns', () => {
  it('editor: the five Editor lanes, into the Editor board', () => {
    expect(overviewChips('editor').map(c => c.label)).toEqual(['In Progress', 'Quality check', 'With client', 'For Handoff', 'Done'])
    expect(overviewChips('editor').every(c => c.href.startsWith('/dashboard/editor?column='))).toBe(true)
  })
  it('scheduler: Ready to post, Booked in, Posted, into Post approval', () => {
    expect(overviewChips('scheduler').map(c => c.label)).toEqual(['Ready to post', 'Booked in', 'Posted'])
  })
  it('quality checker: the Quality check column and the plans to review', () => {
    expect(overviewChips('quality_checker').map(c => c.href)).toEqual(['/dashboard/scheduler?column=quality_check', '/dashboard/production'])
    expect(chipCount(overviewChips('quality_checker')[1], {}, 3)).toBe(3)
  })
  it('managers and general: the seven Post approval columns', () => {
    for (const role of ['account_manager', 'super_admin', 'general'] as Role[]) {
      expect(overviewChips(role).map(c => c.label)).toEqual(['Draft', 'Quality check', 'With client', 'Ready to post', 'Booked in', 'Posted', 'Delivered'])
    }
  })
  it('counts post cards by status into the chip’s columns', () => {
    const editorDone = overviewChips('editor').find(c => c.key === 'done')!
    expect(chipCount(editorDone, { scheduled: 2, published: 3, draft_uploaded: 9 })).toBe(5)
    const draft = overviewChips('super_admin')[0]
    expect(chipCount(draft, { draft_uploaded: 1, revision_required: 2 })).toBe(3)
  })
})

describe('who may create a post, and who is shown booking', () => {
  it('New post is for schedulers, general users, account managers and super admins — never a quality checker or an editor', () => {
    expect(mayCreatePost('scheduler')).toBe(true)
    expect(mayCreatePost('general')).toBe(true)
    expect(mayCreatePost('account_manager')).toBe(true)
    expect(mayCreatePost('super_admin')).toBe(true)
    expect(mayCreatePost('quality_checker')).toBe(false)
    expect(mayCreatePost('editor')).toBe(false)
    expect(mayCreatePost(null)).toBe(false)
  })
  it('booking affordances follow the Schedule page', () => {
    expect(mayBookPosts('scheduler')).toBe(true)
    expect(mayBookPosts('general')).toBe(true)
    expect(mayBookPosts('quality_checker')).toBe(false)
    expect(mayBookPosts('editor')).toBe(false)
  })
  it('a link a role lacks is not allowed', () => {
    expect(linkAllowed('editor', '/dashboard/scheduler?column=ready_to_post')).toBe(false)
    expect(linkAllowed('quality_checker', '/dashboard/scheduler/calendar')).toBe(false)
    expect(linkAllowed('scheduler', '/dashboard/scheduler/calendar')).toBe(true)
  })
})
