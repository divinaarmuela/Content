import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE CLIENT'S BOARD, against a miniature database.
 *
 * One shoot is one card, from booked to wrapped — the case the owner could
 * not follow on the old portal, where a booking, a plan and a wrap were three
 * things. And the two rules the board must never get wrong: only a SHARED
 * plan whose brief is at client_review can be approved from the card, and a
 * piece carries its link only once it has reached the client.
 */

vi.mock('../app/lib/post-analytics', () => ({
  analyticsForItems: async () => new Map(),
  refreshStaleAnalyticsInBackground: vi.fn(),
}))

const { getPortalData } = await import('../app/lib/portal-data')

const CLIENT = 'client-1'
let fake: ReturnType<typeof seedDb>
afterEach(() => fake?.restore())

type Seed = {
  shootStatus: 'brief' | 'locked' | 'shot' | 'wrapped'
  shared: boolean
  briefStatus: string
  items?: Record<string, unknown>[]
}

/** one client, one shoot with one brief, and whatever pieces the test adds */
const load = async (s: Seed) => {
  fake = seedDb({
    clients: [{
      id: CLIENT, name: 'Nathan Homes', timezone: 'Australia/Melbourne',
      brand_profile: { version: 1, rev: 1, colours: [], fonts: [], logo_rules: [], logo_files: [{ name: 'logo', url: 'https://cdn.test/logo.png' }], voice: { summary: '', tone: '', dos: [], donts: [] }, hashtags: [], handles: [], notes: '', reviewed_scan_at: null },
    }] as unknown as Row[],
    team_user_clients: [],
    team_users: [{ id: 'am-1', name: 'Priya Patel', role: 'account_manager', active_status: true }] as unknown as Row[],
    monthly_commitments: [],
    client_brand: [],
    work_kinds: [{ id: 'k-brief', slug: 'shoot_brief', name: 'Shoot brief', uses_media: false }] as unknown as Row[],
    batches: [{
      id: 'b-1', client_id: CLIENT, title: 'Spring shoot', status: s.shootStatus,
      shared_with_client: s.shared, shoot_date: '2026-09-17', location: 'Brighton',
      concept: 'Golden hour on the pier', planned_deliverables: [{ type: 'reel', qty: 2 }],
      shot_list: [{ id: 's1', text: 'Wide of the pier', done: false }], canvas_cards: [],
      created_at: '2026-09-01T00:00:00.000Z',
    }] as unknown as Row[],
    content_items: [
      {
        id: 'brief-1', client_id: CLIENT, batch_id: 'b-1', work_kind_id: 'k-brief',
        title: 'Spring shoot — plan', content_type: 'other', status: s.briefStatus,
        updated_at: '2026-09-02T00:00:00.000Z',
      },
      ...(s.items ?? []),
    ] as unknown as Row[],
    asset_versions: [],
    schedule_entries: [],
    workflow_activity: [],
    batch_comments: [{
      id: 'bc-1', batch_id: 'b-1', author_id: 'am-1', body: 'Plan is up — have a look', created_at: '2026-09-03T00:00:00.000Z',
    }] as unknown as Row[],
    item_comments: [],
  })
  return (await getPortalData(CLIENT))!
}

const shootCards = (d: Awaited<ReturnType<typeof load>>) => d.cards.filter(c => c.kind === 'shoot')

describe('one shoot is one card, all the way through', () => {
  it('is exactly one card at every stage, and the stage lives on the card', async () => {
    // being planned, plan not shared yet
    let d = await load({ shootStatus: 'brief', shared: false, briefStatus: 'internal_review' })
    expect(shootCards(d)).toHaveLength(0) // nothing to show until shared or booked

    // the plan is shared and with them
    d = await load({ shootStatus: 'brief', shared: true, briefStatus: 'client_review' })
    expect(shootCards(d)).toHaveLength(1)
    expect(shootCards(d)[0]).toMatchObject({
      id: 'b-1', title: 'Spring shoot', word: 'Shoot', column: 'your_review', tone: 'amber',
      line: 'Your plan is ready to look at — approve it, or ask for a change.',
      pdf: true, act_item_id: 'brief-1',
      actions: { approve: true, askForChange: true, comment: true },
      comment_target: { kind: 'shoot', id: 'b-1' },
    })
    expect(shootCards(d)[0].shoot).toMatchObject({ date_label: 'Thu 17 Sep', location: 'Brighton', shared: true, brief_item_id: 'brief-1' })
    // an old "2 reels" plan reads as two lines — the portal never says "2 reels"
    expect(shootCards(d)[0].shoot?.planned_deliverables).toEqual([
      { id: 'reel-1', title: 'Reel 1' }, { id: 'reel-2', title: 'Reel 2' },
    ])

    // approved and booked: same card, the date is the line
    d = await load({ shootStatus: 'locked', shared: true, briefStatus: 'approved_for_scheduling' })
    expect(shootCards(d)).toHaveLength(1)
    expect(shootCards(d)[0]).toMatchObject({ id: 'b-1', column: 'approved', line: 'Booked for Thu 17 Sep.', act_item_id: null, actions: { approve: false, comment: true } })

    // wrapped: still the one card, now in Done, saying so
    d = await load({ shootStatus: 'wrapped', shared: true, briefStatus: 'approved_for_scheduling' })
    expect(shootCards(d)).toHaveLength(1)
    expect(shootCards(d)[0]).toMatchObject({ id: 'b-1', column: 'posted', tone: 'ink', line: 'Wrapped on Thu 17 Sep — the footage is being turned into your content.' })

    // and the brief itself is never a card of its own
    for (const c of d.cards) expect(c.id).not.toBe('brief-1')
  })

  it('a shared plan at client_review is approvable from the card; an unshared one is not', async () => {
    const shared = await load({ shootStatus: 'brief', shared: true, briefStatus: 'client_review' })
    expect(shootCards(shared)[0].actions.approve).toBe(true)
    expect(shootCards(shared)[0].act_item_id).toBe('brief-1')

    // booked but never shared: the client sees the date, gets no decision,
    // no PDF, no working detail and no thread
    const unshared = await load({ shootStatus: 'locked', shared: false, briefStatus: 'client_review' })
    expect(shootCards(unshared)).toHaveLength(1)
    expect(shootCards(unshared)[0]).toMatchObject({
      line: 'Booked for Thu 17 Sep.', pdf: false, act_item_id: null,
      actions: { approve: false, askForChange: false, comment: false }, comment_target: null,
    })
    expect(shootCards(unshared)[0].shoot).toMatchObject({ concept: null, planned_deliverables: [], shot_list: [], brief_item_id: null })
  })

  it('carries the shoot’s comments on the card, with who and when', async () => {
    const d = await load({ shootStatus: 'brief', shared: true, briefStatus: 'client_review' })
    expect(shootCards(d)[0].comments).toEqual([{
      id: 'bc-1', created_at: '2026-09-03T00:00:00.000Z', body: 'Plan is up — have a look',
      author_name: 'Priya Patel', from_team: true,
    }])
  })
})

describe('a piece on the board', () => {
  const piece = (status: string, extra: Record<string, unknown> = {}) => ({
    id: 'item-1', client_id: CLIENT, title: 'Reel 01 — Hook', content_type: 'static', status,
    updated_at: '2026-09-04T00:00:00.000Z', batch_id: null, work_kind_id: null,
    drive_url: 'https://drive.google.com/file/d/abc/view', ...extra,
  })

  it('with the client: amber, its link labelled, one tap to approve, a place to comment', async () => {
    const d = await load({ shootStatus: 'brief', shared: false, briefStatus: 'internal_review', items: [piece('client_review')] })
    const card = d.cards.find(c => c.kind === 'work')!
    expect(card).toMatchObject({
      column: 'your_review', tone: 'amber', word: 'Image',
      link: { url: 'https://drive.google.com/file/d/abc/view', label: 'Open in Google Drive', provider: 'drive' },
      actions: { approve: true, askForChange: true, comment: true },
      act_item_id: 'item-1', comment_target: { kind: 'item', id: 'item-1' },
    })
    expect(card.line).toMatch(/approve or ask for a change/)
  })

  it('shows the link the team pasted (link_url + link_kind), over the old Drive mirror field', async () => {
    const d = await load({
      shootStatus: 'brief', shared: false, briefStatus: 'internal_review',
      items: [piece('client_review', {
        link_url: 'https://www.dropbox.com/scl/fi/abc/reel.mp4?dl=0', link_kind: 'dropbox',
        drive_url: 'https://drive.google.com/file/d/old/view',
      })],
    })
    const card = d.cards.find(c => c.kind === 'work')!
    expect(card.link).toEqual({
      url: 'https://www.dropbox.com/scl/fi/abc/reel.mp4?dl=0', label: 'Open in Dropbox', provider: 'dropbox',
    })
  })

  it('a card from before pasted links still shows its old Drive link', async () => {
    const d = await load({
      shootStatus: 'brief', shared: false, briefStatus: 'internal_review',
      items: [piece('client_review', { link_url: null, link_kind: null })],
    })
    expect(d.cards.find(c => c.kind === 'work')!.link).toEqual({
      url: 'https://drive.google.com/file/d/abc/view', label: 'Open in Google Drive', provider: 'drive',
    })
  })

  it('still being made: no link, no actions, no thread — and it is still on the board', async () => {
    const d = await load({ shootStatus: 'brief', shared: false, briefStatus: 'internal_review', items: [piece('internal_review')] })
    const card = d.cards.find(c => c.kind === 'work')!
    expect(card).toMatchObject({
      column: 'checking', link: null, comment_target: null,
      actions: { approve: false, askForChange: false, comment: false },
    })
    expect(card.line).toBe('Getting a last check before it comes to you.')
  })

  it('the card waiting on the client comes first', async () => {
    const d = await load({
      shootStatus: 'brief', shared: false, briefStatus: 'internal_review',
      items: [
        piece('published', { id: 'item-new', updated_at: '2026-09-06T00:00:00.000Z' }),
        piece('client_review', { id: 'item-old', updated_at: '2026-08-01T00:00:00.000Z' }),
      ],
    })
    expect(d.cards.map(c => c.id)).toEqual(['item-old', 'item-new'])
  })

  it('dresses the page in the client’s logo', async () => {
    const d = await load({ shootStatus: 'brief', shared: false, briefStatus: 'internal_review' })
    expect(d.brand_logo_url).toBe('https://cdn.test/logo.png')
  })
})
