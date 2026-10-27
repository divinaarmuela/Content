/**
 * THE MONTHLY CLIENT REPORT — the pure half (the owner, 26 Oct 2026: "we need to build a client reporting page", from
 * the team's "Monthly Client Reports Guide"). One report per client per month, 1st to last day. Every figure comes
 * from the client's own accounts through Zernio (client-report.ts), never typed — the guide's warning that "Claude has
 * previously presented incorrect figures" is answered by never asking a person or the AI for a number. Claude writes
 * the analysis from those figures with the guide's own prompt; the team edits it, adds their own strategy and pillars,
 * ticks the guide's checks, and downloads the PDF.
 *
 * WHO: super admins, and account managers for their own clients. Deleting a saved report is a super admin's only.
 *
 * Pure: months, shaping, the prompt, the rules. No I/O.
 */

export type MonthKey = string // 'YYYY-MM'

export function isMonthKey(v: unknown): v is MonthKey {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

/** first and last day of the month, 'YYYY-MM-DD' */
export function monthRange(m: MonthKey): { from: string; to: string } {
  const [y, mo] = m.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` }
}

export function previousMonth(m: MonthKey): MonthKey {
  const [y, mo] = m.split('-').map(Number)
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
}

export function monthLabel(m: MonthKey): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** the months a report can be made for: the last 12, newest first, ending with the current one */
export function recentMonths(now: Date, n = 12): MonthKey[] {
  const out: MonthKey[] = []
  let y = now.getUTCFullYear(), mo = now.getUTCMonth() + 1
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`)
    mo--; if (mo === 0) { mo = 12; y-- }
  }
  return out
}

/** the report's id: one per client per month */
export const reportId = (clientId: string, m: MonthKey) => `${clientId}_${m}`

/* ── who ─────────────────────────────────────────────────────────────────── */

export function mayOpenReports(role: string | null | undefined): boolean {
  return role === 'super_admin' || role === 'account_manager'
}
export function mayDeleteReport(role: string | null | undefined): boolean {
  return role === 'super_admin'
}

/* ── the figures ─────────────────────────────────────────────────────────── */

export type Breakdown = { label: string; value: number; pct: number }
export type TopPost = {
  id: string
  platform: string
  publishedAt: string | null
  url: string | null
  thumbnail: string | null
  caption: string
  format: string | null
  views: number; reach: number; likes: number; comments: number; shares: number; saves: number
  engagementRate: number | null
  /** Instagram's own per-post signals (27 Oct 2026, the post breakdowns): a reel's length, its average watch time,
   *  the share who skipped it in the first 3 seconds (Meta's estimate), and the follows a feed post brought */
  durationSec?: number | null
  avgWatchMs?: number | null
  skipRate?: number | null
  follows?: number | null
  profileVisits?: number | null
  /** a carousel's slide count, and the first slides' pictures */
  slides?: number | null
  images?: string[]
}
export type PlatformFigures = {
  platform: 'instagram' | 'facebook'
  handle: string | null
  followers: { start: number | null; end: number | null; previousEnd: number | null; gained: number | null }
  views: number | null
  reach: number | null
  interactions: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  profileVisits: number | null
  linkTaps: number | null
  /** % of views from people who follow the account, and from those who don't */
  viewsFromFollowers: number | null
  viewsFromNonFollowers: number | null
  previous: { views: number | null; reach: number | null; interactions: number | null }
  daily: { date: string; views: number; engagement: number; followersGained: number }[]
  topPosts: TopPost[]
  posts: number
}
export type Audience = {
  /** when it was read — Instagram only gives "this month", so a past month shows its month-end snapshot or nothing */
  asOf: string | null
  // NO GENDER (the owner, 26 Oct 2026: "ignore the gender check, remove it, it will not work") — read, shown,
  // printed and sent to the writer nowhere; a month saved before then keeps it in the database, unused
  age: Breakdown[]
  cities: Breakdown[]
  countries: Breakdown[]
  /** WHO ENGAGED THIS MONTH, not just who follows (the owner, 26 Oct 2026) — Instagram's engaged-audience breakdown */
  engaged?: { age: Breakdown[]; cities: Breakdown[]; countries: Breakdown[] } | null
}
export type ReportData = {
  clientId: string
  clientName: string
  industry: string | null
  month: MonthKey
  fetchedAt: string
  platforms: PlatformFigures[]
  audience: Audience | null
  /** what could not be read, in words — shown on the page, never silently empty */
  gaps: string[]
}

/** counts to labelled shares, biggest first, top N */
export function toBreakdown(rows: readonly { dimension?: unknown; value?: unknown }[] | null | undefined, top = 10, rename: (s: string) => string = s => s): Breakdown[] {
  const clean = (rows ?? []).map(r => ({ label: rename(String(r.dimension ?? '')), value: Number(r.value) || 0 })).filter(r => r.label && r.value > 0)
  const total = clean.reduce((n, r) => n + r.value, 0)
  return clean.sort((a, b) => b.value - a.value).slice(0, top).map(r => ({ ...r, pct: total ? Math.round((r.value / total) * 1000) / 10 : 0 }))
}


/** a change in words and a sign: "+12%" / "−8%" / "new" / null when there is nothing to compare */
export function change(now: number | null | undefined, before: number | null | undefined): { text: string; up: boolean } | null {
  if (now == null || before == null) return null
  if (before === 0) return now > 0 ? { text: 'new', up: true } : null
  const pct = Math.round(((now - before) / before) * 100)
  return { text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`, up: pct >= 0 }
}

export function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-AU')
}

/* ── the written report ──────────────────────────────────────────────────── */

export type ReportChecks = Record<string, boolean>
/** the guide's Step 3, one tick each — the PDF is ready when every one is ticked */
export const REVIEW_CHECKS: { key: string; words: string }[] = [
  { key: 'figures', words: 'Every figure matches the data on this page' },
  { key: 'period', words: 'The reporting period is right' },
  { key: 'top', words: 'The top performing content is right' },
  { key: 'brand', words: 'The language suits the client’s brand and industry' },
  { key: 'realistic', words: 'The recommendations are realistic and relevant' },
  { key: 'no_ads', words: 'No advertising commentary (unless the client runs ads)' },
  { key: 'own', words: 'Our own analysis, pillars and next month’s focus are added' },
]

export function allChecked(checks: ReportChecks | null | undefined): boolean {
  return REVIEW_CHECKS.every(c => checks?.[c.key] === true)
}

/**
 * THE GUIDE'S PROMPT, with the figures from the page — not pasted by a person, so nothing is copied wrong. The
 * objective, the team's notes and the shoot concepts already planned (the guide: "add these concepts in the report")
 * are the only free text.
 */
export function reportPrompt(input: {
  data: ReportData
  objective: string
  notes: string
  shootConcepts: string[]
  previousReport: string | null
  /** the month's post breakdowns, as lines (post-breakdown-core.ts breakdownLines) */
  breakdowns?: string[]
}): { system: string; user: string } {
  const { data } = input
  const platforms = data.platforms.map(p => p.platform === 'instagram' ? 'Instagram' : 'Facebook').join(' and ') || 'Instagram'
  const followers = data.platforms.map(p => `${p.platform === 'instagram' ? 'Instagram' : 'Facebook'}: ${fmt(p.followers.end)} (last month ${fmt(p.followers.previousEnd)})`).join('; ')
  const { from, to } = monthRange(data.month)
  const system = [
    'You write monthly social media reports for MD Media, a Melbourne content agency, for its clients.',
    'Every figure you use must come from the JSON analytics provided. Never invent, round differently or estimate a number; if a figure is missing, say it was not available.',
    'Write in plain Australian English. Do not use dashes as punctuation anywhere in the report.',
    'Format the report in Markdown with these sections, in this order: Summary, Key insights, Top performing content, What underperformed, Content themes and formats, Audience, Follower growth, Benchmark comparison, Content gaps, Strategy for next month, Content pillars (with a % split), Content ideas (10 to 20).',
  ].join('\n')
  const user = [
    'Data Analytics prompts, Analyse this social media performance dataset.',
    '',
    'Context:',
    `Client: ${data.clientName}`,
    `Industry: ${data.industry || 'not recorded'}`,
    `Platform: ${platforms}`,
    `Followers: ${followers}`,
    `Time period: ${from} to ${to} (${monthLabel(data.month)})`,
    `Objective: ${input.objective || 'growth and engagement'}`,
    '',
    'I want you to analyse:',
    'Top-performing content and why it worked',
    'Underperforming content and why it failed',
    'Content themes and patterns',
    'Format performance',
    'Audience behaviour',
    'Follower conversion patterns',
    'Benchmark: Compare this account to top creators in the same niche',
    'Highlight the gap vs high-performing accounts',
    '',
    'Output:',
    'Key insights', 'Audience segmentation', 'Content gaps', 'Benchmark comparison', 'Strategy recommendations', 'Content pillars with % split', '10–20 content ideas',
    '',
    'Be direct, opinionated, and avoid generic advice.',
    "Do not include ads in here just social media report, so don't mention budgets for ads, unless it is needed, and strategy wise keep it realistic. Please don't add dashes to the report. Keep in mind we do content month by month not weekly, anything you suggest will be the focus for next month not weekly, a strategy we keep in place for next month. Remember we do content for both Instagram and Facebook and don't suggest doing different content based on each platform. Compare followers from this month to last, the actual final number, so we know. Don't say things like \"Retire static image posts, or rebuild them as short reels\" as clients pay us to do graphics too; these work as fillers and to engage with current followers and build trust, instead give insights on what carousels could work better or different angles.",
    ...(input.shootConcepts.length ? ['', 'Shoot concepts already planned for next month (align the strategy and ideas with these):', ...input.shootConcepts.map(c => `• ${c}`)] : []),
    ...(input.notes.trim() ? ['', 'Notes from the team (take these into account):', input.notes.trim()] : []),
    ...(input.previousReport ? ['', 'Last month’s report for this client, for continuity of structure and to compare against:', input.previousReport.slice(0, 20000)] : []),
    ...(input.breakdowns ?? []),
    '',
    'With the following analytics below:',
    // an older month's audience may still carry a gender split — it is never sent
    JSON.stringify(data, (k, v) => (k === 'gender' ? undefined : v), 1),
  ].join('\n')
  return { system, user }
}

/**
 * THE WRITTEN REPORT AS HTML — a small, safe Markdown: headings, bullet and numbered lists, bold, italics, tables and
 * paragraphs. Everything is escaped first, so nothing the AI or a person wrote can become markup of its own.
 */
export function reportHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  let table: string[][] = []
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null } }
  const flushTable = () => {
    if (!table.length) return
    const [head, ...rows] = table
    out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
    table = []
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList()
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      if (!cells.every(c => /^:?-{2,}:?$/.test(c))) table.push(cells)
      continue
    }
    flushTable()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flushPara(); flushList(); const n = Math.min(4, h[1].length + 1); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue }
    const li = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/)
    if (li) {
      flushPara()
      const kind = li[1] ? 'ol' : 'ul'
      if (list !== kind) { flushList(); out.push(`<${kind}>`); list = kind }
      out.push(`<li>${inline(li[2])}</li>`)
      continue
    }
    if (!line.trim()) { flushPara(); flushList(); continue }
    flushList()
    para.push(line.trim())
  }
  flushPara(); flushList(); flushTable()
  return out.join('\n')
}

/**
 * A SAVED REPORT'S FIGURES, WHOLE. The database keeps no empty list (an empty `gaps`, a platform's empty `topPosts` or
 * `daily` come back missing — live, 26 Oct 2026: Justin's October crashed reading `gaps.length`), so every list is put
 * back before anything reads it.
 */
export function readReportData(raw: unknown): ReportData | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<ReportData>
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : [])
  const a = d.audience as Partial<Audience> | null | undefined
  return {
    clientId: String(d.clientId ?? ''), clientName: String(d.clientName ?? ''), industry: d.industry ?? null,
    month: String(d.month ?? ''), fetchedAt: String(d.fetchedAt ?? ''),
    gaps: list<string>(d.gaps),
    audience: a ? {
      asOf: a.asOf ?? null, age: list(a.age), cities: list(a.cities), countries: list(a.countries),
      engaged: a.engaged ? { age: list(a.engaged.age), cities: list(a.engaged.cities), countries: list(a.engaged.countries) } : null,
    } : null,
    platforms: list<Partial<PlatformFigures>>(d.platforms).map(p => ({
      ...(p as PlatformFigures),
      followers: { start: null, end: null, previousEnd: null, gained: null, ...(p.followers ?? {}) },
      previous: { views: null, reach: null, interactions: null, ...(p.previous ?? {}) },
      daily: list(p.daily),
      topPosts: list(p.topPosts),
      posts: Number(p.posts ?? 0),
    })),
  }
}
