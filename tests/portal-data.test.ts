import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * Which pile a piece lands in on the client's portal — against a miniature
 * database, because the bucketing is the whole payload and a pure helper that
 * "would have" bucketed it is not the thing that ships.
 *
 * The case that brought this file into existence: an editor saves a new cut
 * while the piece is sitting with the client. The piece leaves client_review,
 * so the review card must be GONE — a client cannot be asked to approve a
 * version that no longer exists — and it must reappear under "In production"
 * saying, in words, that it is coming back.
 */

vi.mock('../app/lib/post-analytics', () => ({
  analyticsForItems: async () => new Map(),
  refreshStaleAnalyticsInBackground: vi.fn(),
}))

const { getPortalData } = await import('../app/lib/portal-data')
const { UPDATING_AFTER_REVIEW_LINE } = await import('../app/lib/portal-words')

const CLIENT = 'client-1'
const u = (n: string) => `https://media.mdmmarketing.com.au/${n}`

/** one status_change in the trail — created_at sorts as text */
const moved = (id: string, from: string, to: string, at: string) => ({
  id: `a-${id}-${at}`,
  entity_type: 'content_item', entity_id: id, action: 'status_change',
  old_value: from, new_value: to, created_at: at,
})

/** the fixture, rebuilt per test so a test can edit it before loading */
let item: Record<string, unknown>
let activity: Record<string, unknown>[]
let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  item = {
    id: 'item-1', client_id: CLIENT, title: 'Reel 01 — Hook',
    content_type: 'reel', status: 'client_review',
    updated_at: '2026-08-27T02:00:00.000Z', batch_id: null, work_kind_id: null,
  }
  activity = []
})
afterEach(() => fake?.restore())

/** seed the database as the test left the fixture, then load the portal */
const load = async () => {
  fake = seedDb({
    clients: [{ id: CLIENT, name: 'Nathan Homes', timezone: 'Australia/Melbourne' }] as unknown as Row[],
    team_user_clients: [],
    monthly_commitments: [],
    client_brand: [],
    batches: [],
    schedule_entries: [],
    workflow_activity: activity as unknown as Row[],
    content_items: [item] as unknown as Row[],
    asset_versions: [{
      id: 'v-1', item_id: 'item-1', version_number: 1,
      file_url: u('v1.mp4'), files: [], drive_url: '',
    }] as unknown as Row[],
  })
  return (await getPortalData(CLIENT))!
}

describe('the portal payload — where a piece sits', () => {
  it('a piece with the client is theirs to review, and says nothing extra', async () => {
    const data = await load()
    expect(data.needs_review.map(i => i.id)).toEqual(['item-1'])
    expect(data.in_production).toEqual([])
    expect(data.needs_review[0].progress_line).toBeNull()
  })

  it('a new version pulls it out of review and into production, with a reason', async () => {
    // exactly what the versions endpoint does when a cut is saved on a piece
    // that is sitting with the client
    item.status = 'internal_review'
    activity = [
      moved('item-1', 'internal_review', 'client_review', '2026-08-26T01:00:00.000Z'),
      moved('item-1', 'client_review', 'internal_review', '2026-08-27T02:00:00.000Z'),
    ]

    const data = await load()
    // the review card is GONE — nobody may be asked to approve a version that
    // has already been replaced
    expect(data.needs_review).toEqual([])
    expect(data.in_production.map(i => i.id)).toEqual(['item-1'])
    const card = data.in_production[0]
    expect(card.progress_line).toBe(UPDATING_AFTER_REVIEW_LINE)
    // …and the status word is the same calm one every internal stage wears
    expect(card.status_label).toBe('In production')
    // no media either: a client sees a cut when it is sent to them, not while
    // it is being made
    expect(card.preview_url).toBeNull()
    expect(card.slides).toEqual([])
  })

  it('an ordinary piece in production says nothing about a review it never had', async () => {
    item.status = 'internal_review'
    activity = [
      moved('item-1', 'draft_uploaded', 'internal_review', '2026-08-27T02:00:00.000Z'),
    ]
    const data = await load()
    expect(data.in_production[0].progress_line).toBeNull()
  })

  it('reads the LAST move, not any move — a piece round the loop twice is quiet', async () => {
    item.status = 'internal_review'
    activity = [
      // it came back off the client's desk once, months ago…
      moved('item-1', 'client_review', 'internal_review', '2026-06-01T00:00:00.000Z'),
      moved('item-1', 'internal_review', 'revision_required', '2026-06-02T00:00:00.000Z'),
      moved('item-1', 'revision_required', 'revision_complete', '2026-06-03T00:00:00.000Z'),
      // …and this time it is simply back for a check
      moved('item-1', 'draft_uploaded', 'internal_review', '2026-08-27T02:00:00.000Z'),
    ]
    expect((await load()).in_production[0].progress_line).toBeNull()
  })

  it('says nothing on a piece past the client, whatever its history', async () => {
    item.status = 'approved_for_scheduling'
    activity = [
      moved('item-1', 'client_review', 'internal_review', '2026-08-01T00:00:00.000Z'),
    ]
    const data = await load()
    expect(data.approved[0].progress_line).toBeNull()
    expect(data.in_production).toEqual([])
  })

  it('survives an item with no history at all', async () => {
    item.status = 'internal_review'
    const data = await load()
    expect(data.in_production[0].progress_line).toBeNull()
  })
})
