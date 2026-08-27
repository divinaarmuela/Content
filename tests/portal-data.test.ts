import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which pile a piece lands in on the client's portal — against a miniature
 * Postgres, because the bucketing is the whole payload and a pure helper that
 * "would have" bucketed it is not the thing that ships.
 *
 * The case that brought this file into existence: an editor saves a new cut
 * while the piece is sitting with the client. The piece leaves client_review,
 * so the review card must be GONE — a client cannot be asked to approve a
 * version that no longer exists — and it must reappear under "In production"
 * saying, in words, that it is coming back.
 */

type Row = Record<string, unknown>
type Filter = ['eq', string, unknown] | ['in', string, unknown[]]

const tables: Record<string, Row[]> = {}

const matches = (row: Row, filters: Filter[]) => filters.every(f =>
  f[0] === 'eq' ? row[f[1]] === f[2] : f[2].includes(row[f[1]]))

const supabase = {
  from(table: string) {
    const filters: Filter[] = []
    let single = false
    let limit: number | null = null
    let sort: { col: string; asc: boolean } | null = null

    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return chain },
      in: (c: string, v: unknown[]) => { filters.push(['in', c, v]); return chain },
      // the portal's batch query; no shoots in these fixtures, so the OR has
      // nothing to choose between
      or: () => chain,
      order: (col: string, opts?: { ascending?: boolean }) => {
        sort = { col, asc: opts?.ascending !== false }
        return chain
      },
      limit: (n: number) => { limit = n; return chain },
      maybeSingle: () => { single = true; return chain },
      then: (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => {
        let out = (tables[table] ?? []).filter(r => matches(r, filters)).map(r => ({ ...r }))
        if (sort) {
          const { col, asc } = sort
          out.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1))
        }
        if (limit !== null) out = out.slice(0, limit)
        return Promise.resolve({ data: single ? out[0] ?? null : out, error: null }).then(ok, no)
      },
    }
    return chain
  },
}

vi.mock('@/lib/supabase', () => ({ supabase }))
vi.mock('../app/lib/post-analytics', () => ({
  analyticsForItems: async () => new Map(),
  refreshStaleAnalyticsInBackground: vi.fn(),
}))

const { getPortalData } = await import('../app/lib/portal-data')
const { UPDATING_AFTER_REVIEW_LINE } = await import('../app/lib/portal-words')

const CLIENT = 'client-1'
const u = (n: string) => `https://media.mdmmarketing.com.au/${n}`

/** one status_change in the trail, newest last — created_at sorts as text */
const moved = (id: string, from: string, to: string, at: string) => ({
  entity_type: 'content_item', entity_id: id, action: 'status_change',
  old_value: from, new_value: to, created_at: at,
})

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  tables.clients = [{ id: CLIENT, name: 'Nathan Homes', timezone: 'Australia/Melbourne' }]
  tables.team_user_clients = []
  tables.monthly_commitments = []
  tables.client_brand = []
  tables.batches = []
  tables.schedule_entries = []
  tables.workflow_activity = []
  tables.content_items = [{
    id: 'item-1', client_id: CLIENT, title: 'Reel 01 — Hook',
    content_type: 'reel', status: 'client_review',
    updated_at: '2026-08-27T02:00:00.000Z', batch_id: null, work_kinds: null,
  }]
  tables.asset_versions = [{
    item_id: 'item-1', version_number: 1, file_url: u('v1.mp4'), files: [], drive_url: '',
  }]
})

const load = async () => (await getPortalData(CLIENT))!

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
    tables.content_items[0].status = 'internal_review'
    tables.workflow_activity = [
      moved('item-1', 'internal_review', 'client_review', '2026-08-26T01:00:00.000Z'),
      moved('item-1', 'client_review', 'internal_review', '2026-08-27T02:00:00.000Z'),
    ]

    const data = await load()
    // the review card is GONE — nobody may be asked to approve a version that
    // has already been replaced
    expect(data.needs_review).toEqual([])
    expect(data.in_production.map(i => i.id)).toEqual(['item-1'])
    const item = data.in_production[0]
    expect(item.progress_line).toBe(UPDATING_AFTER_REVIEW_LINE)
    // …and the status word is the same calm one every internal stage wears
    expect(item.status_label).toBe('In production')
    // no media either: a client sees a cut when it is sent to them, not while
    // it is being made
    expect(item.preview_url).toBeNull()
    expect(item.slides).toEqual([])
  })

  it('an ordinary piece in production says nothing about a review it never had', async () => {
    tables.content_items[0].status = 'internal_review'
    tables.workflow_activity = [
      moved('item-1', 'draft_uploaded', 'internal_review', '2026-08-27T02:00:00.000Z'),
    ]
    const data = await load()
    expect(data.in_production[0].progress_line).toBeNull()
  })

  it('reads the LAST move, not any move — a piece round the loop twice is quiet', async () => {
    tables.content_items[0].status = 'internal_review'
    tables.workflow_activity = [
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
    tables.content_items[0].status = 'approved_for_scheduling'
    tables.workflow_activity = [
      moved('item-1', 'client_review', 'internal_review', '2026-08-01T00:00:00.000Z'),
    ]
    const data = await load()
    expect(data.approved[0].progress_line).toBeNull()
    expect(data.in_production).toEqual([])
  })

  it('survives an item with no history at all', async () => {
    tables.content_items[0].status = 'internal_review'
    const data = await load()
    expect(data.in_production[0].progress_line).toBeNull()
  })
})
