import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  RESEND_GAP_MINUTES, childJobFor, isTransientPublishError, resendPlanFor, resendWords,
} from '../app/lib/publish-core'
import { foldResends, outcomesForJob } from '../app/lib/post-outcome-core'

/**
 * RE-SEND WHAT TIMED OUT, ONE NETWORK AT A TIME (Jordan Wilson's 7 pm post,
 * 24 Sep 2026).
 *
 * Instagram went in thirty seconds; Zernio's own upload of the 81 MB video to
 * LinkedIn and TikTok ran past its time limit and it gave up on both. Sent
 * again by hand — LinkedIn first, then TikTok alone from Zernio's copy — both
 * went out. That re-send is now the app's job.
 */
const job = {
  id: 'job-1', client_id: 'c1', content_item_id: 'i1', schedule_entry_id: null,
  caption: 'When I was working in a display…', timezone: 'Australia/Melbourne', created_by: 'hello@x',
  media: [{ type: 'video', url: 'https://media.zernio.com/temp/a.mov' }],
  targets: [
    { platform: 'linkedin', accountId: 'li' },
    { platform: 'instagram', accountId: 'ig' },
    { platform: 'tiktok', accountId: 'tt', options: { privacyLevel: 'PUBLIC_TO_EVERYONE', media: [{ type: 'video', url: 'https://media.zernio.com/temp/tt.mp4' }] } },
  ],
}
const TIMED_OUT = 'Publishing timed out during platform API call. The post may have been published externally. Check the platform before retrying.'
const outcomes = [
  { platform: 'instagram', status: 'published', reason: null },
  { platform: 'linkedin', status: 'failed', reason: TIMED_OUT },
  { platform: 'tiktok', status: 'failed', reason: 'Video download timed out. The file may be too large or the connection too slow.' },
]

describe('which networks get re-sent', () => {
  it('the ones that failed for a transient reason — the live one and the fine ones are left alone', () => {
    expect(resendPlanFor(job, outcomes)).toEqual(['linkedin', 'tiktok'])
  })

  it('never a failure that says something is wrong with the post', () => {
    // the 100 Hundred Million Group post of the same evening: a webp Instagram refuses is not a timeout
    expect(isTransientPublishError('Instagram Image 7: Unsupported image format: webp')).toBe(false)
    expect(isTransientPublishError('Instagram account is missing an access token. Please reconnect the account.')).toBe(false)
    expect(isTransientPublishError(TIMED_OUT)).toBe(true)
    expect(isTransientPublishError('Video download timed out')).toBe(true)
    expect(isTransientPublishError(null)).toBe(false)
    expect(resendPlanFor(job, [{ platform: 'tiktok', status: 'failed', reason: 'Unsupported image format: webp' }])).toEqual([])
  })

  it('once per network, and never for a re-send itself', () => {
    expect(resendPlanFor({ ...job, resent_platforms: ['linkedin'] }, outcomes)).toEqual(['tiktok'])
    expect(resendPlanFor({ ...job, resend_of: 'job-0' }, outcomes)).toEqual([])
    // a network the job never targeted is not invented from the provider's rows
    expect(resendPlanFor({ ...job, targets: [{ platform: 'tiktok' }] }, outcomes)).toEqual(['tiktok'])
  })
})

describe('the re-send job', () => {
  const now = new Date('2026-09-24T09:12:15.000Z')

  it('is the parent post to ONE network, from the media already relayed, spaced down the line', () => {
    const li = childJobFor(job, 'linkedin', 0, { id: 'child-1', requestId: 'req-1' }, now)!
    const tt = childJobFor(job, 'tiktok', 1, { id: 'child-2', requestId: 'req-2' }, now)!
    expect(li).toMatchObject({
      id: 'child-1', status: 'queued', attempts: 0, request_id: 'req-1', resend_of: 'job-1',
      client_id: 'c1', content_item_id: 'i1', caption: job.caption, timezone: 'Australia/Melbourne',
      scheduled_for: '2026-09-24T09:12:15.000Z',
    })
    expect(li.targets).toEqual([{ platform: 'linkedin', accountId: 'li' }])
    expect(li.media).toEqual(job.media)
    // TikTok keeps its own options and its own copy
    expect(tt.targets).toEqual([job.targets[2]])
    expect(tt.scheduled_for).toBe(new Date(now.getTime() + RESEND_GAP_MINUTES * 60_000).toISOString())
  })

  it('is nothing for a network the job did not target', () => {
    expect(childJobFor(job, 'youtube', 0, { id: 'x', requestId: 'y' }, now)).toBeNull()
  })

  it('says so on the parent row', () => {
    expect(resendWords(['linkedin', 'tiktok'])).toBe(' Re-sending linkedin, tiktok — one at a time, 3 minutes apart.')
    expect(resendWords([])).toBe('')
  })
})

describe('where it is wired', () => {
  it('both places a partial lands call it — the ten-minute sweep and the webhook', () => {
    const sweep = readFileSync('app/lib/publish.ts', 'utf8')
    expect(sweep).toContain('export async function resendTimedOut(job: PublishJobRow, outcomes: readonly PlatformOutcome[])')
    expect(sweep).toContain('await resendTimedOut(job, recorded)')
    // the parent is claimed on resent_platforms so the sweep and the webhook cannot both queue the same network
    expect(sweep).toContain('if (plan.some(p => have.includes(p))) return null')
    const hook = readFileSync('app/lib/zernio-webhook.ts', 'utf8')
    expect(hook).toContain("const { resendTimedOut } = await import('./publish')")
    expect(hook).toContain('for (const j of open) await resendTimedOut(j, recorded.get(j.id) ?? [])')
    // and it is best effort there: the failure is recorded first, and a re-send that cannot be queued is logged
    expect(hook.indexOf('platform_results: recorded.get(j.id)')).toBeLessThan(hook.indexOf("await import('./publish')"))
    expect(readFileSync('docs/schema-history/publish_resend.sql', 'utf8')).toContain('add column if not exists resend_of')
  })
})

describe('a re-send is the same post to everything that reads (the owner, 24 Sep 2026: "the post approval card mentions all 3 went live")', () => {
  const parent = {
    id: 'job-1', status: 'failed', resend_of: null, updated_at: '2026-09-24T09:12:15.000Z', permalink: 'https://ig/reel',
    targets: [{ platform: 'instagram' }, { platform: 'linkedin' }, { platform: 'tiktok' }],
    platform_results: [
      { platform: 'instagram', status: 'published', kind: 'Reel', reason: null, url: 'https://ig/reel', at: '2026-09-24T09:00:30.000Z' },
      { platform: 'linkedin', status: 'failed', kind: 'Video', reason: TIMED_OUT, url: null, at: '2026-09-24T09:12:15.000Z' },
      { platform: 'tiktok', status: 'failed', kind: 'Video', reason: TIMED_OUT, url: null, at: '2026-09-24T09:12:15.000Z' },
    ],
  }
  const li = { id: 'child-1', status: 'published', resend_of: 'job-1', updated_at: '2026-09-24T09:18:00.000Z', published_at: '2026-09-24T09:17:59.000Z', permalink: 'https://li/post',
    targets: [{ platform: 'linkedin' }], platform_results: [{ platform: 'linkedin', status: 'published', kind: 'Video', reason: null, url: 'https://li/post', at: '2026-09-24T09:17:59.000Z' }] }
  const tt = { id: 'child-2', status: 'scheduled', resend_of: 'job-1', updated_at: '2026-09-24T09:15:20.000Z', scheduled_for: '2026-09-24T09:15:15.000Z',
    targets: [{ platform: 'tiktok' }], platform_results: null }

  it('folds each child onto its parent and lists the parent once', () => {
    const folded = foldResends([parent, li, tt])
    expect(folded.map(j => j.id)).toEqual(['job-1'])
    const rows = outcomesForJob(folded[0])
    expect(rows.map(o => [o.platform, o.status])).toEqual([
      ['instagram', 'published'], ['linkedin', 'published'], ['tiktok', 'scheduled'],
    ])
    expect(rows.find(o => o.platform === 'linkedin')?.url).toBe('https://li/post')
    // one network still on its way: the post is not "published" yet
    expect(folded[0].status).toBe('failed')
  })

  it('reads published once every network is out', () => {
    const ttLive = { ...tt, status: 'published', updated_at: '2026-09-24T09:29:20.000Z', platform_results: [{ platform: 'tiktok', status: 'published', kind: 'Video', reason: null, url: null, at: '2026-09-24T09:29:14.000Z' }] }
    const [job] = foldResends([parent, li, ttLive])
    expect(job.status).toBe('published')
    expect(outcomesForJob(job).every(o => o.status === 'published')).toBe(true)
    expect(job.permalink).toBe('https://ig/reel')
  })

  it('leaves a job with no re-sends exactly as it was, and the card folds before it reads', () => {
    expect(foldResends([parent])).toEqual([parent])
    const card = readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')
    expect(card).toContain('foldResends(fileJobs as unknown as ResendJob[])')
  })
})
