import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TEST_CLIENT_IDS, isTestClient, isTestPerson, mayEmailAboutClient , rowsOfEmail } from '../app/lib/test-clients-core'

// the owner, 30 Sep 2026: "don't test with real client" · "did anyone get notified"
describe('a test client never emails a real person', () => {
  const HUNDRED_M = '459e2564-1089-45ed-abd7-56d5f53c2cf6'
  it('knows the three test clients, and nothing else', () => {
    expect(TEST_CLIENT_IDS).toHaveLength(3)
    expect(isTestClient(HUNDRED_M)).toBe(true)
    expect(isTestClient('2e27f9e4-9cb5-43a6-a06b-f317f207a1e8')).toBe(false) // Justin Engelke
    expect(isTestClient(null)).toBe(false)
  })
  it('about a test client: Joy is not emailed; a Test account and the test inbox are', () => {
    expect(mayEmailAboutClient(HUNDRED_M, { email: 'joy@mdmmarketing.com.au', person: { name: 'Joy Armuela' } })).toBe(false)
    expect(mayEmailAboutClient(HUNDRED_M, { email: 'x@mdmmarketing.com.au', person: { name: 'Test Scheduler' } })).toBe(true)
    expect(mayEmailAboutClient(HUNDRED_M, { email: 'AkmalAshwin23@gmail.com ' })).toBe(true)
    expect(isTestPerson({ name: 'Testing Tom' })).toBe(false)
  })
  it('about a real client: everyone is emailed as before', () => {
    expect(mayEmailAboutClient('2e27f9e4-9cb5-43a6-a06b-f317f207a1e8', { email: 'joy@mdmmarketing.com.au', person: { name: 'Joy Armuela' } })).toBe(true)
  })
  it('the mailer asks, before it writes a log row', () => {
    const src = readFileSync('app/lib/mailer.ts', 'utf8')
    const ask = src.indexOf('mayEmailAboutClient(aboutClient')
    const claim = src.indexOf("await table('notification_log').insert(")
    expect(ask).toBeGreaterThan(0)
    expect(ask).toBeLessThan(claim)
  })
})

describe('which card an email is about, through its id suffixes (30 Sep 2026: James was told of every step of the ZZ E2E walk)', () => {
  const CARD = 'cef4722b-695a-4271-9440-9829ae84c7dd'
  const card = { table: 'content_items', id: CARD }
  it('a card move, a stand-in, a made card: the id before the first "#"', () => {
    expect(rowsOfEmail('content_item', `${CARD}#2026-09-30T12:18:38.702Z`)).toEqual([card])
    expect(rowsOfEmail('content_item', `${CARD}#standin#4e4ea4eb-71f6-4925-bca7-930a9d7223e5#1790771921238`)).toEqual([card])
    expect(rowsOfEmail('content_item', `${CARD}#made#b8c097aa-3bf9-4a95-85de-4a13452ac78e`)).toEqual([card])
    expect(rowsOfEmail('content_item', CARD)).toEqual([card])
  })
  it('a client comment carries the CARD id: its own table first, then the card', () => {
    expect(rowsOfEmail('item_comment', `${CARD}#1790772143838`)).toEqual([{ table: 'item_comments', id: CARD }, card])
  })
  it('a portal comment: its id is a dashboard path — the card it names', () => {
    expect(rowsOfEmail('portal_comment', `/dashboard/editor?card=${CARD}#1790772068841`)).toEqual([card])
    expect(rowsOfEmail('portal_comment', `/dashboard/editor/${CARD}/video/f_d48b8fd2d9be89fb70?name=07.mov#1790775029501`)).toEqual([card])
  })
  it('nothing to go on: no row', () => {
    expect(rowsOfEmail('content_item', '')).toEqual([])
    expect(rowsOfEmail('portal_comment', '/dashboard/editor')).toEqual([])
    expect(rowsOfEmail('lead', 'x')).toEqual([])
  })
  it('the mailer asks through it', () => {
    expect(readFileSync('app/lib/mailer.ts', 'utf8')).toContain('for (const at of rowsOfEmail(input.entityType, input.entityId)) {')
  })
})
