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
