import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bookedChange, REWORD_LEAD_MS, TOO_LATE_TO_REWORD } from '../app/lib/social-schedule-core'

/**
 * THE WORDS OF A BOOKED POST (Raina, 22 Sep 2026: "I wanted to edit the caption
 * of a scheduled post but I'm not able to — do I have to discard it first and
 * create a new one?").
 */
const post = { caption: 'Old words', slides: [{ url: 'a.jpg' }], channels: ['c1'], per_channel: { c1: { igCover: 2 } }, scheduled_for: '2026-09-22T11:15:00.000Z' }

describe('what a change to a booked post is', () => {
  it('the same words, or nothing sent, is nothing to do', () => {
    expect(bookedChange(post, {})).toBe('none')
    expect(bookedChange(post, { caption: 'Old words' })).toBe('none')
    expect(bookedChange(post, { caption: 'Old words', slides: post.slides, channels: ['c1'], per_channel: post.per_channel, scheduled_for: post.scheduled_for })).toBe('none')
  })
  it('new words alone are a reword', () => {
    expect(bookedChange(post, { caption: 'New words' })).toBe('caption')
    expect(bookedChange(post, { caption: 'New words', slides: post.slides, channels: ['c1'] })).toBe('caption')
  })
  it('media, channels, their settings or the time changing is still cancel-and-remake', () => {
    expect(bookedChange(post, { caption: 'New words', slides: [{ url: 'b.jpg' }] })).toBe('other')
    expect(bookedChange(post, { channels: ['c1', 'c2'] })).toBe('other')
    expect(bookedChange(post, { per_channel: { c1: { igCover: 5 } } })).toBe('settings')
    expect(bookedChange(post, { caption: 'Old words', per_channel: post.per_channel })).toBe('none')
    expect(bookedChange(post, { scheduled_for: '2026-09-23T11:15:00.000Z' })).toBe('other')
  })
  it('a minute out is too late', () => {
    expect(REWORD_LEAD_MS).toBe(60_000)
    expect(TOO_LATE_TO_REWORD).toContain('Cancel it instead')
  })
  it('a booked post is not reworded in place; the window shows the frozen version and offers Edit', () => {
    // the posting rebuild (29 Sep 2026, decision 8): rewordBooked is gone from the server; an edit makes version N+1
    const s = readFileSync('app/lib/social-schedule.ts', 'utf8')
    expect(s).not.toContain('export async function rewordBooked(')
    // THE POSTING REBUILD (29 Sep 2026, the owner's decision 8): a booked post's
    // words are no longer changed in place — the window shows the frozen
    // version read only, and "Edit" (take it off the schedule, make version
    // N+1) is a footer button like every other move.
    const d = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(d).toContain('readOnly={!editable}')
    expect(d).not.toContain('bookedWords')
    expect(d).toContain('locked={locked}')
  })
})
