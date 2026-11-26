/**
 * CREATOR CAMPAIGNS — THE RULES (the owner, 25 Nov 2026: "a page where we can build this portal … super admins can
 * create for any client and AM can join in … or AM create theirs"). Pure: no imports, no I/O, fully unit-tested
 * (tests/creator-campaign-core.test.ts). The server wrappers (creator-campaigns.ts) and both sets of routes ask
 * these functions and decide nothing themselves.
 *
 * A campaign is one client's event or content push with creators: who the team is thinking of, who the client has
 * said yes to, who has been invited, who is coming. The client sees a creator only once the team puts them in front
 * of the client ("With client"); an idea is the team's own.
 *
 * VERSION ONE NEVER CONTACTS A CREATOR. "Invited", "Confirmed" and "Declined" record what the team did themselves.
 */

export const CREATOR_STAGES = ['idea', 'with_client', 'approved', 'passed', 'invited', 'confirmed', 'declined'] as const
export type CreatorStage = (typeof CREATOR_STAGES)[number]
export function isCreatorStage(v: unknown): v is CreatorStage {
  return (CREATOR_STAGES as readonly string[]).includes(String(v))
}

export const CAMPAIGN_STATUSES = ['draft', 'live', 'closed'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]
export const CAMPAIGN_KINDS = ['event', 'content'] as const
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number]

export type Campaign = {
  id: string
  client_id: string
  title: string
  kind: CampaignKind
  starts_at: string | null
  ends_at: string | null
  place: string | null
  seats: number | null
  /** the last day the client may answer, YYYY-MM-DD */
  closes_on: string | null
  /** what each creator delivers, one line each */
  deliverables: string[]
  usage_terms: string | null
  status: CampaignStatus
  /** the team's switch: on the client's portal or not */
  client_visible: boolean
  /** team members added to this campaign, whoever the client is */
  member_ids: string[]
  created_by: string | null
  created_at: string
  updated_at: string
  rev: number
}

export type CreatorTerms = 'gifted' | 'paid'

export type CampaignCreator = {
  /** `${campaign_id}__${creator_id}` — one row per creator per campaign */
  id: string
  campaign_id: string
  client_id: string
  creator_id: string
  name: string
  photo_url: string | null
  instagram: string | null
  instagram_followers: number | null
  tiktok: string | null
  tiktok_followers: number | null
  /** why this creator, for this client — the client reads it */
  why: string | null
  terms: CreatorTerms
  rate: string | null
  /** up to six links to their posts */
  samples: string[]
  stage: CreatorStage
  /** what the client wrote when they answered */
  client_note: string | null
  decided_at: string | null
  decided_by: string | null
  rev: number
}

/** The agency's own list of creators: typed in once, picked again on the next campaign. */
export type Creator = {
  id: string
  name: string
  photo_url: string | null
  instagram: string | null
  instagram_followers: number | null
  tiktok: string | null
  tiktok_followers: number | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Who is asking. `clientIds: null` = every client (a super admin). */
export type Viewer = { id: string; role: string; clientIds: string[] | null }

export const campaignCreatorId = (campaignId: string, creatorId: string) => `${campaignId}__${creatorId}`

/* ── who may see, make and change ───────────────────────────────────────── */

const onClient = (v: Viewer, clientId: string) => v.clientIds === null || v.clientIds.includes(clientId)

/**
 * A super admin sees all. An account manager sees their clients' campaigns and any they were added to. Having MADE
 * a campaign is not a key by itself: a manager taken off the client loses that client's campaigns with it, unless
 * somebody keeps them on one by name. Anyone else on the team sees only what they were added to; a client never
 * sees the team's page at all (the portal is their surface).
 */
export function maySeeCampaign(v: Viewer, c: Pick<Campaign, 'client_id' | 'member_ids' | 'created_by'>): boolean {
  if (v.role === 'client') return false
  if (v.role === 'super_admin') return true
  if ((c.member_ids ?? []).includes(v.id)) return true
  return v.role === 'account_manager' && onClient(v, c.client_id)
}

export function mayCreateFor(v: Viewer, clientId: string): boolean {
  if (v.role === 'super_admin') return true
  return v.role === 'account_manager' && !!clientId && onClient(v, clientId)
}

const MANAGES = ['super_admin', 'account_manager']

/** Changing a campaign, its creators or who is on it: the managers who can see it. Anyone else added to it looks. */
export function mayEditCampaign(v: Viewer, c: Pick<Campaign, 'client_id' | 'member_ids' | 'created_by'>): boolean {
  return MANAGES.includes(v.role) && maySeeCampaign(v, c)
}

export function mayDeleteCampaign(v: Viewer, c: Pick<Campaign, 'client_id' | 'member_ids' | 'created_by' | 'status'>): boolean {
  if (v.role === 'super_admin') return true
  return v.role === 'account_manager' && maySeeCampaign(v, c) && c.created_by === v.id && c.status === 'draft'
}

/* ── how a creator moves ────────────────────────────────────────────────── */

export type Actor = 'team' | 'client'

const TEAM_MOVES: Record<CreatorStage, readonly CreatorStage[]> = {
  idea: ['with_client'],
  // take back, or answer for the client (they said it on the phone)
  with_client: ['idea', 'approved', 'passed'],
  approved: ['invited'],
  passed: ['with_client'],
  invited: ['confirmed', 'declined'],
  confirmed: ['declined'],
  declined: ['invited'],
}
const CLIENT_MOVES: Record<CreatorStage, readonly CreatorStage[]> = {
  idea: [], approved: [], invited: [], confirmed: [], declined: [],
  with_client: ['approved', 'passed'],
  // "change my mind": a no becomes a yes; a yes is the team's to undo, because somebody may already have been invited
  passed: ['approved'],
}

export const STAGE_LABEL: Record<CreatorStage, string> = {
  idea: 'Idea', with_client: 'With client', approved: 'Approved', passed: 'Passed',
  invited: 'Invited', confirmed: 'Confirmed', declined: 'Declined',
}

export function stageMove(from: CreatorStage, to: CreatorStage, actor: Actor): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: 'Already there' }
  const allowed = (actor === 'client' ? CLIENT_MOVES : TEAM_MOVES)[from] ?? []
  if (allowed.includes(to)) return { ok: true }
  return { ok: false, reason: `A creator who is ${STAGE_LABEL[from].toLowerCase()} cannot be moved to ${STAGE_LABEL[to].toLowerCase()}` }
}

/** Where the team may move a creator next, in the order the buttons are drawn. */
export function teamMoves(from: CreatorStage): readonly CreatorStage[] {
  return TEAM_MOVES[from] ?? []
}

/** `YYYY-MM-DD` as "Fri 27 Nov", in no time zone at all (a date, not a moment). */
export function dayWords(day: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return null
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  return `${wd} ${d.getUTCDate()} ${mo}`
}

/** May the client still answer? `today` is the client's own day, YYYY-MM-DD; the closing day itself still counts. */
export function clientMayDecide(
  c: Pick<Campaign, 'status' | 'client_visible' | 'closes_on'>, today: string,
): { ok: true } | { ok: false; reason: string } {
  if (c.status !== 'live' || !c.client_visible) return { ok: false, reason: 'This list is not open' }
  if (c.closes_on && today > c.closes_on) return { ok: false, reason: `This list closed on ${dayWords(c.closes_on) ?? c.closes_on}` }
  return { ok: true }
}

/* ── what is counted and what is shown ──────────────────────────────────── */

export type SeatCount = { seats: number | null; confirmed: number; waiting: number; open: number | null; over: boolean }

export function seatCount(c: Pick<Campaign, 'seats'>, creators: readonly Pick<CampaignCreator, 'stage'>[]): SeatCount {
  const confirmed = creators.filter(x => x.stage === 'confirmed').length
  const waiting = creators.filter(x => x.stage === 'invited').length
  const seats = typeof c.seats === 'number' && c.seats > 0 ? c.seats : null
  return {
    seats, confirmed, waiting,
    open: seats === null ? null : Math.max(0, seats - confirmed - waiting),
    over: seats !== null && confirmed > seats,
  }
}

/** "8 of 10 confirmed", "3 confirmed" — the line on a card and at the top of the client's page. */
export function seatWords(n: SeatCount): string {
  return n.seats === null ? `${n.confirmed} confirmed` : `${n.confirmed} of ${n.seats} confirmed`
}

export type ClientView = { shortlist: CampaignCreator[]; passed: CampaignCreator[]; confirmed: CampaignCreator[] }

/** What the client's page holds, or null when the campaign is not theirs to see yet. */
export function clientSees(
  c: Pick<Campaign, 'status' | 'client_visible'>, creators: readonly CampaignCreator[],
): ClientView | null {
  if (c.status === 'draft' || !c.client_visible) return null
  return {
    shortlist: creators.filter(x => x.stage === 'with_client'),
    passed: creators.filter(x => x.stage === 'passed'),
    confirmed: creators.filter(x => x.stage === 'approved' || x.stage === 'invited' || x.stage === 'confirmed'),
  }
}

/* ── what is typed in, tidied ───────────────────────────────────────────── */

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s || null
}

/** "@Name", "name" or a profile link → the bare lower-case handle; anything else → null. */
export function handleOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let s = v.trim()
  if (!s) return null
  const link = /^https?:\/\/(?:www\.)?(?:instagram\.com|tiktok\.com)\/@?([^/?#]+)/i.exec(s)
  if (link) s = link[1]
  s = s.replace(/^@/, '').toLowerCase()
  return /^[a-z0-9._]{1,40}$/.test(s) ? s : null
}

const count = (v: unknown): number | null | undefined => {
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN
  return Number.isInteger(n) && n >= 0 && n <= 2_000_000_000 ? n : undefined
}

const isoMoment = (v: unknown): string | null | undefined => {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

const httpLink = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  try { const u = new URL(v.trim()); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 500) : null } catch { return null }
}

/**
 * A campaign's fields from a browser: known keys only, trimmed and capped, wrong values DROPPED rather than
 * guessed at (a dropped key leaves what is saved alone). Never `id`, `rev`, `created_*` — those are the server's.
 */
export function sanitiseCampaignInput(raw: unknown): Partial<Campaign> {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Partial<Campaign> = {}
  if (typeof r.client_id === 'string' && r.client_id.trim()) out.client_id = r.client_id.trim().slice(0, 80)
  if ('title' in r) { const t = text(r.title, 140); if (t) out.title = t }
  if ((CAMPAIGN_KINDS as readonly string[]).includes(String(r.kind))) out.kind = r.kind as CampaignKind
  if ((CAMPAIGN_STATUSES as readonly string[]).includes(String(r.status))) out.status = r.status as CampaignStatus
  if (typeof r.client_visible === 'boolean') out.client_visible = r.client_visible
  for (const k of ['starts_at', 'ends_at'] as const) {
    if (k in r) { const m = isoMoment(r[k]); if (m !== undefined) out[k] = m }
  }
  if ('place' in r && (r.place === null || typeof r.place === 'string')) out.place = text(r.place, 200)
  if ('usage_terms' in r && (r.usage_terms === null || typeof r.usage_terms === 'string')) out.usage_terms = text(r.usage_terms, 600)
  if ('seats' in r) {
    if (r.seats === null || r.seats === '') out.seats = null
    else { const n = count(r.seats); if (typeof n === 'number' && n >= 1 && n <= 500) out.seats = n }
  }
  if ('closes_on' in r) {
    if (r.closes_on === null || r.closes_on === '') out.closes_on = null
    else if (typeof r.closes_on === 'string' && dayWords(r.closes_on)) out.closes_on = r.closes_on
  }
  if (Array.isArray(r.deliverables)) {
    out.deliverables = r.deliverables.map(d => text(d, 200)).filter((d): d is string => !!d).slice(0, 12)
  }
  if (Array.isArray(r.member_ids)) {
    out.member_ids = [...new Set(r.member_ids.filter((m): m is string => typeof m === 'string' && !!m.trim()).map(m => m.trim().slice(0, 80)))].slice(0, 40)
  }
  return out
}

/** A creator's fields from a browser. Never the stage: that moves only through `stageMove`. */
export function sanitiseCreatorInput(raw: unknown): Partial<CampaignCreator> {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Partial<CampaignCreator> = {}
  if ('name' in r) { const n = text(r.name, 120); if (n) out.name = n }
  if ('photo_url' in r) out.photo_url = r.photo_url === null || r.photo_url === '' ? null : httpLink(r.photo_url)
  for (const k of ['instagram', 'tiktok'] as const) {
    if (k in r) out[k] = handleOf(r[k])
  }
  for (const k of ['instagram_followers', 'tiktok_followers'] as const) {
    if (k in r) { const n = count(r[k]); if (n !== undefined) out[k] = n }
  }
  if ('why' in r && (r.why === null || typeof r.why === 'string')) out.why = text(r.why, 1200)
  if (r.terms === 'gifted' || r.terms === 'paid') out.terms = r.terms
  if ('rate' in r && (r.rate === null || typeof r.rate === 'string')) out.rate = text(r.rate, 120)
  if (Array.isArray(r.samples)) out.samples = r.samples.map(httpLink).filter((s): s is string => !!s).slice(0, 6)
  return out
}

/** "17.9K", "1.1M", "155" — a follower count as people say it. */
export function followerWords(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(n)
}

/* ── the event's time is Melbourne's ────────────────────────────────────── */

const MELBOURNE = 'Australia/Melbourne'
const melbourneParts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: MELBOURNE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]))
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) }
}

/**
 * A moment as the value a `datetime-local` box wants — IN MELBOURNE, not in the typist's own time zone (review,
 * 26 Nov 2026: a teammate typing 12:30 from a laptop set to another zone showed the client a different time).
 */
export function melbourneInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = melbourneParts(d)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${p.y}-${two(p.mo)}-${two(p.d)}T${two(p.h)}:${two(p.mi)}`
}

/** What was typed in that box, read as Melbourne wall time → the moment, or null. */
export function fromMelbourneInput(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v ?? ''))
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  // how far ahead of UTC Melbourne is at about that moment; asked twice so a daylight-saving edge settles
  const ahead = (at: number) => { const p = melbourneParts(new Date(at)); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - at }
  let at = wall - ahead(wall)
  at = wall - ahead(at)
  return new Date(at).toISOString()
}
