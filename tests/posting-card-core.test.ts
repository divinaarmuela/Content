import { describe, it, expect } from 'vitest'
import {
  choosePlatform, derivePostingState, platformLabel, postingPrimaryLabel,
  statusAfterQueue, systemActorLabel, systemMayMove, systemPublishSteps,
  type PostingEntry, type PostingInput, type PostingJob,
} from '../app/lib/posting-card-core'

const NOW = Date.parse('2026-08-27T10:00:00+10:00')

const job = (over: Partial<PostingJob> = {}): PostingJob => ({
  id: 'job-1', status: 'queued', scheduled_for: null, permalink: null, error: null, ...over,
})

const entry = (over: Partial<PostingEntry> = {}): PostingEntry => ({
  platform: 'instagram', scheduled_at: null, live_url: null, publish_status: 'pending', ...over,
})

const state = (over: Partial<PostingInput> = {}) => derivePostingState({
  connected: ['instagram'], platform: 'instagram', entries: [], job: null,
  configured: true, now: NOW, ...over,
})

describe('choosePlatform', () => {
  it('prefers a target the client actually has connected', () => {
    expect(choosePlatform(['tiktok', 'instagram'], ['instagram'])).toBe('instagram')
  })

  it('falls back to the first target when none of them is connected', () => {
    expect(choosePlatform(['tiktok', 'facebook'], ['instagram'])).toBe('tiktok')
  })

  it('uses the one connected channel when the item names no targets', () => {
    expect(choosePlatform([], ['facebook'])).toBe('facebook')
  })

  it('still names something when there is nothing to go on', () => {
    expect(choosePlatform([], [])).toBe('instagram')
  })

  it('is case-insensitive about targets', () => {
    expect(choosePlatform(['Instagram'], ['instagram'])).toBe('instagram')
  })
})

describe('derivePostingState — the card has exactly one state', () => {
  it('is not_configured when no provider exists', () => {
    expect(state({ configured: false, connected: [] }).kind).toBe('not_configured')
  })

  it('is not_connected when this client has no account for the platform', () => {
    expect(state({ connected: ['facebook'] })).toMatchObject({
      kind: 'not_connected', platform: 'instagram',
    })
  })

  it('is ready when connected with nothing in flight', () => {
    const s = state({ entries: [entry({ scheduled_at: '2026-08-28T09:00:00+10:00' })] })
    expect(s).toMatchObject({ kind: 'ready', past: false })
  })

  it('reads a time already gone as "post now", not as a schedule', () => {
    const s = state({ entries: [entry({ scheduled_at: '2026-08-01T09:00:00+10:00' })] })
    expect(s).toMatchObject({ kind: 'ready', past: true })
  })

  it('treats no time at all as "post now"', () => {
    expect(state()).toMatchObject({ kind: 'ready', when: null, past: true })
  })

  it('is queued while ours', () => {
    const s = state({ job: job({ status: 'queued', scheduled_for: '2026-08-28T09:00:00+10:00' }) })
    expect(s).toMatchObject({ kind: 'queued', handedOver: false, when: '2026-08-28T09:00:00+10:00' })
  })

  it('is queued and handed over once the provider holds it', () => {
    expect(state({ job: job({ status: 'scheduled' }) })).toMatchObject({
      kind: 'queued', handedOver: true,
    })
  })

  it('is posted once the provider says so, with the permalink', () => {
    const s = state({
      job: job({ status: 'published', permalink: 'https://instagram.com/p/x', published_at: '2026-08-27T09:00:00+10:00' }),
    })
    expect(s).toMatchObject({ kind: 'posted', manual: false, permalink: 'https://instagram.com/p/x' })
  })

  it('counts a provider duplicate as posted — the post IS live', () => {
    expect(state({ job: job({ status: 'duplicate' }) }).kind).toBe('posted')
  })

  it('is posted-by-hand when a human recorded it and no job did', () => {
    const s = state({
      job: null,
      entries: [entry({ publish_status: 'published', live_url: 'https://instagram.com/p/y' })],
    })
    expect(s).toMatchObject({ kind: 'posted', manual: true, permalink: 'https://instagram.com/p/y' })
  })

  it('is failed, never silent, when the provider refused', () => {
    expect(state({ job: job({ status: 'failed', error: 'Media too long' }) })).toMatchObject({
      kind: 'failed', error: 'Media too long', jobId: 'job-1',
    })
  })

  it('never leaves a failure without words', () => {
    const s = state({ job: job({ status: 'failed', error: '   ' }) })
    expect(s.kind === 'failed' && s.error.length > 0).toBe(true)
  })

  it('a cancelled job leaves the card ready again', () => {
    expect(state({ job: job({ status: 'cancelled' }) }).kind).toBe('ready')
  })

  it('a live post outranks a disconnected account — never "connect this" over a published post', () => {
    const s = state({
      connected: [],
      configured: false,
      job: job({ status: 'published' }),
    })
    expect(s.kind).toBe('posted')
  })

  it('a failure outranks the connection question', () => {
    expect(state({ connected: [], job: job({ status: 'failed', error: 'nope' }) }).kind).toBe('failed')
  })

  it('an in-flight job outranks a stale published entry for another platform', () => {
    const s = state({
      job: job({ status: 'queued' }),
      entries: [entry({ platform: 'facebook', publish_status: 'published' })],
    })
    expect(s.kind).toBe('queued')
  })
})

describe('postingPrimaryLabel — one action, named after the channel', () => {
  it('schedules on the platform when the time is ahead', () => {
    expect(postingPrimaryLabel(state({ entries: [entry({ scheduled_at: '2026-08-28T09:00:00+10:00' })] })))
      .toBe('Schedule on Instagram')
  })

  it('posts now when the time has passed', () => {
    expect(postingPrimaryLabel(state())).toBe('Post now on Instagram')
  })

  it('offers the connect link when the client is not connected', () => {
    expect(postingPrimaryLabel(state({ connected: [] }))).toBe('Send the client a connect link')
  })

  it('offers a retry on failure', () => {
    expect(postingPrimaryLabel(state({ job: job({ status: 'failed', error: 'x' }) }))).toBe('Retry')
  })

  it('offers nothing at all once it is out', () => {
    expect(postingPrimaryLabel(state({ job: job({ status: 'published' }) }))).toBeNull()
  })
})

describe('platformLabel', () => {
  it('says the names people say', () => {
    expect(platformLabel('instagram')).toBe('Instagram')
    expect(platformLabel('tiktok')).toBe('TikTok')
    expect(platformLabel('twitter')).toBe('X')
  })

  it('capitalises anything it has not met', () => {
    expect(platformLabel('mastodon')).toBe('Mastodon')
  })

  it('never renders an empty name', () => {
    expect(platformLabel('')).toBe('the channel')
  })
})

describe('queueing IS scheduling', () => {
  it('moves an approved item to scheduled', () => {
    expect(statusAfterQueue('approved_for_scheduling')).toBe('scheduled')
  })

  it('is idempotent — an already-scheduled item moves nowhere', () => {
    expect(statusAfterQueue('scheduled')).toBeNull()
  })

  it('never drags an unapproved item forward', () => {
    expect(statusAfterQueue('client_review')).toBeNull()
    expect(statusAfterQueue('draft_uploaded')).toBeNull()
    expect(statusAfterQueue('published')).toBeNull()
  })
})

describe('the provider confirming a post', () => {
  it('takes a scheduled item to published in one step', () => {
    expect(systemPublishSteps('scheduled')).toEqual(['published'])
  })

  it('walks the edge that was missed when the item is still approved', () => {
    expect(systemPublishSteps('approved_for_scheduling')).toEqual(['scheduled', 'published'])
  })

  it('does nothing for an item already published', () => {
    expect(systemPublishSteps('published')).toEqual([])
  })

  it('will not resurrect an item that went backwards', () => {
    expect(systemPublishSteps('revision_required')).toEqual([])
    expect(systemPublishSteps('client_review')).toEqual([])
  })

  it('allows only the two automatic edges, ever', () => {
    expect(systemMayMove('scheduled', 'published')).toBe(true)
    expect(systemMayMove('approved_for_scheduling', 'scheduled')).toBe(true)
    expect(systemMayMove('client_review', 'approved_for_scheduling')).toBe(false)
    expect(systemMayMove('internal_review', 'published')).toBe(false)
    expect(systemMayMove('draft_uploaded', 'internal_review')).toBe(false)
  })

  it('credits the channel that did it', () => {
    expect(systemActorLabel(['instagram'])).toBe('Posted by Instagram')
    expect(systemActorLabel(['instagram', 'facebook'])).toBe('Posted by Instagram & Facebook')
  })

  it('says something sensible when the platforms are unknown', () => {
    expect(systemActorLabel([])).toBe('Posted by the connected account')
  })
})
