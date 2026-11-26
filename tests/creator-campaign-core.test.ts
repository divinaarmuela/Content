import { describe, expect, it } from 'vitest'
import {
  CREATOR_STAGES, campaignCreatorId, clientMayDecide, clientSees, handleOf, mayCreateFor, mayDeleteCampaign,
  mayEditCampaign, maySeeCampaign, sanitiseCampaignInput, sanitiseCreatorInput, seatCount, stageMove,
  type Campaign, type CampaignCreator, type CreatorStage, type Viewer,
} from '@/app/lib/creator-campaign-core'

/**
 * CREATOR CAMPAIGNS — THE RULES (the owner, 25 Nov 2026: "super admins can create for any client and AM can join …
 * or AM create theirs"). Who may see, make and change a campaign; how a creator moves from an idea to a confirmed
 * seat; what the client is shown and when they may still answer.
 */

const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: 'c1', client_id: 'alia', title: 'At the table', kind: 'event',
  starts_at: '2026-11-27T01:00:00.000Z', ends_at: null, place: 'South Yarra', seats: 10, closes_on: '2026-11-27',
  deliverables: ['3+ Instagram Stories on the day'], usage_terms: null,
  status: 'live', client_visible: true, member_ids: [], created_by: 'sa',
  created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z', rev: 1,
  ...over,
})
const creator = (id: string, stage: CreatorStage, over: Partial<CampaignCreator> = {}): CampaignCreator => ({
  id: `c1__${id}`, campaign_id: 'c1', client_id: 'alia', creator_id: id, name: id, photo_url: null,
  instagram: id, instagram_followers: 1000, tiktok: null, tiktok_followers: null,
  why: null, terms: 'gifted', rate: null, samples: [], stage, client_note: null, decided_at: null, decided_by: null, rev: 1,
  ...over,
})

const SA: Viewer = { id: 'sa', role: 'super_admin', clientIds: null }
const AM_ON: Viewer = { id: 'manal', role: 'account_manager', clientIds: ['alia', 'mgmt'] }
const AM_OFF: Viewer = { id: 'karly', role: 'account_manager', clientIds: ['mgmt'] }
const EDITOR: Viewer = { id: 'ed', role: 'editor', clientIds: [] }

describe('who may see a campaign', () => {
  it('a super admin sees every campaign', () => {
    expect(maySeeCampaign(SA, campaign())).toBe(true)
  })
  it('an account manager sees their own clients\' campaigns and not another client\'s', () => {
    expect(maySeeCampaign(AM_ON, campaign())).toBe(true)
    expect(maySeeCampaign(AM_OFF, campaign())).toBe(false)
  })
  it('an account manager added to a campaign sees it, whoever the client is', () => {
    expect(maySeeCampaign(AM_OFF, campaign({ member_ids: ['karly'] }))).toBe(true)
  })
  it('the manager who made it loses it once the client is no longer theirs — unless they are still on it', () => {
    expect(maySeeCampaign(AM_OFF, campaign({ created_by: 'karly' }))).toBe(false)
    expect(maySeeCampaign(AM_OFF, campaign({ created_by: 'karly', member_ids: ['karly'] }))).toBe(true)
  })
  it('nobody else sees it unless they were added to it', () => {
    expect(maySeeCampaign(EDITOR, campaign())).toBe(false)
    expect(maySeeCampaign(EDITOR, campaign({ member_ids: ['ed'] }))).toBe(true)
    expect(maySeeCampaign({ id: 'portal', role: 'client', clientIds: ['alia'] }, campaign())).toBe(false)
  })
})

describe('who may make, change and delete one', () => {
  it('a super admin makes one for any client; an account manager only for their own; nobody else', () => {
    expect(mayCreateFor(SA, 'anything')).toBe(true)
    expect(mayCreateFor(AM_ON, 'alia')).toBe(true)
    expect(mayCreateFor(AM_OFF, 'alia')).toBe(false)
    expect(mayCreateFor(EDITOR, 'alia')).toBe(false)
  })
  it('whoever on the management side can see it can change it; an editor added to it only looks', () => {
    expect(mayEditCampaign(SA, campaign())).toBe(true)
    expect(mayEditCampaign(AM_ON, campaign())).toBe(true)
    expect(mayEditCampaign(AM_OFF, campaign({ member_ids: ['karly'] }))).toBe(true)
    expect(mayEditCampaign(AM_OFF, campaign())).toBe(false)
    expect(mayEditCampaign(EDITOR, campaign({ member_ids: ['ed'] }))).toBe(false)
  })
  it('a super admin deletes any; an account manager only a draft they made', () => {
    expect(mayDeleteCampaign(SA, campaign())).toBe(true)
    expect(mayDeleteCampaign(AM_ON, campaign({ created_by: 'manal', status: 'draft' }))).toBe(true)
    expect(mayDeleteCampaign(AM_ON, campaign({ created_by: 'manal', status: 'live' }))).toBe(false)
    expect(mayDeleteCampaign(AM_ON, campaign({ created_by: 'sa', status: 'draft' }))).toBe(false)
  })
})

describe('how a creator moves', () => {
  const ok = (from: CreatorStage, to: CreatorStage, actor: 'team' | 'client') => stageMove(from, to, actor).ok
  it('the team walks a creator from an idea to a confirmed seat', () => {
    expect(ok('idea', 'with_client', 'team')).toBe(true)
    expect(ok('with_client', 'approved', 'team')).toBe(true)
    expect(ok('approved', 'invited', 'team')).toBe(true)
    expect(ok('invited', 'confirmed', 'team')).toBe(true)
  })
  it('the team can take a creator back, pass for the client, and reopen a no', () => {
    expect(ok('with_client', 'idea', 'team')).toBe(true)
    expect(ok('with_client', 'passed', 'team')).toBe(true)
    expect(ok('passed', 'with_client', 'team')).toBe(true)
    expect(ok('invited', 'declined', 'team')).toBe(true)
    expect(ok('confirmed', 'declined', 'team')).toBe(true)
    expect(ok('declined', 'invited', 'team')).toBe(true)
  })
  it('the team cannot skip the client or the invitation', () => {
    expect(ok('idea', 'approved', 'team')).toBe(false)
    expect(ok('idea', 'confirmed', 'team')).toBe(false)
    expect(ok('approved', 'confirmed', 'team')).toBe(false)
  })
  it('the client answers what they were shown, may change a no to a yes, and nothing else', () => {
    expect(ok('with_client', 'approved', 'client')).toBe(true)
    expect(ok('with_client', 'passed', 'client')).toBe(true)
    expect(ok('passed', 'approved', 'client')).toBe(true)
    for (const from of CREATOR_STAGES) {
      for (const to of CREATOR_STAGES) {
        const allowed = (from === 'with_client' && (to === 'approved' || to === 'passed')) || (from === 'passed' && to === 'approved')
        expect(ok(from, to, 'client'), `${from} → ${to}`).toBe(allowed)
      }
    }
  })
  it('a move to where the creator already is says so', () => {
    expect(stageMove('approved', 'approved', 'team')).toEqual({ ok: false, reason: 'Already there' })
  })
})

describe('when the client may still answer', () => {
  it('while the campaign is live, shown to them, and the list has not closed', () => {
    expect(clientMayDecide(campaign(), '2026-11-27')).toEqual({ ok: true })
    expect(clientMayDecide(campaign({ closes_on: null }), '2027-01-01')).toEqual({ ok: true })
  })
  it('not after the closing date — and it says which date', () => {
    const r = clientMayDecide(campaign(), '2026-11-28')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/closed on .*27 Nov/)
  })
  it('not on a draft, a closed campaign, or one the team has hidden', () => {
    for (const c of [campaign({ status: 'draft' }), campaign({ status: 'closed' }), campaign({ client_visible: false })]) {
      expect(clientMayDecide(c, '2026-11-25')).toEqual({ ok: false, reason: 'This list is not open' })
    }
  })
})

describe('the seats', () => {
  it('confirmed, waiting on their yes, and open', () => {
    const list = [creator('a', 'confirmed'), creator('b', 'confirmed'), creator('c', 'invited'), creator('d', 'approved'), creator('e', 'idea')]
    expect(seatCount(campaign({ seats: 10 }), list)).toEqual({ seats: 10, confirmed: 2, waiting: 1, open: 7, over: false })
  })
  it('more confirmed than seats is said, never hidden — and open never goes below nothing', () => {
    const list = [creator('a', 'confirmed'), creator('b', 'confirmed'), creator('c', 'confirmed')]
    expect(seatCount(campaign({ seats: 2 }), list)).toEqual({ seats: 2, confirmed: 3, waiting: 0, open: 0, over: true })
  })
  it('a campaign with no seat number counts people and promises no seats', () => {
    expect(seatCount(campaign({ seats: null }), [creator('a', 'confirmed')])).toEqual({ seats: null, confirmed: 1, waiting: 0, open: null, over: false })
  })
})

describe('what the client is shown', () => {
  const list = [creator('idea', 'idea'), creator('ask', 'with_client'), creator('no', 'passed'), creator('yes', 'approved'),
    creator('inv', 'invited'), creator('in', 'confirmed'), creator('out', 'declined')]
  it('the shortlist, what they passed on, and who is coming — never an idea, never someone who declined', () => {
    const seen = clientSees(campaign(), list)!
    expect(seen.shortlist.map(c => c.creator_id)).toEqual(['ask'])
    expect(seen.passed.map(c => c.creator_id)).toEqual(['no'])
    expect(seen.confirmed.map(c => c.creator_id)).toEqual(['yes', 'inv', 'in'])
  })
  it('nothing at all while it is a draft or hidden', () => {
    expect(clientSees(campaign({ status: 'draft' }), list)).toBeNull()
    expect(clientSees(campaign({ client_visible: false }), list)).toBeNull()
  })
  it('a closed campaign is still shown, to look at', () => {
    expect(clientSees(campaign({ status: 'closed' }), list)).not.toBeNull()
  })
})

describe('what is typed in is tidied before it is kept', () => {
  it('a handle is kept as the bare name, from an @name or a profile link', () => {
    expect(handleOf(' @Nancy.OnABite ')).toBe('nancy.onabite')
    expect(handleOf('https://www.instagram.com/nancyonabite/?hl=en')).toBe('nancyonabite')
    expect(handleOf('https://www.tiktok.com/@nancyonabite')).toBe('nancyonabite')
    expect(handleOf('')).toBeNull()
    expect(handleOf('not a handle!')).toBeNull()
  })
  it('a campaign keeps only its own fields, trimmed and capped', () => {
    const out = sanitiseCampaignInput({ title: `  ${'x'.repeat(300)}  `, seats: '12', kind: 'party', status: 'live', client_visible: 'yes',
      deliverables: [' 3 Stories ', '', 7, 'x'.repeat(400)], closes_on: '27/11/2026', id: 'hack', rev: 99, client_id: 'alia', member_ids: ['a', 'a', 3] })
    expect(out.title).toHaveLength(140)
    expect(out.seats).toBe(12)
    expect(out.kind).toBeUndefined()
    expect(out.status).toBe('live')
    expect(out.client_visible).toBeUndefined()
    expect(out.deliverables).toEqual(['3 Stories', 'x'.repeat(200)])
    expect(out.closes_on).toBeUndefined()
    expect(out.member_ids).toEqual(['a'])
    expect(out.client_id).toBe('alia')
    expect('id' in out || 'rev' in out).toBe(false)
  })
  it('a seat number that is not a whole number from 1 to 500 is dropped; clearing it is allowed', () => {
    expect(sanitiseCampaignInput({ seats: 0 }).seats).toBeUndefined()
    expect(sanitiseCampaignInput({ seats: 2.5 }).seats).toBeUndefined()
    expect(sanitiseCampaignInput({ seats: null }).seats).toBeNull()
  })
  it('a creator keeps a name, handles, counts, a why, terms and up to six links — never a stage', () => {
    const out = sanitiseCreatorInput({ name: ' Nancy ', instagram: '@NancyOnABite', instagram_followers: '17900', tiktok: '', terms: 'free',
      samples: ['https://www.instagram.com/p/abc/', 'javascript:alert(1)', ...Array(8).fill('https://example.test/x')], stage: 'confirmed', why: ' food ' })
    expect(out).toMatchObject({ name: 'Nancy', instagram: 'nancyonabite', instagram_followers: 17900, tiktok: null, why: 'food' })
    expect(out.terms).toBeUndefined()
    expect(out.samples).toHaveLength(6)
    expect(out.samples!.every(s => s.startsWith('https://'))).toBe(true)
    expect('stage' in out).toBe(false)
  })
})

it('a creator on a campaign has one row, whatever is pressed twice', () => {
  expect(campaignCreatorId('c1', 'nancy')).toBe('c1__nancy')
})

import { melbourneInput, fromMelbourneInput } from '../app/lib/creator-campaign-core'

// review, 26 Nov 2026: the date box was read in the typist's own time zone and shown to the client in Melbourne's
describe('the event time is Melbourne time, whoever types it and wherever they sit', () => {
  it('what is typed is Melbourne wall time, summer and winter', () => {
    expect(fromMelbourneInput('2026-12-10T12:30')).toBe('2026-12-10T01:30:00.000Z')
    expect(fromMelbourneInput('2026-07-01T09:00')).toBe('2026-06-30T23:00:00.000Z')
    expect(fromMelbourneInput('')).toBeNull()
    expect(fromMelbourneInput('not a time')).toBeNull()
  })
  it('and it is put back in the box the same way', () => {
    expect(melbourneInput('2026-12-10T01:30:00.000Z')).toBe('2026-12-10T12:30')
    expect(melbourneInput('2026-06-30T23:00:00.000Z')).toBe('2026-07-01T09:00')
    expect(melbourneInput(null)).toBe('')
  })
})
