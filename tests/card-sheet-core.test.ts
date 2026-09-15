import { describe, expect, it } from 'vitest'
import { isDismissSwipe, readCardParam, withCardParam } from '@/app/lib/card-sheet-core'

describe('the card in the address — ?card=<id>', () => {
  it('reads the id, with or without the leading ?', () => {
    expect(readCardParam('?card=abc123')).toBe('abc123')
    expect(readCardParam('card=abc123&column=draft')).toBe('abc123')
    expect(readCardParam('?column=draft')).toBeNull()
    expect(readCardParam('')).toBeNull()
    expect(readCardParam('?card=')).toBeNull()
  })

  it('adds the card and keeps everything else in the address', () => {
    expect(withCardParam('/dashboard/editor', 'x1')).toBe('/dashboard/editor?card=x1')
    expect(withCardParam('/dashboard/editor?column=draft#top', 'x1')).toBe('/dashboard/editor?column=draft&card=x1#top')
    expect(withCardParam('https://app.example.com/dashboard/scheduler?show=today', 'x1'))
      .toBe('https://app.example.com/dashboard/scheduler?show=today&card=x1')
  })

  it('replaces an open card and removes it on null', () => {
    expect(withCardParam('/dashboard/production?card=old', 'new')).toBe('/dashboard/production?card=new')
    expect(withCardParam('/dashboard/production?card=old', null)).toBe('/dashboard/production')
    expect(withCardParam('/dashboard/production?column=draft&card=old', null)).toBe('/dashboard/production?column=draft')
  })

  it('round-trips', () => {
    const href = withCardParam('/dashboard/editor?show=due', 'r2')
    expect(readCardParam(new URL(href, 'http://x').search)).toBe('r2')
    expect(readCardParam(new URL(withCardParam(href, null), 'http://x').search)).toBeNull()
  })
})

describe('swipe to shut', () => {
  it('counts a sideways drag past 80px, never a scroll', () => {
    expect(isDismissSwipe(90, 10)).toBe(true)
    expect(isDismissSwipe(79, 0)).toBe(false)
    expect(isDismissSwipe(-120, 0)).toBe(false)
    expect(isDismissSwipe(100, 90)).toBe(false)
  })
})

describe('who gets the maker’s drawer (the owner, 15 Sep 2026: "I assigned it to myself")', () => {
  it('an editor always; a general user when they hold the card; anyone who holds it while it is in Draft or back for changes', async () => {
    const { usesMakerDrawer, HELD_WHILE_MAKING } = await import('../app/lib/card-sheet-core')
    const card = (over: Record<string, unknown>) => ({ owner_id: 'sa', status: 'draft_uploaded', ...over })
    expect(HELD_WHILE_MAKING).toEqual(['draft_uploaded', 'revision_required'])
    expect(usesMakerDrawer({ id: 'ed', role: 'editor' }, card({ owner_id: 'x', status: 'quality_check' }))).toBe(true)
    // a super admin who assigned the card to themselves: the link box and the submit
    expect(usesMakerDrawer({ id: 'sa', role: 'super_admin' }, card({}))).toBe(true)
    expect(usesMakerDrawer({ id: 'sa', role: 'super_admin' }, card({ status: 'revision_required' }))).toBe(true)
    expect(usesMakerDrawer({ id: 'am', role: 'account_manager' }, card({ owner_id: 'am' }))).toBe(true)
    // …but once it is out of their hands, they manage it
    expect(usesMakerDrawer({ id: 'sa', role: 'super_admin' }, card({ status: 'quality_check' }))).toBe(false)
    expect(usesMakerDrawer({ id: 'sa', role: 'super_admin' }, card({ status: 'client_changes_requested' }))).toBe(false)
    expect(usesMakerDrawer({ id: 'sa', role: 'super_admin' }, card({ status: 'approved_for_scheduling' }))).toBe(false)
    // someone else's card: the manager's card, whatever its status
    expect(usesMakerDrawer({ id: 'sa', role: 'super_admin' }, card({ owner_id: 'ed' }))).toBe(false)
    // a general user holding the card, at any status
    expect(usesMakerDrawer({ id: 'g', role: 'general' }, card({ owner_id: 'g', status: 'quality_check' }))).toBe(true)
    expect(usesMakerDrawer({ id: 'g', role: 'general' }, card({ owner_id: 'ed' }))).toBe(false)
    expect(usesMakerDrawer(null, card({}))).toBe(false)
  })
})
