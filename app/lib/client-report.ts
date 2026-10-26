import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { table } from '@/lib/db'
import type { AudienceSnapshot, Client, ClientReport } from '@/lib/db-types'
import {
  GENDER_WORDS, monthRange, previousMonth, readReportData, reportId, reportPrompt, toBreakdown,
  type Audience, type MonthKey, type PlatformFigures, type ReportData, type TopPost,
} from './client-report-core'

/**
 * THE MONTHLY CLIENT REPORT — the server half (client-report-core.ts has the why). Reads every figure from the client's
 * own accounts through Zernio (read only — nothing is posted or changed), keeps the month's audience snapshot, and has
 * Claude write the analysis with the team's guide. Saved per client per month in `client_reports`.
 */

const BASE = process.env.ZERNIO_API_URL ?? 'https://zernio.com/api/v1'

async function zernio<T = Record<string, unknown>>(path: string, query: Record<string, string | number | undefined>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const key = process.env.ZERNIO_API_KEY
  if (!key) return { ok: false, error: 'Zernio is not connected (no API key)' }
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  try {
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' })
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: String(body.error ?? body.message ?? `Zernio ${res.status}`) }
    return { ok: true, data: body as T }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Zernio could not be reached' }
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : [])
const metricTotal = (metrics: Record<string, unknown>, k: string) => num(obj(metrics[k]).total ?? metrics[k])

type Account = { id: string; platform: 'instagram' | 'facebook'; handle: string | null }

async function accountsOf(clientId: string): Promise<Account[]> {
  const rows = await table<{ id: string; client_id: string | null; platform: string; provider_account_id: string | null; username: string | null; name: string | null; active?: boolean | null }>('social_accounts')
    .list({ where: a => a.client_id === clientId && a.active !== false && (a.platform === 'instagram' || a.platform === 'facebook') && !!a.provider_account_id })
  const seen = new Set<string>()
  return rows.filter(a => !seen.has(a.platform) && seen.add(a.platform))
    .map(a => ({ id: String(a.provider_account_id), platform: a.platform as Account['platform'], handle: a.username ?? a.name ?? null }))
    .sort((a, b) => (a.platform === 'instagram' ? -1 : 1) - (b.platform === 'instagram' ? -1 : 1))
}

/** the month's posts on one account, with their caption, picture, link and numbers */
async function postsOf(acc: Account, m: MonthKey): Promise<TopPost[]> {
  const { from, to } = monthRange(m)
  const r = await zernio<{ posts?: unknown }>('/analytics', { platform: acc.platform, accountId: acc.id, fromDate: from, toDate: to, limit: 100, source: 'all' })
  if (!r.ok) return []
  return arr(r.data.posts).map(p => {
    const a = obj(p.analytics ?? p.metrics)
    const plat = arr(p.platforms).find(x => String(x.platform ?? '') === acc.platform) ?? {}
    return {
      id: String(p._id ?? p.id ?? p.postId ?? ''),
      platform: acc.platform,
      publishedAt: String(p.publishedAt ?? plat.publishedAt ?? p.scheduledFor ?? '') || null,
      url: String(p.platformPostUrl ?? plat.platformPostUrl ?? '') || null,
      thumbnail: String(p.thumbnailUrl ?? arr(p.mediaItems)[0]?.url ?? '') || null,
      caption: String(p.content ?? p.caption ?? '').slice(0, 600),
      format: String(p.mediaType ?? arr(p.mediaItems)[0]?.type ?? '') || null,
      views: num(a.views) ?? num(a.impressions) ?? 0,
      reach: num(a.reach) ?? 0,
      likes: num(a.likes) ?? 0,
      comments: num(a.comments) ?? 0,
      shares: num(a.shares) ?? 0,
      saves: num(a.saves) ?? 0,
      engagementRate: num(a.engagementRate),
    }
  }).filter(p => p.id)
}

/** the audience breakdown: live for the current month (and saved as the month's snapshot), else the saved snapshot */
async function audienceOf(acc: Account, clientId: string, m: MonthKey, now: Date): Promise<Audience | null> {
  const id = `${acc.id}_${m}`
  const current = m === `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  if (current) {
    const fresh = await snapshotAudience(acc.id, clientId, m)
    if (fresh) return fresh
  }
  const kept = await table<AudienceSnapshot>('audience_snapshots').get(id).catch(() => null)
  return kept?.audience ? kept.audience as Audience : null
}

/** read Instagram's audience now and keep it as this month's (the daily job and the page both call this) */
export async function snapshotAudience(accountId: string, clientId: string | null, m: MonthKey): Promise<Audience | null> {
  const read = async (metric: string) => {
    const r = await zernio<{ demographics?: unknown }>('/analytics/instagram/demographics', { accountId, metric, breakdown: 'age,gender,city,country', timeframe: 'this_month' })
    if (!r.ok) return null
    const d = obj(r.data.demographics)
    return {
      gender: toBreakdown(arr(d.gender), 3, s => GENDER_WORDS[s] ?? s),
      age: toBreakdown(arr(d.age), 8).sort((a, b) => a.label.localeCompare(b.label)),
      cities: toBreakdown(arr(d.city), 8),
      countries: toBreakdown(arr(d.country), 6),
    }
  }
  const followers = await read('follower_demographics')
  if (!followers) return null
  // who engaged this month, beside who follows — Instagram's own engaged-audience breakdown
  const engaged = await read('engaged_audience_demographics')
  const audience: Audience = {
    asOf: new Date().toISOString(), ...followers,
    engaged: engaged && (engaged.gender.length || engaged.age.length || engaged.cities.length) ? engaged : null,
  }
  if (!audience.gender.length && !audience.age.length && !audience.cities.length) return null
  const now = new Date().toISOString()
  const id = `${accountId}_${m}`
  await table<AudienceSnapshot>('audience_snapshots').claim(id, cur => ({
    ...(cur ?? { id, created_at: now }), id, account_id: accountId, client_id: clientId, month: m, audience: audience as never, updated_at: now,
  } as AudienceSnapshot)).catch(() => undefined)
  return audience
}

async function figuresOf(acc: Account, profileId: string | null, m: MonthKey, gaps: string[]): Promise<PlatformFigures | null> {
  const { from, to } = monthRange(m)
  const label = acc.platform === 'instagram' ? 'Instagram' : 'Facebook'
  const dash = await zernio<Record<string, unknown>>('/analytics/dashboard', {
    ...(profileId ? { profileId } : {}), platform: acc.platform, fromDate: from, toDate: to, compare: 'previous_period', topPosts: 10, recentPosts: 0,
  })
  if (!dash.ok) { gaps.push(`${label}: ${dash.error}`); return null }
  const d = dash.data
  const totals = obj(d.totals), prev = obj(d.previousTotals)
  const mine = (f: unknown) => arr(obj(f).byAccount).find(a => String(a.accountId) === acc.id) ?? obj(f)
  const fNow = mine(d.followers), fPrev = mine(d.previousFollowers)
  const fig: PlatformFigures = {
    platform: acc.platform,
    handle: acc.handle,
    followers: { start: num(fPrev.current), end: num(fNow.current), previousEnd: num(fPrev.current), gained: num(fNow.gained) },
    views: num(totals.views) ?? num(totals.impressions),
    reach: num(totals.reach),
    interactions: [totals.likes, totals.comments, totals.shares, totals.saves].map(num).reduce<number | null>((n, v) => (v == null ? n : (n ?? 0) + v), null),
    likes: num(totals.likes), comments: num(totals.comments), shares: num(totals.shares), saves: num(totals.saves),
    profileVisits: null, linkTaps: null, viewsFromFollowers: null, viewsFromNonFollowers: null,
    previous: {
      views: num(prev.views) ?? num(prev.impressions), reach: num(prev.reach),
      interactions: [prev.likes, prev.comments, prev.shares, prev.saves].map(num).reduce<number | null>((n, v) => (v == null ? n : (n ?? 0) + v), null),
    },
    daily: arr(d.daily).map(x => ({ date: String(x.date), views: num(x.views) ?? num(x.impressions) ?? 0, engagement: num(x.engagement) ?? 0, followersGained: num(x.followersGained) ?? 0 })),
    topPosts: [],
    posts: 0,
  }
  // the month's posts — captions, pictures and links, ranked by views (the guide: "we primarily report on views")
  const posts = await postsOf(acc, m)
  fig.posts = posts.length
  fig.topPosts = [...posts].sort((a, b) => b.views - a.views).slice(0, 5)
  if (!posts.length) {
    // the dashboard's own top posts, when the post list gave nothing
    fig.topPosts = arr(d.topPosts).slice(0, 5).map(t => {
      const mt = obj(t.metrics)
      return { id: String(t.postId ?? ''), platform: acc.platform, publishedAt: String(t.publishedAt ?? '') || null, url: null, thumbnail: null, caption: '', format: null,
        views: num(mt.views) ?? num(mt.impressions) ?? 0, reach: num(mt.reach) ?? 0, likes: num(mt.likes) ?? 0, comments: num(mt.comments) ?? 0,
        shares: num(mt.shares) ?? 0, saves: num(mt.saves) ?? 0, engagementRate: num(mt.engagementRate) }
    }).sort((a, b) => b.views - a.views)
  }
  // Instagram's own account figures: the account's views and interactions, profile visits, bio link taps, and who
  // the views came from (the guide's Overview tab)
  if (acc.platform === 'instagram') {
    const ins = await zernio<{ metrics?: unknown }>('/analytics/instagram/account-insights', {
      accountId: acc.id, metrics: 'views,reach,total_interactions,profile_views,profile_links_taps', fromDate: from, toDate: to, metricType: 'total_value',
    })
    if (ins.ok) {
      const mt = obj(ins.data.metrics)
      fig.views = metricTotal(mt, 'views') ?? fig.views
      fig.reach = metricTotal(mt, 'reach') ?? fig.reach
      fig.interactions = metricTotal(mt, 'total_interactions') ?? fig.interactions
      fig.profileVisits = metricTotal(mt, 'profile_views')
      fig.linkTaps = metricTotal(mt, 'profile_links_taps')
    } else gaps.push(`Instagram account figures: ${ins.error}`)
    const split = await zernio<{ metrics?: unknown }>('/analytics/instagram/account-insights', {
      accountId: acc.id, metrics: 'views', fromDate: from, toDate: to, metricType: 'total_value', breakdown: 'follow_type',
    })
    if (split.ok) {
      const v = obj(obj(split.data.metrics).views)
      const rows = arr(v.breakdown ?? v.breakdowns ?? obj(v.breakdown).results)
      const val = (k: RegExp) => rows.filter(r => k.test(String(r.dimension ?? r.dimensionValue ?? r.key ?? ''))).reduce((n, r) => n + (num(r.value) ?? 0), 0)
      const f = val(/^follower$/i), nf = val(/non[_ ]?follower/i)
      if (f + nf > 0) { fig.viewsFromFollowers = Math.round((f / (f + nf)) * 1000) / 10; fig.viewsFromNonFollowers = Math.round((nf / (f + nf)) * 1000) / 10 }
    }
  }
  return fig
}

/** every figure for one client's month, read now, and kept on the report */
export async function loadReportData(clientId: string, m: MonthKey): Promise<ReportData> {
  const client = await table<Client>('clients').get(clientId)
  if (!client) throw new Error('No such client')
  const accounts = await accountsOf(clientId)
  const gaps: string[] = []
  if (!accounts.length) gaps.push('This client has no Instagram or Facebook account connected in Zernio')
  const now = new Date()
  const profileId = String((client as { social_profile_id?: string | null }).social_profile_id ?? '') || null
  const platforms = (await Promise.all(accounts.map(a => figuresOf(a, profileId, m, gaps)))).filter((p): p is PlatformFigures => !!p)
  const ig = accounts.find(a => a.platform === 'instagram')
  const audience = ig ? await audienceOf(ig, clientId, m, now) : null
  if (ig && !audience) gaps.push('Audience breakdown: Instagram only gives it for the current month, to accounts with 100+ followers — none was kept for this month')
  const data: ReportData = {
    clientId, clientName: client.name, industry: (client as { industry?: string | null }).industry ?? null,
    month: m, fetchedAt: now.toISOString(), platforms, audience, gaps,
  }
  const id = reportId(clientId, m)
  const stamp = now.toISOString()
  await table<ClientReport>('client_reports').claim(id, cur => ({
    ...(cur ?? { id, client_id: clientId, month: m, created_at: stamp }), data: data as never, updated_at: stamp,
  } as ClientReport))
  return data
}

/** the shoots booked for the month after — their concepts go in the report (the guide's "Keep in mind") */
async function nextShootConcepts(clientId: string, m: MonthKey): Promise<string[]> {
  const { to } = monthRange(m)
  const shoots = await table<{ id: string; client_id: string; title: string; concept?: string | null; shoot_date?: string | null; archived_at?: string | null }>('batches')
    .list({ where: b => b.client_id === clientId && !b.archived_at && !!b.shoot_date && String(b.shoot_date) > to })
  return shoots.slice(0, 6).map(s => `${s.title}${s.shoot_date ? ` (${String(s.shoot_date).slice(0, 10)})` : ''}${s.concept ? `: ${String(s.concept).slice(0, 400)}` : ''}`)
}

const anthropic = new Anthropic()

/**
 * WRITE THE REPORT — Claude Opus 5.5, streamed (a long report), with the guide's prompt and the page's figures. The draft
 * replaces the body; the team then edits it. Refused or cut short: said, never saved half-written.
 */
export async function generateReport(clientId: string, m: MonthKey, by: string, opts: { objective: string; notes: string }): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  const id = reportId(clientId, m)
  const saved = await table<ClientReport>('client_reports').get(id)
  const data = readReportData(saved?.data) ?? await loadReportData(clientId, m)
  const before = await table<ClientReport>('client_reports').get(reportId(clientId, previousMonth(m))).catch(() => null)
  const { system, user } = reportPrompt({ data, objective: opts.objective, notes: opts.notes, shootConcepts: await nextShootConcepts(clientId, m), previousReport: before?.body ?? null })
  // what Claude's account says, in words — a top-up is a person's job, not a retry (live, 26 Oct 2026: out of credit)
  const said = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e)
    if (/credit balance is too low/i.test(m)) return 'The Anthropic account is out of credit — top it up under Plans & Billing at console.anthropic.com, then press Generate again'
    if (e instanceof Anthropic.RateLimitError) return 'Claude is busy right now — try again in a minute'
    if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key is not valid — check ANTHROPIC_API_KEY'
    return `Claude could not write the report: ${m.slice(0, 200)}`
  }
  let msg: { stop_reason: string; content: { type: string; text?: string }[] }
  try {
  const stream = anthropic.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    output_config: { effort: 'high' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  } as never)
  msg = await stream.finalMessage() as unknown as typeof msg
  } catch (e) {
    console.error('[client-report] writing the report failed:', e instanceof Error ? e.message : e)
    return { ok: false, error: said(e) }
  }
  if (msg.stop_reason === 'refusal') return { ok: false, error: 'Claude declined to write this report — try again, or write it by hand' }
  const body = msg.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
  if (!body) return { ok: false, error: 'Claude returned no report — try again' }
  if (msg.stop_reason === 'max_tokens') return { ok: false, error: 'The report was cut short — try again' }
  const now = new Date().toISOString()
  await table<ClientReport>('client_reports').claim(id, cur => ({
    ...(cur ?? { id, client_id: clientId, month: m, created_at: now }),
    body, objective: opts.objective || null, notes: opts.notes || null, checks: {} as never,
    generated_at: now, generated_by: by, updated_by: by, updated_at: now,
  } as ClientReport))
  return { ok: true, body }
}

/** every client's Instagram audience, kept as this month's — the nightly job (the month's last night is the one kept) */
export async function snapshotAllAudiences(): Promise<{ accounts: number; kept: number }> {
  const m = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' }).slice(0, 7)
  const accounts = await table<{ id: string; client_id: string | null; platform: string; provider_account_id: string | null; active?: boolean | null }>('social_accounts')
    .list({ where: a => a.platform === 'instagram' && a.active !== false && !!a.client_id && !!a.provider_account_id })
  let kept = 0
  for (const a of accounts) if (await snapshotAudience(String(a.provider_account_id), a.client_id, m).catch(() => null)) kept++
  return { accounts: accounts.length, kept }
}
