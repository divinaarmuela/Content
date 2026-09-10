import { describe, it, expect } from 'vitest'
import {
  channelLines, describeCardActivity, historyLines, HISTORY_PREVIEW,
  type HistoryActivity, type HistoryJob,
} from '../app/lib/card-history-core'

/**
 * "What happened" in the post approval drawer. The wording is pinned here:
 * every team role reads this list, and it is the only place a scheduler can
 * see that a post was sent to the client and came back.
 */

const act = (over: Partial<HistoryActivity> = {}): HistoryActivity => ({
  id: 'r1', created_at: '2026-09-08T01:00:00.000Z', action: 'created',
  actor_name: 'Ana', ...over,
})

const fmt = (iso: string) => `at ${iso}`

describe('one activity row in the card’s words', () => {
  const say = (over: Partial<HistoryActivity>) => describeCardActivity(act(over))?.text ?? null

  it('names the upload and every new version', () => {
    expect(say({ action: 'created' })).toBe('Uploaded by Ana')
    expect(say({ action: 'version_added', new_value: 'v3' })).toBe('New files uploaded by Ana · version 3')
  })

  it('says who it was sent to', () => {
    expect(say({ action: 'status_change', new_value: 'internal_review' }))
      .toBe('Sent for approval to the team by Ana')
    expect(say({ action: 'status_change', new_value: 'client_review' }))
      .toBe('Sent for approval to the client by Ana')
  })

  it('separates the team’s approval from the client’s', () => {
    expect(say({ action: 'status_change', new_value: 'approved_for_scheduling', old_value: 'internal_review' }))
      .toBe('Approved by Ana')
    expect(say({ action: 'status_change', new_value: 'approved_for_scheduling', old_value: 'client_review' }))
      .toBe('Approved by the client, logged by Ana')
  })

  it('says when changes were asked for, and by whom', () => {
    expect(say({ action: 'status_change', new_value: 'revision_required' })).toBe('Changes asked for by Ana')
    expect(say({ action: 'status_change', new_value: 'client_changes_requested' }))
      .toBe('Changes asked for by the client, logged by Ana')
    expect(say({ action: 'sent_back', detail: 'crop the logo' }))
      .toBe('Sent back for changes by Ana: “crop the logo”')
  })

  it('says it was handed on, booked and posted', () => {
    expect(say({ action: 'schedule_handoff' })).toBe('Handed to a scheduler by Ana')
    expect(say({ action: 'claimed', detail: 'scheduling' })).toBe('Scheduling taken by Ana')
    expect(say({ action: 'status_change', new_value: 'scheduled' })).toBe('Booked in by Ana')
    expect(say({ action: 'status_change', new_value: 'published' })).toBe('Marked posted by Ana')
  })

  it('covers the final-post gate', () => {
    expect(say({ action: 'posting_approval_sent' })).toBe('Final post sent for approval by Ana')
    expect(say({ action: 'posting_approved' })).toBe('Final post approved by Ana')
    expect(say({ action: 'posting_changes_requested', detail: 'swap photo 2' }))
      .toBe('Changes asked for on the final post by Ana: “swap photo 2”')
    expect(say({ action: 'posting_approval_reset' }))
      .toBe('Post changed after approval by Ana · it needs approving again')
  })

  it('names the file a by-hand post was, and takes its real time and link', () => {
    const said = describeCardActivity(act({
      action: 'posted_by_hand', new_value: '2 of 5',
      detail: 'posted 2026-09-07T09:00:00.000Z · https://instagram.com/p/x',
    }))
    expect(said).toEqual({
      text: 'Posted by hand by Ana · file 2 of 5',
      at: '2026-09-07T09:00:00.000Z',
      href: 'https://instagram.com/p/x',
    })
  })

  it('says nothing for the rows the thread below already says', () => {
    expect(describeCardActivity(act({ action: 'comment_added' }))).toBeNull()
    expect(describeCardActivity(act({ action: 'updated' }))).toBeNull()
    expect(describeCardActivity(act({ action: 'deleted' }))).toBeNull()
  })

  it('never leaves a blank where a name should be', () => {
    expect(say({ actor_name: null })).toBe('Uploaded by someone')
  })
})

describe('what each channel did', () => {
  const job = (over: Partial<HistoryJob> = {}): HistoryJob => ({
    id: 'j1', status: 'published',
    targets: [{ platform: 'instagram' }] as never,
    published_at: '2026-09-09T04:00:00.000Z',
    permalink: 'https://instagram.com/p/abc',
    ...over,
  })

  it('says it went out, with the link', () => {
    expect(channelLines(job(), fmt)).toEqual([{
      key: 'job-j1-instagram-0', at: '2026-09-09T04:00:00.000Z',
      text: 'Went out on Instagram', href: 'https://instagram.com/p/abc',
    }])
  })

  it('says when a booked post is booked for', () => {
    const lines = channelLines(job({ status: 'scheduled', published_at: null, scheduled_for: '2026-09-20T09:00:00.000Z' }), fmt)
    expect(lines[0].text).toBe('Booked on Instagram for at 2026-09-20T09:00:00.000Z')
  })

  it('says which channel refused it and why', () => {
    const lines = channelLines(job({
      status: 'failed', published_at: null, error: 'the file is too big',
      targets: [{ platform: 'tiktok' }] as never,
    }), fmt)
    expect(lines[0].text).toBe('Did not go out on TikTok · the file is too big')
  })

  it('reads a part-success per channel, not one word for the job', () => {
    const lines = channelLines(job({
      status: 'failed', published_at: null,
      error: 'Went out on instagram. Did not go out on tiktok: too big.',
      targets: [{ platform: 'instagram' }, { platform: 'tiktok' }] as never,
    }), fmt)
    expect(lines.map(l => l.text)).toEqual([
      'Went out on Instagram',
      'Did not go out on TikTok · too big',
    ])
  })
})

describe('the whole list', () => {
  it('is newest first, and mixes the trail with the channels', () => {
    const lines = historyLines({
      activity: [
        act({ id: 'a', action: 'created', created_at: '2026-09-01T00:00:00.000Z' }),
        act({ id: 'b', action: 'status_change', new_value: 'client_review', created_at: '2026-09-02T00:00:00.000Z' }),
      ],
      jobs: [{
        id: 'j1', status: 'published', published_at: '2026-09-03T00:00:00.000Z',
        targets: [{ platform: 'instagram' }] as never, permalink: null,
      }],
      fmt,
    })
    expect(lines.map(l => l.text)).toEqual([
      'Went out on Instagram',
      'Sent for approval to the client by Ana',
      'Uploaded by Ana',
    ])
  })

  it('records a by-hand file the trail never logged', () => {
    const lines = historyLines({
      activity: [],
      postedSlides: { urls: ['u1'], posted: 1, total: 2, hand: [{ url: 'u1', at: '2026-09-04T00:00:00.000Z', link: 'https://x' }] },
      fmt,
    })
    expect(lines).toEqual([{ key: 'hand-u1', at: '2026-09-04T00:00:00.000Z', text: 'Posted by hand', href: 'https://x' }])
  })

  it('does not say a by-hand post twice when the trail has it', () => {
    const lines = historyLines({
      activity: [act({
        action: 'posted_by_hand', new_value: '1 of 2',
        detail: 'posted 2026-09-04T00:00:00.000Z',
      })],
      postedSlides: { urls: ['u1'], posted: 1, total: 2, hand: [{ url: 'u1', at: '2026-09-04T00:00:00.000Z', link: null }] },
      fmt,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Posted by hand by Ana · file 1 of 2')
  })

  it('is empty for a card nothing has happened to', () => {
    expect(historyLines({ activity: [], fmt })).toEqual([])
  })

  it('keeps the drawer short by default', () => {
    expect(HISTORY_PREVIEW).toBe(12)
  })
})
