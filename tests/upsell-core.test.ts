import { describe, expect, it } from 'vitest'
import {
  PRICE_LIST, UPSELLS_PAGE, commissionOf, mayChangeUpsell, mayDeleteUpsell, mayMarkPaid, maySeeUpsell, priceCheck, priceItem,
  sanitiseUpsellInput, seesAllUpsells, stagePatch, upsellTotals, type Upsell,
} from '@/app/lib/upsell-core'
import { canSeePage, defaultAllows, isGrantablePage } from '@/app/lib/page-access-core'

/**
 * THE UPSELL TRACKER (Divina, via the owner, 25 Nov 2026: "a simple dashboard tracker that shows client pitched
 * versus won. Log of clients, service, amount, stage, is paid … They get commission when the client has paid for
 * the upsell"). The price list and the commission rules are the Add-on price list of November 2026.
 */

const row = (over: Partial<Upsell> = {}): Upsell => ({
  id: 'u1', client_id: 'c1', client_name: 'Cafe', service_key: 'extra_half_day_video', service_name: 'Extra half-day video shoot',
  category: 'Content and production', billing: 'one_off', amount: 2385, stage: 'pitched', paid: false, months_paid: 0, paid_at: null,
  pitched_by: 'manal', pitched_by_name: 'Manal', logged_at: '2026-11-25T00:00:00.000Z', pitched_at: '2026-11-25T00:00:00.000Z',
  won_at: null, lost_at: null, notes: null, created_by: 'manal', created_at: '2026-11-25T00:00:00.000Z', updated_at: '2026-11-25T00:00:00.000Z', rev: 1,
  ...over,
})

describe('the price list is the November 2026 PDF', () => {
  it('holds every service once, with a range and how it is billed', () => {
    expect(new Set(PRICE_LIST.map(p => p.key)).size).toBe(PRICE_LIST.length)
    for (const p of PRICE_LIST) {
      expect(p.low, p.name).toBeGreaterThan(0)
      expect(p.high, p.name).toBeGreaterThanOrEqual(p.low)
      expect(['one_off', 'monthly']).toContain(p.billing)
    }
    expect([...new Set(PRICE_LIST.map(p => p.category))]).toEqual([
      'Content and production', 'Paid ads', 'Web and funnels', 'Strategy and consulting', 'Events', 'Retainer upgrades',
    ])
  })
  it('a few prices, read straight off the page', () => {
    expect(priceItem('extra_half_day_video')).toMatchObject({ low: 2385, high: 2860, billing: 'one_off', unit: 'per session' })
    expect(priceItem('meta_ads_management')).toMatchObject({ low: 1850, high: 2850, billing: 'monthly' })
    expect(priceItem('google_ads_setup')).toMatchObject({ low: 1485, high: 1980, billing: 'one_off' })
    expect(priceItem('google_ads_ongoing')).toMatchObject({ low: 1850, high: 2465, billing: 'monthly' })
    expect(priceItem('custom_website')).toMatchObject({ low: 14850, high: 22275 })
    expect(priceItem('service_pipeline_build')).toMatchObject({ low: 38400, high: 51150, billing: 'one_off' })
    expect(priceItem('tier_premium')).toMatchObject({ low: 13850, high: 18450, billing: 'monthly' })
    expect(priceItem('nope')).toBeNull()
  })
  it('a price under the range needs sign-off; one inside or above it does not', () => {
    const item = priceItem('extra_half_day_video')!
    expect(priceCheck(item, 2000)).toBe('below')
    expect(priceCheck(item, 2385)).toBe('ok')
    expect(priceCheck(item, 2860)).toBe('ok')
    expect(priceCheck(item, 3000)).toBe('above')
    expect(priceCheck(null, 500)).toBe('ok')
  })
})

describe('commission: 10%, only after the client pays', () => {
  it('one-off work: nothing until it is won, pending until it is paid, then earned', () => {
    expect(commissionOf(row({ stage: 'pitched' }))).toEqual({ earned: 0, pending: 0 })
    expect(commissionOf(row({ stage: 'won' }))).toEqual({ earned: 0, pending: 238.5 })
    expect(commissionOf(row({ stage: 'won', paid: true }))).toEqual({ earned: 238.5, pending: 0 })
    expect(commissionOf(row({ stage: 'lost', paid: true }))).toEqual({ earned: 0, pending: 0 })
  })
  it('a retainer increase: 10% of the added monthly fee for the first 3 paid months only', () => {
    const m = (months_paid: number) => commissionOf(row({ billing: 'monthly', amount: 1850, stage: 'won', months_paid }))
    expect(m(0)).toEqual({ earned: 0, pending: 555 })
    expect(m(1)).toEqual({ earned: 185, pending: 370 })
    expect(m(3)).toEqual({ earned: 555, pending: 0 })
    expect(m(7)).toEqual({ earned: 555, pending: 0 })
  })
})

describe('pitched versus won', () => {
  const list = [
    row({ id: 'a', stage: 'logged', amount: 500 }),
    row({ id: 'b', stage: 'pitched', amount: 2385 }),
    row({ id: 'c', stage: 'won', amount: 3000, paid: true }),
    row({ id: 'd', stage: 'won', billing: 'monthly', amount: 1850, months_paid: 1 }),
    row({ id: 'e', stage: 'lost', amount: 4000 }),
  ]
  it('an idea only logged is not a pitch yet; everything put to a client is', () => {
    const t = upsellTotals(list)
    expect(t.logged).toBe(1)
    expect(t.pitched).toBe(4)
    expect(t.won).toBe(2)
    expect(t.lost).toBe(1)
    expect(t.waiting).toBe(1)
  })
  it('one-off money and monthly money are never added together', () => {
    const t = upsellTotals(list)
    expect(t.pitchedOneOff).toBe(2385 + 3000 + 4000)
    expect(t.pitchedMonthly).toBe(1850)
    expect(t.wonOneOff).toBe(3000)
    expect(t.wonMonthly).toBe(1850)
    expect(t.paidOneOff).toBe(3000)
  })
  it('commission earned and still to come, across the list', () => {
    const t = upsellTotals(list)
    expect(t.commissionEarned).toBe(300 + 185)
    expect(t.commissionPending).toBe(370)
  })
  it('an empty list is all zeros, not NaN', () => {
    expect(Object.values(upsellTotals([])).every(v => v === 0)).toBe(true)
  })
})

describe('what is typed in', () => {
  it('a service from the list brings its own name, category and billing', () => {
    const out = sanitiseUpsellInput({ client_id: ' c1 ', service_key: 'meta_ads_management', amount: '1,950', notes: ' keen ', stage: 'pitched' })
    expect(out).toMatchObject({ client_id: 'c1', service_key: 'meta_ads_management', service_name: 'Meta ads management', category: 'Paid ads',
      billing: 'monthly', amount: 1950, notes: 'keen', stage: 'pitched' })
  })
  it('something not on the list is kept as "Other", with the words and billing the person gave', () => {
    const out = sanitiseUpsellInput({ service_key: 'other', service_name: ' Drone day ', billing: 'one_off', amount: 900 })
    expect(out).toMatchObject({ service_key: null, service_name: 'Drone day', category: 'Other', billing: 'one_off', amount: 900 })
  })
  it('an amount that is not money is dropped; paid and months paid never come from this door', () => {
    const out = sanitiseUpsellInput({ amount: 'lots', paid: true, months_paid: 3, id: 'x', rev: 9, stage: 'paid' })
    expect(out.amount).toBeUndefined()
    expect('paid' in out || 'months_paid' in out || 'id' in out || 'rev' in out || 'stage' in out).toBe(false)
  })
})

describe('moving a row between stages stamps the day and undoes what no longer holds', () => {
  const at = '2026-11-26T02:00:00.000Z'
  it('pitched, won and lost each keep their own date', () => {
    expect(stagePatch(row({ stage: 'logged', pitched_at: null }), 'pitched', at)).toMatchObject({ stage: 'pitched', pitched_at: at })
    expect(stagePatch(row(), 'won', at)).toMatchObject({ stage: 'won', won_at: at })
    expect(stagePatch(row(), 'lost', at)).toMatchObject({ stage: 'lost', lost_at: at })
  })
  it('won straight from an idea counts as pitched the same day', () => {
    expect(stagePatch(row({ stage: 'logged', pitched_at: null }), 'won', at)).toMatchObject({ pitched_at: at, won_at: at })
  })
  it('a win taken back is no longer paid — no commission on work that fell through', () => {
    expect(stagePatch(row({ stage: 'won', paid: true, months_paid: 2, paid_at: at }), 'lost', at)).toMatchObject({ paid: false, months_paid: 0, paid_at: null })
  })
})

describe('who may do what', () => {
  // the owner, 25 Nov 2026: "make sure each user in upsell can only see theirs. only contact and hello can see everyone's"
  const keeper = { id: 'hello', role: 'super_admin', seesAll: true }
  const yusuf = { id: 'yusuf', role: 'super_admin', seesAll: false }
  const manal = { id: 'manal', role: 'account_manager', seesAll: false }
  const karly = { id: 'karly', role: 'account_manager', seesAll: false }
  it('contact@ and hello@ are the two who see everyone\'s — by address, not by role', () => {
    expect(seesAllUpsells('contact@mdmmarketing.com.au')).toBe(true)
    expect(seesAllUpsells(' Hello@MDMmarketing.com.au ')).toBe(true)
    expect(seesAllUpsells('divina@mdmmarketing.com.au')).toBe(false)
    expect(seesAllUpsells('hello@elsewhere.com')).toBe(false)
    expect(seesAllUpsells(null)).toBe(false)
  })
  it('a row is seen by its own person and the two keepers — not a teammate, not another super admin', () => {
    expect(maySeeUpsell(manal, row())).toBe(true)
    expect(maySeeUpsell(keeper, row())).toBe(true)
    expect(maySeeUpsell(karly, row())).toBe(false)
    expect(maySeeUpsell(yusuf, row())).toBe(false)
    expect(maySeeUpsell(karly, row({ created_by: 'hello', pitched_by: 'karly' }))).toBe(true)
  })
  it('the same people change it', () => {
    expect(mayChangeUpsell(manal, row())).toBe(true)
    expect(mayChangeUpsell(keeper, row())).toBe(true)
    expect(mayChangeUpsell(karly, row())).toBe(false)
    expect(mayChangeUpsell(yusuf, row())).toBe(false)
  })
  it('only a keeper says the client has paid — nobody on commission ticks their own', () => {
    expect(mayMarkPaid(keeper)).toBe(true)
    expect(mayMarkPaid(manal)).toBe(false)
    expect(mayMarkPaid(yusuf)).toBe(false)
  })
  it('a row is deleted by a keeper, or by its own person before it is won', () => {
    expect(mayDeleteUpsell(keeper, row({ stage: 'won' }))).toBe(true)
    expect(mayDeleteUpsell(manal, row({ stage: 'pitched' }))).toBe(true)
    expect(mayDeleteUpsell(manal, row({ stage: 'won' }))).toBe(false)
    expect(mayDeleteUpsell(karly, row())).toBe(false)
    expect(mayDeleteUpsell(yusuf, row({ stage: 'won' }))).toBe(false)
  })
})

describe('the page is for super admins and the people it is opened to', () => {
  it('nobody has it by role but a super admin — not even an account manager', () => {
    expect(defaultAllows('super_admin', UPSELLS_PAGE)).toBe(true)
    for (const role of ['account_manager', 'general', 'editor', 'scheduler', 'quality_checker', 'client'] as const) {
      expect(defaultAllows(role, UPSELLS_PAGE), role).toBe(false)
    }
  })
  it('it can be opened to one person, and then they see it', () => {
    expect(isGrantablePage(UPSELLS_PAGE)).toBe(true)
    expect(canSeePage('account_manager', UPSELLS_PAGE, [UPSELLS_PAGE])).toBe(true)
    expect(canSeePage('account_manager', UPSELLS_PAGE, [])).toBe(false)
  })
})
