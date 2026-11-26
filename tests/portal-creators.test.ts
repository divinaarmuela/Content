import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { clientCampaign, chosenWords, seatLine } from '../app/lib/creator-portal-core'
import type { Campaign, CampaignCreator } from '../app/lib/creator-campaign-core'

/**
 * THE CLIENT'S SIDE OF A CREATOR CAMPAIGN (the owner, 25 Nov 2026). Pinned: what a client is handed (never an idea,
 * a creator who declined, or the rate); their answer through the portal link lands on their own campaign only, and
 * only while the list is open; the team is told, and nothing but the creator's standing goes back to the browser.
 */

const told: { clientId: string; body: string; alsoUserIds?: (string | null | undefined)[]; dashboardPath: string }[] = []
vi.mock('../app/lib/portal-actor', () => ({
  portalActor: async (clientId: string) => ({ id: `portal-${clientId}` }),
  notifyManagersOfComment: async (o: (typeof told)[number]) => { told.push(o) },
}))

import { POST } from '../app/api/portal/creators/route'

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: 'k1', client_id: 'c1', title: 'Teta’s table lunch', kind: 'event', starts_at: null, ends_at: null, place: 'South Yarra', seats: 2,
  closes_on: null, deliverables: ['3 Stories on the day'], usage_terms: null, cover_url: 'https://cdn.x/cover.jpg', status: 'live', client_visible: true, member_ids: ['ed'], created_by: 'ama',
  created_at: '2026-11-25T00:00:00.000Z', updated_at: '2026-11-25T00:00:00.000Z', rev: 1, ...over,
})
const creator = (id: string, stage: CampaignCreator['stage'], over: Partial<CampaignCreator> = {}): CampaignCreator => ({
  id: `k1__${id}`, campaign_id: 'k1', client_id: 'c1', creator_id: id, name: id, photo_url: null, instagram: id, instagram_followers: 1000, tiktok: null, tiktok_followers: null,
  why: 'Fits', terms: 'paid', rate: '$300', samples: [], sample_images: ['https://cdn.x/post1.jpg'], stage, client_note: null, decided_at: null, decided_by: null, rev: 1, ...over,
})
const everyone = () => [creator('idea1', 'idea'), creator('lydia', 'with_client'), creator('yes1', 'approved'), creator('inv1', 'invited'), creator('conf1', 'confirmed'), creator('no1', 'passed'), creator('gone', 'declined')]

describe('what a client is handed', () => {
  it('nothing for a draft or a hidden campaign', () => {
    expect(clientCampaign(campaign({ status: 'draft' }), everyone(), '2026-11-26')).toBeNull()
    expect(clientCampaign(campaign({ client_visible: false }), everyone(), '2026-11-26')).toBeNull()
  })
  it('the creators shown to them, sorted into three lists — never an idea or a creator who declined, never the rate', () => {
    const v = clientCampaign(campaign(), everyone(), '2026-11-26')!
    expect(v.shortlist.map(c => c.name)).toEqual(['lydia'])
    expect(v.chosen.map(c => c.name)).toEqual(['yes1', 'inv1', 'conf1'])
    expect(v.passed.map(c => c.name)).toEqual(['no1'])
    expect(JSON.stringify(v)).not.toContain('$300')
    expect(JSON.stringify(v)).not.toMatch(/idea1|gone|decided_by|member_ids|created_by/)
  })
  it('the seats and the next step, in plain words', () => {
    const v = clientCampaign(campaign(), everyone(), '2026-11-26')!
    expect(seatLine(v)).toBe('1 of 2 seats confirmed · 1 waiting on their yes')
    expect(v.next_step).toBe('1 creator to look at.')
    expect(v.open_for_answers).toBe(true)
    expect(seatLine({ seats: null, confirmed: 3, waiting: 0, open: null, over: false })).toBe('3 confirmed')
    expect(seatLine({ seats: 10, confirmed: 8, waiting: 1, open: 1, over: false })).toBe('8 of 10 seats confirmed · 1 waiting on their yes · 1 open')
  })
  // Review Focus 4: more confirmed than seats is said, never shown as "3 of 2" with nothing beside it
  it('more creators confirmed than there are seats is said outright', () => {
    const over = clientCampaign(campaign({ seats: 2 }), [creator('a', 'confirmed'), creator('b', 'confirmed'), creator('c', 'confirmed')], '2026-11-26')!
    expect(over.over).toBe(true)
    expect(seatLine(over)).toBe('3 confirmed for 2 seats')
    expect(clientCampaign(campaign(), everyone(), '2026-11-26')!.over).toBe(false)
  })
  it('after the closing day, or once the team closes it, they may look but not answer', () => {
    const late = clientCampaign(campaign({ closes_on: '2026-11-20' }), everyone(), '2026-11-26')!
    expect(late.open_for_answers).toBe(false)
    expect(late.closed_reason).toBe('This list closed on Fri 20 Nov.')
    expect(clientCampaign(campaign({ closes_on: '2026-11-26' }), everyone(), '2026-11-26')!.open_for_answers).toBe(true)
    const closed = clientCampaign(campaign({ status: 'closed' }), everyone(), '2026-11-26')!
    expect(closed).toMatchObject({ open_for_answers: false, closed_reason: 'This list is closed.' })
  })
  it('the pictures come with it: the campaign\u2019s cover, and each creator\u2019s posts', () => {
    const v = clientCampaign(campaign(), everyone(), '2026-11-26')!
    expect(v.cover_url).toBe('https://cdn.x/cover.jpg')
    expect(v.shortlist[0].sample_images).toEqual(['https://cdn.x/post1.jpg'])
  })
  it('where the campaign is up to: choosing, the list closing, the day — each done, now or still to come', () => {
    const c = campaign({ closes_on: '2026-12-05', starts_at: '2026-12-10T01:30:00.000Z' })
    const at = (today: string) => clientCampaign(c, everyone(), today)!.steps.map(s => `${s.label}|${s.when}|${s.state}`)
    expect(at('2026-11-26')).toEqual(['Choosing creators|Until Sat 5 Dec|now', 'The list closes|Sat 5 Dec|next', 'The day|Thu 10 Dec|next'])
    expect(at('2026-12-07')).toEqual(['Choosing creators|Until Sat 5 Dec|done', 'The list closes|Sat 5 Dec|done', 'The day|Thu 10 Dec|next'])
    expect(at('2026-12-10')).toEqual(['Choosing creators|Until Sat 5 Dec|done', 'The list closes|Sat 5 Dec|done', 'The day|Thu 10 Dec|now'])
    expect(at('2026-12-11').map(s => s.split('|')[2])).toEqual(['done', 'done', 'done'])
    // no dates set: one step, and it is where things are
    expect(clientCampaign(campaign(), everyone(), '2026-11-26')!.steps.map(s => `${s.label}|${s.when}|${s.state}`)).toEqual(['Choosing creators|null|now'])
    expect(clientCampaign(campaign({ kind: 'content', starts_at: '2026-12-10T01:30:00.000Z' }), everyone(), '2026-11-26')!.steps[1].label).toBe('Content goes out')
  })
  it('where a creator they said yes to has got to', () => {
    expect(chosenWords({ stage: 'approved', name: 'Lydia H' })).toBe('You said yes. We are inviting them')
    expect(chosenWords({ stage: 'invited', name: 'Lydia H' })).toBe('Invited. Waiting on Lydia')
    expect(chosenWords({ stage: 'confirmed', name: 'Lydia H' })).toBe('Place confirmed')
  })
})

describe('the client answers through their portal link', () => {
  let fake: ReturnType<typeof seedDb>
  const stored = () => fake.rows('campaign_creators') as unknown as CampaignCreator[]
  const seed = (c: Partial<Campaign> = {}) => seedDb({
    clients: [{ id: 'c1', name: 'Alia Fragrance', share_token: T1 }, { id: 'c2', name: 'MGMT', share_token: T2 }] as unknown as Row[],
    client_contacts: [] as Row[],
    creator_campaigns: [campaign(c)] as unknown as Row[],
    campaign_creators: [creator('lydia', 'with_client'), creator('idea1', 'idea')] as unknown as Row[],
    campaign_creator_events: [] as Row[],
  })
  const send = async (body: Record<string, unknown>) => {
    const res = await POST(new Request('http://x/api/portal/creators', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }))
    return { status: res.status, body: await res.json() }
  }
  const yes = { token: T1, campaign_id: 'k1', row_id: 'k1__lydia', to: 'approved', expect_rev: 1 }

  beforeEach(() => { told.length = 0; fake = seed() })
  afterEach(() => fake.restore())

  // review, 26 Nov 2026: the person who MADE a campaign is not told by that alone — a manager taken off the client
  // would keep hearing every answer. The client's managers are told by the helper; members by name; nobody else.
  it('a yes lands on the creator, leaves a line of history, and the campaign’s team is told', async () => {
    const res = await send({ ...yes, note: 'Love her food content' })
    expect(res.status).toBe(200)
    expect(res.body.creator).toEqual({ id: 'k1__lydia', name: 'lydia', stage: 'approved', client_note: 'Love her food content', rev: 2 })
    expect(stored().find(r => r.id === 'k1__lydia')).toMatchObject({ stage: 'approved', decided_by: 'portal-c1' })
    expect(fake.rows('campaign_creator_events')).toHaveLength(1)
    expect(told).toHaveLength(1)
    expect(told[0]).toMatchObject({ clientId: 'c1', dashboardPath: '/dashboard/creators/k1', alsoUserIds: ['ed'] })
    expect(told[0].body).toBe('Alia Fragrance said yes to lydia. “Love her food content”')
  })
  it('a no, then a change of mind', async () => {
    expect((await send({ ...yes, to: 'passed' })).body.creator.stage).toBe('passed')
    expect((await send({ ...yes, expect_rev: 2 })).body.creator.stage).toBe('approved')
  })
  it('a link that is nobody’s is refused', async () => {
    expect((await send({ ...yes, token: '33333333-3333-4333-8333-333333333333' })).status).toBe(401)
    expect((await send({ ...yes, token: 'not a token' })).status).toBe(401)
  })
  // Review Focus 5
  it('another client’s link gets 404 on this campaign, with nothing about it in the answer, and nobody is told', async () => {
    const res = await send({ ...yes, token: T2 })
    expect(res).toEqual({ status: 404, body: { error: 'That campaign is not here' } })
    expect(stored().find(r => r.id === 'k1__lydia')?.stage).toBe('with_client')
    expect(told).toEqual([])
  })
  it('an idea the team has not shown them cannot be answered, and the refusal carries no rate', async () => {
    const res = await send({ ...yes, row_id: 'k1__idea1' })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).not.toContain('$300')
    expect(Object.keys(res.body.fresh).sort()).toEqual(['client_note', 'id', 'name', 'rev', 'stage'])
  })
  // Review Focus 3
  it('no answer is taken on a hidden campaign, a closed one, or after the closing day — and the page is told why', async () => {
    for (const [over, reason] of [[{ client_visible: false }, 'This list is not open'], [{ status: 'closed' as const }, 'This list is not open'], [{ closes_on: '2020-01-01' }, 'This list closed on Wed 1 Jan']] as const) {
      fake.restore(); fake = seed(over)
      const res = await send(yes)
      expect(res, JSON.stringify(over)).toEqual({ status: 403, body: { error: reason } })
      expect(stored().find(r => r.id === 'k1__lydia')?.stage).toBe('with_client')
    }
    expect(told).toEqual([])
  })
  // Review Focus 2
  it('an answer on a creator the team changed in between is refused with how they now stand', async () => {
    const res = await send({ ...yes, expect_rev: 7 })
    expect(res.status).toBe(409)
    expect(res.body.fresh).toMatchObject({ stage: 'with_client', rev: 1 })
  })
})
