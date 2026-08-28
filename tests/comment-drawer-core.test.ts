import { describe, expect, it } from 'vitest'
import {
  commentBadge, commentsParamOf, withCommentsParam,
} from '../app/lib/comment-drawer-core'

describe('commentsParamOf', () => {
  it('reads the item id out of a ?comments= deep link', () => {
    expect(commentsParamOf('?comments=abc-123')).toBe('abc-123')
  })
  it('works with or without the leading question mark', () => {
    expect(commentsParamOf('comments=abc')).toBe('abc')
  })
  it('finds it among other parameters', () => {
    expect(commentsParamOf('?view=board&comments=abc&client=x')).toBe('abc')
  })
  it('is null when absent, empty, or whitespace', () => {
    expect(commentsParamOf('')).toBeNull()
    expect(commentsParamOf('?view=board')).toBeNull()
    expect(commentsParamOf('?comments=')).toBeNull()
    expect(commentsParamOf('?comments=%20%20')).toBeNull()
  })
})

describe('withCommentsParam', () => {
  it('adds the parameter to a bare path', () => {
    expect(withCommentsParam('/dashboard/editor', '', 'abc'))
      .toBe('/dashboard/editor?comments=abc')
  })
  it('keeps every other parameter when opening', () => {
    expect(withCommentsParam('/dashboard/editor', '?view=board&client=x', 'abc'))
      .toBe('/dashboard/editor?view=board&client=x&comments=abc')
  })
  it('removes ONLY the comments parameter when closing', () => {
    expect(withCommentsParam('/dashboard/editor', '?view=board&comments=abc', null))
      .toBe('/dashboard/editor?view=board')
  })
  it('closing with no other parameters leaves a clean path — no dangling ?', () => {
    expect(withCommentsParam('/dashboard/editor', '?comments=abc', null))
      .toBe('/dashboard/editor')
  })
  it('replaces an existing comments id rather than doubling it', () => {
    expect(withCommentsParam('/dashboard/editor', '?comments=old', 'new'))
      .toBe('/dashboard/editor?comments=new')
  })
  it('treats a blank id as closing', () => {
    expect(withCommentsParam('/dashboard/editor', '?comments=abc', '  '))
      .toBe('/dashboard/editor')
  })
})

describe('commentBadge', () => {
  it('an open tag with your name on it earns the dot and says why', () => {
    const b = commentBadge(true)
    expect(b.dot).toBe(true)
    expect(b.label).toMatch(/tagged you/)
  })
  it('no tag — no dot, plain label', () => {
    expect(commentBadge(false)).toEqual({ dot: false, label: 'Comments' })
    expect(commentBadge(undefined)).toEqual({ dot: false, label: 'Comments' })
  })
})
