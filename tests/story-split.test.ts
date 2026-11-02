import { describe, it, expect } from 'vitest'
import { storySplitPlan, allStories } from '../app/lib/post-stage-core'

// Renee, 2 Nov 2026: 2–3 Story frames for the same day and time, without making each one by hand
const slide = (u: string) => ({ url: u, type: 'image' }) as never
const post = (over: Record<string, unknown> = {}) => ({
  stage: 'ready', channels: ['ig'], per_channel: { ig: { kind: 'story' } },
  slides: [slide('a'), slide('b'), slide('c')], scheduled_for: '2026-11-03T04:00:00.000Z', ...over,
}) as never

describe('several pictures as Stories', () => {
  it('one Story per picture, in slide order, a minute apart', () => {
    const p = storySplitPlan(post())
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.parts.map(x => (x.slides[0] as { url: string }).url)).toEqual(['a', 'b', 'c'])
    expect(p.parts.map(x => x.scheduled_for)).toEqual(['2026-11-03T04:00:00.000Z', '2026-11-03T04:01:00.000Z', '2026-11-03T04:02:00.000Z'])
    expect(p.parts.map(x => `${x.n}/${x.of}`)).toEqual(['1/3', '2/3', '3/3'])
  })
  it('a draft or an approved post; never one waiting on a check or the client', () => {
    expect(storySplitPlan(post({ stage: 'draft' })).ok).toBe(true)
    expect(storySplitPlan(post({ stage: 'quality_check' })).ok).toBe(false)
    expect(storySplitPlan(post({ stage: 'with_client' })).ok).toBe(false)
  })
  it('only when every channel is a Story, and there is more than one picture', () => {
    expect(allStories({ channels: ['ig', 'fb'], per_channel: { ig: { kind: 'story' }, fb: { kind: 'feed' } } } as never)).toBe(false)
    expect(storySplitPlan(post({ channels: ['ig', 'fb'], per_channel: { ig: { kind: 'story' }, fb: { kind: 'feed' } } })).ok).toBe(false)
    expect(storySplitPlan(post({ slides: [slide('a')] })).ok).toBe(false)
  })
  it('no time yet: the Stories have none either', () => {
    const p = storySplitPlan(post({ stage: 'draft', scheduled_for: null }))
    expect(p.ok && p.parts.every(x => x.scheduled_for === null)).toBe(true)
  })
})

import { storyGapAfter } from '../app/lib/post-stage-core'

// the owner, 2 Nov 2026: "a video might take up 3 stories due to length make sure it goes after that"
describe('the wait after each Story', () => {
  it('a minute after a picture; after a video long enough for Instagram to take it in first', () => {
    expect(storyGapAfter({ type: 'image' } as never)).toBe(1)
    expect(storyGapAfter({ type: 'video', seconds: 15 } as never)).toBe(3)
    expect(storyGapAfter({ type: 'video', seconds: 60 } as never)).toBe(4)
    expect(storyGapAfter({ type: 'video' } as never)).toBe(4)
  })
  it('a video between pictures pushes everything after it on', () => {
    const p = storySplitPlan(post({ slides: [{ url: 'a', type: 'image' }, { url: 'v', type: 'video', seconds: 45 }, { url: 'c', type: 'image' }] }))
    expect(p.ok && p.parts.map(x => x.scheduled_for)).toEqual(['2026-11-03T04:00:00.000Z', '2026-11-03T04:01:00.000Z', '2026-11-03T04:05:00.000Z'])
  })
})

import { readFileSync } from 'node:fs'
import { ROW_OF } from '../app/lib/post-stage-core'

// the owner, 2 Nov 2026: "find a way that the first story goes out then the second and third and fourth"
describe('each Story goes only after the one before it is live', () => {
  const src = readFileSync('app/lib/post-stage.ts', 'utf8')
  it('the next Story is posted by the app, now, from Ready to post, and only by the app', () => {
    expect(ROW_OF.chain_post.who).toEqual(['system'])
    expect(ROW_OF.chain_post.from).toEqual(['ready'])
  })
  it('a person cannot book, post, schedule or retime a waiting Story ahead of the one before it', () => {
    expect(src).toContain("const CHAIN_HELD: readonly PostAction[] = ['book', 'post_now', 'schedule_direct', 'change_time']")
    expect(src).toContain('const waiting = await storyWaitingFor(')
  })
  it('a client approval never books Story 2 on for a time; every move checks whether the next Story may go', () => {
    expect(src).toContain('if (later && later.n > 1) return')
    expect(src).toContain("if (r.ok && action !== 'chain_post') void advanceStoryChain(postId)")
  })
  it('only Story 1 is booked from the window', () => {
    const win = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(win).toContain("api.act(made.postIds[0], { action: 'book'")
    // an approved set books only Story 1; a DRAFT set scheduled with Schedule it places each at its spaced time (2 Nov 2026)
    expect(win).toContain("if (storyPlan?.ok && (action === 'book' || action === 'schedule_direct'))")
  })
})

// 2 Nov 2026: Renee cancelled Story 1 of a Tuesday 3 pm pair and Story 2 went out at once, on the Monday
describe('a Story never goes out before its own time', () => {
  it('the next Story is booked for its own time while that is still ahead, posted now only once it has come', () => {
    const src = readFileSync('app/lib/post-stage.ts', 'utf8')
    expect(src).toContain("const ahead = Number.isFinite(due) && due - Date.now() > 15 * 60_000")
    expect(src).toContain("ahead ? 'auto_book' : 'chain_post'")
  })
})
