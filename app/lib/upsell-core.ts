/**
 * THE UPSELL TRACKER — THE RULES (Divina, via the owner, 25 Nov 2026: "a simple dashboard tracker that shows client
 * pitched versus won. Log of clients, service, amount, stage, is paid … We're encouraging the team to upsell
 * services on the clients … They get commission when the client has paid for the upsell").
 *
 * Pure: no I/O. The price list and the commission rules are the "Add-on price list", November 2026 (internal PDF):
 *
 *   - 10% on one-off work, after the client pays. Not paid, or refunded: no commission.
 *   - 10% on a retainer increase, for the FIRST 3 MONTHS of the added monthly fee only, after the client pays.
 *   - Quote inside the range; the low end is the approved starting point. No discounts without Divina's sign-off.
 *
 * All amounts are AUD, ex GST. One-off money and monthly money are never added together: "$3,000 and $1,850 a
 * month" is two facts.
 */

export const UPSELLS_PAGE = '/dashboard/upsells'
export const COMMISSION_RATE = 0.1
/** a retainer increase earns commission on its first three paid months */
export const RETAINER_COMMISSION_MONTHS = 3

export type UpsellBilling = 'one_off' | 'monthly'
export const UPSELL_STAGES = ['logged', 'pitched', 'won', 'lost'] as const
export type UpsellStage = (typeof UPSELL_STAGES)[number]
export const STAGE_WORDS: Record<UpsellStage, string> = { logged: 'Idea logged', pitched: 'Pitched', won: 'Won', lost: 'Lost' }

export type PriceItem = {
  key: string
  category: string
  name: string
  /** "per session", "per month" — as the price list prints it */
  unit: string
  billing: UpsellBilling
  low: number
  high: number
}

const C1 = 'Content and production', C2 = 'Paid ads', C3 = 'Web and funnels', C4 = 'Strategy and consulting', C5 = 'Events', C6 = 'Retainer upgrades'
const one = (key: string, category: string, name: string, unit: string, low: number, high: number): PriceItem => ({ key, category, name, unit, billing: 'one_off', low, high })
const mon = (key: string, category: string, name: string, low: number, high: number, unit = 'per month'): PriceItem => ({ key, category, name, unit, billing: 'monthly', low, high })

/** The Add-on price list, November 2026, in the PDF's own order. A service with two prices is two lines. */
export const PRICE_LIST: readonly PriceItem[] = [
  one('extra_half_day_video', C1, 'Extra half-day video shoot', 'per session', 2385, 2860),
  one('extra_half_day_photo', C1, 'Extra half-day photo shoot', 'per session', 1640, 2185),
  one('combined_half_day', C1, 'Combined half-day photo and video', 'per session', 3185, 4240),
  mon('monthly_production_package', C1, 'Monthly production package', 3850, 5130),
  one('campaign_content_only', C1, 'One-off campaign, content only', 'per campaign', 5740, 7645),
  one('campaign_meta_rollout', C1, 'Campaign with Meta ads rollout', 'per campaign', 7850, 10455),
  one('campaign_full_rollout', C1, 'Campaign, full rollout', 'per campaign', 9850, 13120),
  one('short_cuts', C1, 'Short cuts from existing footage', 'per cut', 425, 565),
  one('testimonial_film', C1, 'Testimonial or interview film', 'per film', 2850, 3795),
  one('brand_service_video', C1, 'Short brand or service video', 'per film', 3240, 4315),
  one('photo_pack_50', C1, 'Photography pack, 50 edited images', 'per pack', 1885, 2510),
  one('showreel_documentary', C1, 'Brand showreel or short documentary', 'per project', 8450, 12685),
  one('interstate_day', C1, 'Additional interstate production day', 'per day, local crew', 1285, 1710),
  one('crew_overtime', C1, 'Crew overtime', 'per hour, per crew member', 228, 305),

  mon('meta_ads_management', C2, 'Meta ads management', 1850, 2850),
  mon('google_bundle', C2, 'Google Ads, Business Profile and review bundle', 2640, 3515),
  one('google_ads_setup', C2, 'Google Ads management, standalone — one-off setup', 'one-off setup', 1485, 1980),
  mon('google_ads_ongoing', C2, 'Google Ads management, standalone — ongoing', 1850, 2465),
  one('seasonal_campaign', C2, 'Occasion or seasonal campaign', 'per campaign', 4250, 5660),

  mon('email_nurture', C3, 'Email nurture, VSLs and funnel mapping', 3250, 4330),
  one('landing_pages_build', C3, 'Custom landing pages and funnel audit — project build', 'project build', 11400, 15185),
  mon('landing_pages_retainer', C3, 'Custom landing pages and funnel audit — as a retainer', 3850, 5130, 'per month, while in delivery'),
  one('single_landing_page', C3, 'Single landing page, one-off', 'per page', 3240, 4315),
  one('custom_website', C3, 'Custom website', 'per project, starting range', 14850, 22275),
  mon('website_care', C3, 'Website care', 385, 515),
  mon('ongoing_seo', C3, 'Ongoing SEO', 1885, 2510),

  one('positioning_workshop', C4, 'Positioning and brand strategy workshop', 'one-off', 4650, 6195),
  one('brand_identity', C4, 'Branding suite — brand identity', 'per project', 8450, 11255),
  one('full_brand_strategy', C4, 'Branding suite — full brand strategy', 'per project', 16850, 22445),
  one('deck_design', C4, 'Pitch or capability deck — design and structure', 'per project', 3850, 5130),
  one('deck_written', C4, 'Pitch or capability deck — written and designed', 'per project', 7250, 9655),
  one('service_pipeline_build', C4, 'Service business pipeline build', 'upfront, 6 months', 38400, 51150),

  one('event_evening', C5, 'Single-evening event coverage', 'per event', 2350, 3130),
  one('location_shoot', C5, 'Short location or rooftop shoot', 'per shoot', 2350, 3130),
  one('event_multi_city', C5, 'Larger or multi-city event coverage', 'starting range, per job', 7850, 10455),

  mon('tier_production_only', C6, 'Production-only', 3850, 5130),
  mon('tier_starter', C6, 'Starter', 3250, 4330),
  mon('tier_growth', C6, 'Growth', 6450, 8595),
  mon('tier_management_meta', C6, 'Management engine, including Meta', 5850, 7790),
  mon('tier_management_google', C6, 'Management engine plus Google bundle', 7650, 10190),
  mon('tier_scale', C6, 'Scale', 10850, 14450),
  mon('tier_premium', C6, 'Premium', 13850, 18450),
]

export function priceItem(key: string | null | undefined): PriceItem | null {
  return PRICE_LIST.find(p => p.key === key) ?? null
}

/** Is the amount inside the approved range? Something not on the list has no range to break. */
export function priceCheck(item: Pick<PriceItem, 'low' | 'high'> | null | undefined, amount: number): 'ok' | 'below' | 'above' {
  if (!item) return 'ok'
  if (amount < item.low) return 'below'
  if (amount > item.high) return 'above'
  return 'ok'
}

export type Upsell = {
  id: string
  client_id: string
  client_name: string
  /** a PRICE_LIST key, or null for something not on the list */
  service_key: string | null
  service_name: string
  category: string
  billing: UpsellBilling
  /** AUD ex GST: the one-off price, or the ADDED monthly fee */
  amount: number
  stage: UpsellStage
  /** one-off work: the client has paid */
  paid: boolean
  /** a monthly fee: how many months the client has paid so far */
  months_paid: number
  paid_at: string | null
  /** whose upsell it is — who the commission goes to */
  pitched_by: string
  pitched_by_name: string
  logged_at: string
  pitched_at: string | null
  won_at: string | null
  lost_at: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  rev: number
}

const cents = (n: number) => Math.round(n * 100) / 100

/** Commission on one row: what has been earned (the client paid) and what is still to come if they do. */
export function commissionOf(u: Pick<Upsell, 'stage' | 'billing' | 'amount' | 'paid' | 'months_paid'>): { earned: number; pending: number } {
  if (u.stage !== 'won' || !(u.amount > 0)) return { earned: 0, pending: 0 }
  if (u.billing === 'monthly') {
    const months = Math.max(0, Math.min(RETAINER_COMMISSION_MONTHS, Math.floor(Number(u.months_paid) || 0)))
    return {
      earned: cents(u.amount * COMMISSION_RATE * months),
      pending: cents(u.amount * COMMISSION_RATE * (RETAINER_COMMISSION_MONTHS - months)),
    }
  }
  const whole = cents(u.amount * COMMISSION_RATE)
  return u.paid ? { earned: whole, pending: 0 } : { earned: 0, pending: whole }
}

export type UpsellTotals = {
  /** ideas logged and not yet put to the client */
  logged: number
  /** everything put to a client: still waiting, won or lost */
  pitched: number
  waiting: number
  won: number
  lost: number
  pitchedOneOff: number
  pitchedMonthly: number
  wonOneOff: number
  wonMonthly: number
  paidOneOff: number
  commissionEarned: number
  commissionPending: number
}

export function upsellTotals(rows: readonly Upsell[]): UpsellTotals {
  const t: UpsellTotals = { logged: 0, pitched: 0, waiting: 0, won: 0, lost: 0, pitchedOneOff: 0, pitchedMonthly: 0,
    wonOneOff: 0, wonMonthly: 0, paidOneOff: 0, commissionEarned: 0, commissionPending: 0 }
  for (const r of rows) {
    const amount = r.amount > 0 ? r.amount : 0
    if (r.stage === 'logged') { t.logged++; continue }
    t.pitched++
    if (r.billing === 'monthly') t.pitchedMonthly += amount
    else t.pitchedOneOff += amount
    if (r.stage === 'pitched') t.waiting++
    if (r.stage === 'lost') t.lost++
    if (r.stage === 'won') {
      t.won++
      if (r.billing === 'monthly') t.wonMonthly += amount
      else { t.wonOneOff += amount; if (r.paid) t.paidOneOff += amount }
      const c = commissionOf(r)
      t.commissionEarned += c.earned
      t.commissionPending += c.pending
    }
  }
  t.commissionEarned = cents(t.commissionEarned)
  t.commissionPending = cents(t.commissionPending)
  return t
}

/** "$2,385", "$238.50" — whole dollars unless there are cents to show. */
export function money(n: number | null | undefined): string {
  const v = Number(n) || 0
  const whole = Math.abs(v - Math.round(v)) < 0.005
  return `$${v.toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`
}

/* ── what is typed in ───────────────────────────────────────────────────── */

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s || null
}

function amountOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return undefined
  return cents(n)
}

export type UpsellInput = Partial<Pick<Upsell, 'client_id' | 'service_key' | 'service_name' | 'category' | 'billing' | 'amount' | 'stage' | 'notes' | 'pitched_by'>>

/**
 * A row's own fields from a browser. Wrong values are dropped, never guessed at. `paid` and `months_paid` never
 * come through this door (mayMarkPaid), and neither do the dates — `stagePatch` stamps those.
 */
export function sanitiseUpsellInput(raw: unknown): UpsellInput {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: UpsellInput = {}
  if (typeof r.client_id === 'string' && r.client_id.trim()) out.client_id = r.client_id.trim().slice(0, 80)
  if ('service_key' in r) {
    const item = priceItem(typeof r.service_key === 'string' ? r.service_key : null)
    if (item) {
      out.service_key = item.key; out.service_name = item.name; out.category = item.category; out.billing = item.billing
    } else {
      const name = text(r.service_name, 140)
      if (name) {
        out.service_key = null; out.service_name = name; out.category = 'Other'
        out.billing = r.billing === 'monthly' ? 'monthly' : 'one_off'
      }
    }
  }
  if ('amount' in r) { const a = amountOf(r.amount); if (a !== undefined) out.amount = a }
  if ((UPSELL_STAGES as readonly string[]).includes(String(r.stage))) out.stage = r.stage as UpsellStage
  if ('notes' in r && (r.notes === null || typeof r.notes === 'string')) out.notes = text(r.notes, 1000)
  if (typeof r.pitched_by === 'string' && r.pitched_by.trim()) out.pitched_by = r.pitched_by.trim().slice(0, 80)
  return out
}

/**
 * What changes when a row moves to a stage: the stage, the day it happened, and anything that no longer holds.
 * A win that is taken back is no longer paid — there is no commission on work that fell through.
 */
export function stagePatch(u: Pick<Upsell, 'stage' | 'pitched_at' | 'won_at' | 'lost_at'>, to: UpsellStage, at: string): Partial<Upsell> {
  const patch: Partial<Upsell> = { stage: to }
  if (to !== 'logged' && !u.pitched_at) patch.pitched_at = at
  if (to === 'won') { patch.won_at = at; patch.lost_at = null }
  if (to === 'lost') patch.lost_at = at
  if (to === 'logged') patch.pitched_at = null
  if (to === 'logged' || to === 'pitched') patch.lost_at = null
  if (to !== 'won') { patch.won_at = null; patch.paid = false; patch.months_paid = 0; patch.paid_at = null }
  return patch
}

/* ── who may do what (the page itself is opened by page-access-core) ────── */

export type UpsellViewer = { id: string; role: string }

/** Change a row: the person whose upsell it is, or a super admin. Teammates on the page read each other's. */
export function mayChangeUpsell(v: UpsellViewer, u: Pick<Upsell, 'pitched_by' | 'created_by'>): boolean {
  return v.role === 'super_admin' || u.pitched_by === v.id || u.created_by === v.id
}

/** "The client has paid" decides commission, so the people on commission do not tick their own. */
export function mayMarkPaid(v: UpsellViewer): boolean {
  return v.role === 'super_admin'
}

export function mayDeleteUpsell(v: UpsellViewer, u: Pick<Upsell, 'pitched_by' | 'created_by' | 'stage'>): boolean {
  if (v.role === 'super_admin') return true
  return mayChangeUpsell(v, u) && u.stage !== 'won'
}
