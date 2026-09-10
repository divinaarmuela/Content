import { describe, expect, it } from 'vitest'
import { TRIAL_CHOICES, TRIAL_MIN_FOLLOWERS, isTrialTarget, latestFollowerCount, postTrial, trialFollowersProblem, trialWords } from '../app/lib/trial-reel-core'
import { cardBookingLine, jobIsTrial, outcomesForJob, type OutcomeJob } from '../app/lib/post-outcome-core'
import { buildPostPreview, forClient } from '../app/lib/post-preview-core'

/* ── Trial Reels are a post type, said everywhere the same (10 Sep 2026) ── */

describe('is this a trial', () => {
  it('only an Instagram Reel with a strategy is one', () => {
    expect(isTrialTarget('instagram', { kind: 'reel', trialGraduation: 'MANUAL' })).toBe(true)
    expect(isTrialTarget('instagram', { trialGraduation: 'SS_PERFORMANCE' })).toBe(true)
    expect(isTrialTarget('instagram', { kind: 'story', trialGraduation: 'MANUAL' })).toBe(false)
    expect(isTrialTarget('instagram', { kind: 'reel' })).toBe(false)
    expect(isTrialTarget('tiktok', { kind: 'reel', trialGraduation: 'MANUAL' })).toBe(false)
    expect(isTrialTarget('instagram', { kind: 'reel', trialGraduation: 'nope' })).toBe(false)
  })
  it('reads the strategy off a post’s per-channel extras by account', () => {
    const accounts = [{ id: 'ig', platform: 'instagram' }, { id: 'tt', platform: 'tiktok' }]
    expect(postTrial({ ig: { trialGraduation: 'MANUAL' } }, accounts)).toBe('MANUAL')
    expect(postTrial({ tt: { trialGraduation: 'MANUAL' } }, accounts)).toBeNull()
    expect(postTrial(null, accounts)).toBeNull()
  })
  it('has words for both strategies and none for an ordinary Reel', () => {
    expect(trialWords('MANUAL')).toMatch(/^Trial Reel · non-followers first, we decide/)
    expect(trialWords('SS_PERFORMANCE')).toMatch(/Instagram decides/)
    expect(trialWords(undefined)).toBeNull()
    expect(TRIAL_CHOICES.map(c => c.value)).toEqual(['', 'MANUAL', 'SS_PERFORMANCE'])
  })
})

describe('the record and the card', () => {
  const job: OutcomeJob = {
    id: 'j', status: 'scheduled', media: [{ url: 'https://r2/x.mp4', type: 'video' }],
    targets: [{ platform: 'instagram', options: { kind: 'reel', trialGraduation: 'SS_PERFORMANCE' } }, { platform: 'tiktok' }],
    scheduled_for: '2026-09-11T02:00:00Z', published_at: null, created_at: '2026-09-10T01:00:00Z', updated_at: '2026-09-10T01:00:00Z',
    error: null, permalink: null,
  }
  it('names the Instagram channel a Trial Reel and TikTok a Video', () => {
    const kinds = Object.fromEntries(outcomesForJob(job).map(o => [o.platform, o.kind]))
    expect(kinds).toEqual({ instagram: 'Trial Reel', tiktok: 'Video' })
    expect(jobIsTrial(job)).toBe(true)
    expect(jobIsTrial({ ...job, targets: [{ platform: 'instagram', options: { kind: 'reel' } }] })).toBe(false)
  })
  it('the Post approval card line ends with Trial Reel', () => {
    const line = cardBookingLine(
      [{ status: 'scheduled', publish_job_ids: ['j'], scheduled_for: job.scheduled_for }],
      new Map([['j', job]]), null, iso => iso.slice(11, 16))
    expect(line).toBe('Booked on Instagram, TikTok · 02:00 · Trial Reel')
  })
})

describe('the preview frame', () => {
  it('marks the Instagram frame a trial and hands the same words to the client', () => {
    const p = buildPostPreview({
      caption: 'hi', media: [{ url: 'https://r2/x.mp4', type: 'video' }],
      channels: [
        { id: 'ig', platform: 'instagram', options: { trialGraduation: 'MANUAL' } },
        { id: 'tt', platform: 'tiktok', options: {} },
      ],
    })
    const ig = p.networks.find(n => n.platform === 'instagram')!
    expect(ig.trial).toMatch(/^Trial Reel/)
    expect(p.networks.find(n => n.platform === 'tiktok')!.trial).toBeNull()
    expect(forClient(ig).trial).toBe(ig.trial)
  })
})

describe('Instagram’s floor: 1,000 followers', () => {
  it('reads the newest count for the account, and only that account', () => {
    const rows = [
      { account_id: 'ig', count: 3, taken_at: '2026-09-10T02:00:00Z' },
      { account_id: 'ig', count: 2, taken_at: '2026-09-09T02:00:00Z' },
      { account_id: 'other', count: 4361, taken_at: '2026-09-10T03:00:00Z' },
    ]
    expect(latestFollowerCount(rows, 'ig')).toBe(3)
    expect(latestFollowerCount(rows, 'nobody')).toBeNull()
  })
  it('refuses under the floor with the count in the sentence, and says nothing above it or when nobody has counted', () => {
    expect(TRIAL_MIN_FOLLOWERS).toBe(1000)
    expect(trialFollowersProblem(3, 'testbusinessaccount2026')).toBe(
      '@testbusinessaccount2026 has 3 followers — Instagram only allows Trial Reels on accounts with 1,000 or more. Post it as a Reel instead.')
    expect(trialFollowersProblem(1709, 'x')).toBeNull()
    expect(trialFollowersProblem(null, 'x')).toBeNull()
  })
})
