import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The write path, against a miniature Postgres and a fake provider.
 *
 * What has to be true for a client to get numbers on a post their agency
 * published by hand:
 *
 *   - the provider is asked for its list ONCE, matched, and asked for that one
 *     post's figures;
 *   - the row lands in `post_analytics` keyed on the provider's post id, with
 *     `item_id` set and `source: 'external'`, so the existing refresh cron and
 *     the portal pick it up with no changes at all;
 *   - an item we published ourselves is left alone — it already has a job;
 *   - a link that matches nothing is RECORDED as matching nothing, because the
 *     card is only entitled to accuse a link once we have actually looked.
 */

type Row = Record<string, unknown>
type Filter =
  | ['eq' | 'is' | 'gte' | 'not_is', string, unknown]
  | ['in', string, unknown[]]

type Op = {
  table: string
  verb: 'select' | 'update' | 'insert' | 'upsert'
  patch: Row
  rows: Row[]
  filters: Filter[]
  conflict: string[]
  limit: number | null
  columns: string
}

const tables: Record<string, Row[]> = {}
let nextId = 1
/** columns the fake database does NOT have, so an un-migrated table can be
 *  played back exactly as Postgres plays it back: the whole query fails */
let missingColumns: string[] = []

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(f => {
    if (f[0] === 'eq') return row[f[1]] === f[2]
    if (f[0] === 'is') return row[f[1]] === f[2] || (f[2] === null && row[f[1]] == null)
    if (f[0] === 'not_is') return !(row[f[1]] === f[2] || (f[2] === null && row[f[1]] == null))
    if (f[0] === 'gte') return String(row[f[1]] ?? '') >= String(f[2])
    return (f[2] as unknown[]).includes(row[f[1]])
  })
}

function unknownColumn(op: Op): string | null {
  const touched = [
    ...op.columns.split(',').map(s => s.trim()),
    ...Object.keys(op.patch),
    ...op.rows.flatMap(r => Object.keys(r)),
    ...op.filters.map(f => f[1]),
  ]
  return missingColumns.find(c => touched.includes(c)) ?? null
}

function run(op: Op): { data: Row[] | null; error: { message: string } | null } {
  const missing = unknownColumn(op)
  if (missing) {
    return { data: null, error: { message: `column "${missing}" does not exist` } }
  }
  const rows = (tables[op.table] ??= [])

  if (op.verb === 'insert' || op.verb === 'upsert') {
    const written: Row[] = []
    for (const incoming of op.rows) {
      const clash = op.conflict.length > 0
        ? rows.find(r => op.conflict.every(c => r[c] === incoming[c]))
        : undefined
      if (clash) {
        Object.assign(clash, incoming)
        written.push(clash)
        continue
      }
      const row = { id: `row-${nextId++}`, ...incoming }
      rows.push(row)
      written.push(row)
    }
    return { data: written.map(r => ({ ...r })), error: null }
  }

  const hit = rows.filter(r => matches(r, op.filters))
  if (op.verb === 'update') for (const r of hit) Object.assign(r, op.patch)
  let out = hit.map(r => ({ ...r }))
  if (op.limit !== null) out = out.slice(0, op.limit)
  return { data: out, error: null }
}

const supabase = {
  from(table: string) {
    const op: Op = {
      table, verb: 'select', patch: {}, rows: [], filters: [],
      conflict: [], limit: null, columns: '',
    }
    let single = false

    const chain = {
      select: (cols?: string) => { op.columns = cols ?? ''; return chain },
      insert: (rows: Row | Row[]) => {
        op.verb = 'insert'; op.rows = Array.isArray(rows) ? rows : [rows]; return chain
      },
      upsert: (rows: Row | Row[], opts?: { onConflict?: string }) => {
        op.verb = 'upsert'
        op.rows = Array.isArray(rows) ? rows : [rows]
        op.conflict = (opts?.onConflict ?? '').split(',').map(s => s.trim()).filter(Boolean)
        return chain
      },
      update: (patch: Row) => { op.verb = 'update'; op.patch = patch; return chain },
      eq: (c: string, v: unknown) => { op.filters.push(['eq', c, v]); return chain },
      is: (c: string, v: unknown) => { op.filters.push(['is', c, v]); return chain },
      not: (c: string, _op: string, v: unknown) => { op.filters.push(['not_is', c, v]); return chain },
      gte: (c: string, v: unknown) => { op.filters.push(['gte', c, v]); return chain },
      in: (c: string, v: unknown[]) => { op.filters.push(['in', c, v]); return chain },
      order: () => chain,
      limit: (n: number) => { op.limit = n; return chain },
      maybeSingle: () => { single = true; return chain },
      then: (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => {
        const r = run(op)
        const data = single ? (r.data?.[0] ?? null) : r.data
        return Promise.resolve({ ...r, data }).then(ok, no)
      },
    }
    return chain
  },
}

/* ── the provider ──────────────────────────────────────────────────────── */

const LIST_URL = 'https://www.instagram.com/reel/ABC123/'
const PUBLISHED_AT = '2026-08-26T09:00:00.000Z'

let externalPosts: Row[] = []
let perPost: Record<string, unknown> | null = null
const postAnalytics = vi.fn(async (postId?: string) => {
  if (!postId) return { posts: externalPosts }
  return perPost
})
const configured = vi.fn(() => true)

vi.mock('@/lib/supabase', () => ({ supabase }))
vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({ name: 'fake', configured, postAnalytics }),
}))

const {
  linkExternalPost, linkExternalPostFromWebhook, sweepExternalPosts,
} = await import('../app/lib/external-post-match')

const analytics = () => tables.post_analytics ?? []
const entry = () => (tables.schedule_entries ?? [])[0]

beforeEach(() => {
  nextId = 1
  missingColumns = []
  postAnalytics.mockClear()
  configured.mockReturnValue(true)
  for (const key of Object.keys(tables)) delete tables[key]

  tables.clients = [{ id: 'client-1', social_profile_id: 'profile_1' }]
  tables.content_items = [{ id: 'item-1', client_id: 'client-1', status: 'published' }]
  tables.schedule_entries = [{
    id: 'entry-1',
    item_id: 'item-1',
    platform: 'instagram',
    live_url: 'https://instagram.com/p/ABC123/?utm_source=ig_web_copy_link',
    publish_status: 'published',
    published_at: PUBLISHED_AT,
    scheduled_at: PUBLISHED_AT,
    external_match_state: null,
  }]
  tables.publish_jobs = []
  tables.post_analytics = []

  externalPosts = [{
    _id: 'ext_post_1',
    isExternal: true,
    platform: 'instagram',
    profileId: 'profile_1',
    publishedAt: PUBLISHED_AT,
    platformPostUrl: LIST_URL,
  }]
  perPost = {
    _id: 'ext_post_1',
    publishedAt: PUBLISHED_AT,
    syncStatus: 'synced',
    platformAnalytics: [{
      platform: 'instagram',
      syncStatus: 'synced',
      platformPostUrl: LIST_URL,
      analytics: { views: 1204, likes: 84, comments: 3, reach: 900 },
    }],
  }
})

const link = () => linkExternalPost({
  itemId: 'item-1',
  clientId: 'client-1',
  platform: 'instagram',
  liveUrl: tables.schedule_entries[0].live_url as string,
  at: PUBLISHED_AT,
})

describe('linkExternalPost', () => {
  it('caches the matched post as an ordinary analytics row', async () => {
    expect(await link()).toBe('matched')

    expect(analytics()).toHaveLength(1)
    const row = analytics()[0]
    expect(row.provider_post_id).toBe('ext_post_1')
    expect(row.item_id).toBe('item-1')
    expect(row.source).toBe('external')
    expect(row.platform).toBe('instagram')
    expect(row.platform_post_url).toBe(LIST_URL)
    expect(row.views).toBe(1204)
    expect(row.likes).toBe(84)
    expect(row.published_at).toBe(PUBLISHED_AT)
    expect(entry().external_match_state).toBe('matched')
  })

  it('asks the list once, then that one post for its figures', async () => {
    await link()
    expect(postAnalytics.mock.calls.map(c => c[0])).toEqual([undefined, 'ext_post_1'])
  })

  it('is idempotent — a second run updates the same row', async () => {
    await link()
    perPost = {
      ...(perPost as Row),
      platformAnalytics: [{
        platform: 'instagram', syncStatus: 'synced', platformPostUrl: LIST_URL,
        analytics: { views: 2000, likes: 90 },
      }],
    }
    expect(await link()).toBe('matched')
    expect(analytics()).toHaveLength(1)
    expect(analytics()[0].views).toBe(2000)
  })

  it('records that it looked and found nothing', async () => {
    externalPosts = [{
      _id: 'ext_other', isExternal: true, platform: 'instagram', profileId: 'profile_1',
      publishedAt: '2026-01-01T00:00:00.000Z',
      platformPostUrl: 'https://instagram.com/p/SOMETHINGELSE/',
    }]
    expect(await link()).toBe('not_found')
    expect(analytics()).toHaveLength(0)
    expect(entry().external_match_state).toBe('not_found')
  })

  it('leaves a post WE published alone', async () => {
    tables.publish_jobs = [{
      id: 'job-1', content_item_id: 'item-1', status: 'published',
      provider_post_id: 'post_1', targets: [{ platform: 'instagram' }],
    }]
    expect(await link()).toBe('skipped')
    expect(postAnalytics).not.toHaveBeenCalled()
    expect(analytics()).toHaveLength(0)
  })

  it('does nothing at all when no provider is configured', async () => {
    configured.mockReturnValue(false)
    expect(await link()).toBe('skipped')
    expect(postAnalytics).not.toHaveBeenCalled()
  })

  it('finds a Story marked posted with no link, by its time', async () => {
    tables.schedule_entries[0].live_url = null
    expect(await linkExternalPost({
      itemId: 'item-1', clientId: 'client-1', platform: 'instagram',
      liveUrl: null, at: '2026-08-26T11:00:00.000Z',
    })).toBe('matched')
    expect(analytics()[0].provider_post_id).toBe('ext_post_1')
  })

  it('still writes the numbers when post_analytics has no source column yet', async () => {
    // post_analytics_external.sql not run: the row is worth having anyway
    missingColumns = ['source', 'external_match_state']
    expect(await link()).toBe('matched')
    expect(analytics()).toHaveLength(1)
    expect(analytics()[0].provider_post_id).toBe('ext_post_1')
    expect(analytics()[0].source).toBeUndefined()
  })

  it('keeps the row when the provider has no figures yet', async () => {
    perPost = null
    expect(await link()).toBe('matched')
    expect(analytics()[0].provider_post_id).toBe('ext_post_1')
    expect(analytics()[0].platform_post_url).toBe(LIST_URL)
  })
})

describe('sweepExternalPosts', () => {
  it('matches a post marked by hand before any of this shipped', async () => {
    const result = await sweepExternalPosts()
    expect(result.matched).toBe(1)
    expect(analytics()[0].item_id).toBe('item-1')
    expect(entry().external_match_state).toBe('matched')
  })

  it('skips an item that already has numbers, and refreshes them instead', async () => {
    await link()
    postAnalytics.mockClear()
    const result = await sweepExternalPosts()
    expect(result.matched).toBe(0)
    expect(result.refreshed).toBe(1)
    // the refresh half asks about the post it already knows, by id
    expect(postAnalytics.mock.calls.map(c => c[0])).toContain('ext_post_1')
    expect(analytics()).toHaveLength(1)
  })

  it('ignores an item that is not published', async () => {
    tables.content_items[0].status = 'scheduled'
    const result = await sweepExternalPosts()
    expect(result.matched).toBe(0)
    expect(analytics()).toHaveLength(0)
  })
})

describe('linkExternalPostFromWebhook', () => {
  it('links a newly detected external post to the item that carries its link', async () => {
    const { matched } = await linkExternalPostFromWebhook({
      providerPostId: 'ext_post_1',
      platform: 'instagram',
      url: LIST_URL,
      publishedAt: PUBLISHED_AT,
      profileId: 'profile_1',
    })
    expect(matched).toBe('item-1')
    expect(analytics()[0].source).toBe('external')
    expect(entry().external_match_state).toBe('matched')
  })

  it('is a no-op for somebody else’s post', async () => {
    const { matched } = await linkExternalPostFromWebhook({
      providerPostId: 'ext_post_9',
      platform: 'instagram',
      url: 'https://instagram.com/p/NOTOURS/',
      publishedAt: PUBLISHED_AT,
      profileId: 'profile_1',
    })
    expect(matched).toBeNull()
    expect(analytics()).toHaveLength(0)
  })

  it('will not steal an item we published ourselves', async () => {
    tables.publish_jobs = [{
      id: 'job-1', content_item_id: 'item-1', status: 'published',
      provider_post_id: 'post_1', targets: [{ platform: 'instagram' }],
    }]
    const { matched } = await linkExternalPostFromWebhook({
      providerPostId: 'ext_post_1', platform: 'instagram', url: LIST_URL,
      publishedAt: PUBLISHED_AT, profileId: 'profile_1',
    })
    expect(matched).toBeNull()
  })
})
