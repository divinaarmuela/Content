import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { samePostKey } from '../app/lib/social-schedule-core'

/**
 * A STORY IS ITS OWN POST (the owner, 15 Sep 2026: "the Story dropdown, when
 * picked, does not allow me to post" — three presses, three 409s, because the
 * picture was already on an open feed post — and "it's showing me captions as
 * an option, which is not an option on a Story").
 */
const pic = [{ url: 'https://cdn/x/spring.jpg' }]

describe('samePostKey — when two posts are the same post', () => {
  it('the same files to the same channels as the same kinds: one post pressed twice', () => {
    const a = samePostKey(pic, ['ig-1'], { 'ig-1': { kind: 'feed' } })
    const b = samePostKey([{ url: 'https://cdn/x/spring.jpg' }], ['ig-1'], { 'ig-1': { kind: 'feed' } })
    expect(a).toBe(b)
  })
  it('the same picture as a Story is a second post', () => {
    const feed = samePostKey(pic, ['ig-1'], { 'ig-1': { kind: 'feed' } })
    const story = samePostKey(pic, ['ig-1'], { 'ig-1': { kind: 'story' } })
    expect(story).not.toBe(feed)
  })
  it('the same picture to a different channel is a second post; channel order does not matter', () => {
    expect(samePostKey(pic, ['ig-1'], {})).not.toBe(samePostKey(pic, ['fb-1'], {}))
    expect(samePostKey(pic, ['ig-1', 'fb-1'], {})).toBe(samePostKey(pic, ['fb-1', 'ig-1'], {}))
  })
  it('different files are different posts, whatever else matches; an unset kind reads as none', () => {
    expect(samePostKey(pic, ['ig-1'], {})).not.toBe(samePostKey([{ url: 'https://cdn/x/other.jpg' }], ['ig-1'], {}))
    expect(samePostKey(pic, ['ig-1'], null)).toBe(samePostKey(pic, ['ig-1'], { 'ig-1': { kind: null } }))
  })
})

describe('the gate and the composer (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the one-open-post lock compares files AND where they go, and a post not yet written still holds', () => {
    const s = src('app/lib/social-schedule.ts')
    expect(s).toContain('const wanted = samePostKey(input.slides, input.channels, input.perChannel as never)')
    expect(s).toContain('if (theirFiles.length === 0) return true')
    expect(s).toContain('const theirs = samePostKey(theirFiles, asArray<string>(held.channels), (held.per_channel ?? null) as never)')
    expect(s).toContain('if (theirs === wanted) return true')
  })
  it('the composer hides the caption box when every chosen channel is getting a Story', () => {
    const d = src('app/dashboard/social/schedule/NewPostDialog.tsx')
    expect(d).toContain('const allStory = chosen.length > 0 && chosen.every(a => {')
    expect(d).toContain("return k === 'story'")
    expect(d).toContain('A Story has no caption — put any words into the picture or video itself.')
    expect(d).toMatch(/\{allStory \? \(\s*<p className="[^"]*" data-story-no-caption>/)
  })
})
