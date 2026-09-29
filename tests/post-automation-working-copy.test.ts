import { describe, expect, it } from 'vitest'
import { composerReducer, initialComposer } from '../app/lib/schedule-compose-core'
import { frozenCopyOf, hasUnsavedChanges, workingBody, workingCopyOf } from '../app/lib/post-window-core'
import { readPostState } from '../app/lib/post-stage-core'

/**
 * THE AUTOMATION RIDES IN THE WORKING COPY, like the caption (29 Sep 2026): read off the row, edited in
 * the window, sent by the save, and read back off a frozen version.
 */
const automation = {
  on: true, keywords: ['BOOK'], dm_message: 'Hi', button_title: null, link: 'https://x.co', comment_reply: 'Sent!',
  dm_variations: ['Hey'], reply_variations: [] as string[],
}
const row = { id: 'p1', client_id: 'c1', stage: 'draft', caption: 'c', channels: ['s1'], slides: [], automation }

describe('the engine and the dispatcher are wired to it', () => {
  it('a take-off (cancel, unbook, edit booked, a new time) switches it off BEFORE any re-booking', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/lib/post-stage.ts', 'utf8')
    const pause = src.indexOf("TAKES_OFF.includes(done.action) || done.effects.some(e => e.kind === 'reschedule_jobs')")
    const rebook = src.indexOf("if (effect.when === 'after' && effect.kind === 'queue_publish')")
    expect(pause).toBeGreaterThan(0)
    expect(pause).toBeLessThan(rebook)
    expect(src).toContain("const TAKES_OFF: readonly PostAction[] = ['unbook', 'edit_booked', 'cancel']")
  })

  it('the post hears its job, then the automation is armed (publish.ts tellThePost)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/lib/publish.ts', 'utf8')
    expect(src).toMatch(/recordPostOutcome\(jobId, opts\)[\s\S]{0,600}armPostAutomations\(jobId\)/)
  })
})

describe('the working copy round-trips the automation', () => {
  it('row → post → working copy → body', () => {
    const post = readPostState(row)!
    expect(post.automation).toEqual(automation)
    const w = workingCopyOf(post)
    expect(w.automation).toEqual(automation)
    expect(workingBody(w, 'Australia/Melbourne').automation).toEqual(automation)
  })

  it('a post with none reads exactly as before', () => {
    const post = readPostState({ ...row, automation: null })!
    expect(post).not.toHaveProperty('automation')
    expect(workingCopyOf(post)).not.toHaveProperty('automation')
  })

  it('a frozen version carries it', () => {
    expect(frozenCopyOf({ id: 'p1_v1', client_id: 'c1', n: 1, slides: [], channels: ['s1'], caption: 'c', automation })!.automation).toEqual(automation)
  })

  it('editing it in the window is an unsaved change; the same automation is not', () => {
    const s0 = initialComposer({ itemId: 'i', postId: 'p1', caption: 'c', channels: ['s1'], automation })
    const s1 = composerReducer(s0, { type: 'automation', automation: { ...automation, dm_message: 'Hello' } })
    expect(s1.dirty).toBe(true)
    expect(s1.automation?.dm_message).toBe('Hello')
    const base = { slides: [], caption: 'c', channels: ['s1'], perChannel: {}, scheduledFor: null, automation }
    expect(hasUnsavedChanges(base, { ...base, automation: { ...automation } }, true)).toBe(false)
    expect(hasUnsavedChanges(base, { ...base, automation: { ...automation, on: false } }, true)).toBe(true)
  })
})
