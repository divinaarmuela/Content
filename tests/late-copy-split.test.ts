import { describe, expect, it } from 'vitest'
import { LATE_COPY_LIMIT_MS, LATE_COPY_UNSENT, TIME_PASSED_UNSENT, postNetworkOutcomes, providerTiming } from '../app/lib/post-outcome-core'
import { lateChildJobFor, lateSplitPlan } from '../app/lib/publish-core'

// Jordan Wilson's 6:30 pm post, 20 Oct 2026: LinkedIn and TikTok's copies ready at 5:32, Instagram's at 7:02
const SLOT = '2026-10-20T07:30:00.000Z'
const at = (iso: string) => new Date(iso)
const targets = [{ platform: 'linkedin' }, { platform: 'instagram' }, { platform: 'tiktok' }]
const parent = { id: 'p1', caption: 'c', media: [{ url: 'https://x/master.mp4', type: 'video' }], targets, scheduled_for: SLOT }

describe('a late copy keeps trying for 3 hours', () => {
  it('a job waiting on its copy goes at once up to 3 hours late', () => {
    expect(providerTiming({ scheduled_for: SLOT, waiting_on_copy: true }, at('2026-10-20T08:02:00Z'))).toEqual({ send: 'now' })
    expect(providerTiming({ scheduled_for: SLOT, waiting_on_copy: true }, at('2026-10-20T10:31:00Z'))).toEqual({ send: 'refuse', reason: LATE_COPY_UNSENT })
  })
  it('a job late for any other reason still stops at 15 minutes', () => {
    expect(providerTiming({ scheduled_for: SLOT }, at('2026-10-20T07:50:00Z'))).toEqual({ send: 'refuse', reason: TIME_PASSED_UNSENT })
  })
  it('a split-off network goes at once until 3 hours past the post\'s time', () => {
    const child = { scheduled_for: '2026-10-20T07:35:00Z', resend_of: 'p1', late_slot: SLOT }
    expect(providerTiming(child, at('2026-10-20T08:02:00Z'))).toEqual({ send: 'now' })
    expect(providerTiming(child, new Date(Date.parse(SLOT) + LATE_COPY_LIMIT_MS + 60_000))).toEqual({ send: 'refuse', reason: LATE_COPY_UNSENT })
  })
  it('a split-off network made before the time is still held for the time', () => {
    const child = { scheduled_for: SLOT, resend_of: 'p1', late_slot: SLOT }
    expect(providerTiming(child, at('2026-10-20T07:20:00Z'))).toEqual({ send: 'at', at: SLOT })
  })
})

describe('what is ready goes on time', () => {
  it('splits the waiting network off near the time', () => {
    expect(lateSplitPlan(parent, ['instagram'], at('2026-10-20T07:20:00Z'))).toEqual(['instagram'])
    expect(lateSplitPlan(parent, ['instagram'], at('2026-10-20T07:31:00Z'))).toEqual(['instagram'])
  })
  it('does not split long before the time: it waits as before', () => {
    expect(lateSplitPlan(parent, ['instagram'], at('2026-10-20T06:30:00Z'))).toEqual([])
  })
  it('does not split when every network is waiting, a re-send, or one already split', () => {
    expect(lateSplitPlan(parent, ['instagram', 'linkedin', 'tiktok'], at('2026-10-20T07:31:00Z'))).toEqual([])
    expect(lateSplitPlan({ ...parent, resend_of: 'x' }, ['instagram'], at('2026-10-20T07:31:00Z'))).toEqual([])
    expect(lateSplitPlan({ ...parent, resent_platforms: ['instagram'] }, ['instagram'], at('2026-10-20T07:31:00Z'))).toEqual([])
  })
  it('the split-off job is the one network, the master file, and remembers the post\'s time', () => {
    const row = lateChildJobFor(parent, 'instagram', { id: 'c1', requestId: 'r1' }, at('2026-10-20T07:31:00Z'))!
    expect(row.targets).toEqual([{ platform: 'instagram' }])
    expect(row.media).toEqual(parent.media)
    expect(row.resend_of).toBe('p1')
    expect(row.late_slot).toBe(SLOT)
    expect(row.scheduled_for).toBe('2026-10-20T07:31:00.000Z')
    const early = lateChildJobFor(parent, 'instagram', { id: 'c2', requestId: 'r2' }, at('2026-10-20T07:20:00Z'))!
    expect(early.scheduled_for).toBe(SLOT)
  })
})

describe('the post still counts the split-off network', () => {
  const live = (p: string) => ({ platform: p, status: 'published', at: '2026-10-20T07:30:05Z', url: null })
  const parentJob = { id: 'p1', status: 'published', targets: [{ platform: 'linkedin' }, { platform: 'tiktok' }], platform_results: [live('linkedin'), live('tiktok')], created_at: '2026-10-20T06:23:00Z' }
  it('is not out while the late network waits', () => {
    const child = { id: 'c1', resend_of: 'p1', late_slot: SLOT, status: 'queued', targets: [{ platform: 'instagram' }], scheduled_for: SLOT, created_at: '2026-10-20T07:31:00Z' }
    const r = postNetworkOutcomes([parentJob, child] as never)
    expect(r.platforms.sort()).toEqual(['instagram', 'linkedin', 'tiktok'])
    expect(r.outcomes.instagram.status).toBe('scheduled')
    expect(r.outcomes.linkedin.status).toBe('published')
  })
  it('is out on all three once it goes', () => {
    const child = { id: 'c1', resend_of: 'p1', late_slot: SLOT, status: 'published', targets: [{ platform: 'instagram' }], platform_results: [live('instagram')], created_at: '2026-10-20T07:31:00Z' }
    const r = postNetworkOutcomes([parentJob, child] as never)
    expect(Object.values(r.outcomes).every(o => o.status === 'published')).toBe(true)
  })
  it('a plain re-send still does not add a network', () => {
    const child = { id: 'c1', resend_of: 'p1', status: 'queued', targets: [{ platform: 'instagram' }], created_at: '2026-10-20T07:31:00Z' }
    expect(postNetworkOutcomes([parentJob, child] as never).platforms.sort()).toEqual(['linkedin', 'tiktok'])
  })
})
