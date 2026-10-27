/**
 * WHY A POST WORKED — UNLK.AI's way, on our own numbers (the owner, 27 Oct 2026: "use the ai from there… do it like
 * unlk for reporting and summaries of the posts"). Ported from UNLK (lib/accounts/index-score.ts,
 * lib/breakdown/evidence.ts, lib/breakdown/build.ts). Pure: no I/O, no model.
 *
 * UNLK reads other people's public posts, so it has to GUESS Instagram's ranking signals. We read our clients' own
 * posts through Zernio, so we have them: watch time, the 3-second skip rate, shares (sends), saves, reach and the
 * follows a post brought. The score is UNLK's exactly; the evidence uses the real signals where UNLK uses stand-ins.
 */
import type { TopPost } from './client-report-core'

/* ── 1. THE PERFORMANCE INDEX: 0 to 100, 50 = the account's typical post (UNLK's formula, unchanged) ──
 *  Baseline: the median likes, comments and (reels with reels) views of the account's posts within 90 days either
 *  side, or its 12 nearest when that window holds fewer; only posts 3+ days old; never the post itself; each at
 *  least 1. Signals: log2(value / baseline), clamped to [-3, +4]. Blend: reels 0.5 views, 0.3 likes, 0.2 comments;
 *  photos and carousels 0.6 likes, 0.4 comments; comments count double inside their term; weights renormalised.
 *  Score: L mapped through the anchors below; multiple = 2^L. A post under 3 days old is pulled towards 50. */

export type PostKind = 'reel' | 'carousel' | 'photo'
export type IndexScore = {
  score: number
  /** the blended ratio against a typical post, one decimal: 2.4 = about 2.4x */
  multiple: number
  parts: { views?: number; likes?: number; comments?: number }
}

const DAY = 86_400_000
const WINDOW_DAYS = 90
const MIN_LOCAL = 12
const MATURE_DAYS = 3
const ANCHORS: [number, number][] = [[-3, 0], [-2, 10], [-1, 25], [0, 50], [1, 75], [2, 90], [3, 99], [4, 100]]
/** below this a post did worse than the account's typical post */
export const UNDERPERFORM_BELOW = 45
/** reels keep gathering views for a fortnight: younger than this is "behind so far", never a flop */
export const EARLY_DAYS = 14

const r1 = (x: number) => Math.round(x * 10) / 10
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const timeOf = (p: Pick<TopPost, 'publishedAt'>) => Date.parse(p.publishedAt ?? '')
export function median(xs: number[]): number {
  const s = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** what the post is, from Zernio's media type */
export function postKind(p: Pick<TopPost, 'format' | 'durationSec'>): PostKind {
  const f = String(p.format ?? '').toLowerCase()
  if (/carousel|album/.test(f)) return 'carousel'
  if (/video|reel/.test(f) || (p.durationSec ?? 0) > 0) return 'reel'
  return 'photo'
}

export function scoreOf(log2Value: number): number {
  const L = clamp(log2Value, -3, 4)
  for (let i = 1; i < ANCHORS.length; i++) {
    const [x1, y1] = ANCHORS[i]
    if (L <= x1) { const [x0, y0] = ANCHORS[i - 1]; return y0 + ((L - x0) / (x1 - x0)) * (y1 - y0) }
  }
  return 100
}

/** every dated post's index against its own account's normal at the time */
export function indexPosts(posts: readonly TopPost[], now = Date.now()): Map<string, IndexScore> {
  const dated = posts.filter(p => Number.isFinite(timeOf(p)))
  const out = new Map<string, IndexScore>()
  for (const p of dated) {
    const t = timeOf(p)
    const pool = dated.filter(o => o.id !== p.id && now - timeOf(o) >= MATURE_DAYS * DAY)
    let near = pool.filter(o => Math.abs(timeOf(o) - t) <= WINDOW_DAYS * DAY)
    if (near.length < MIN_LOCAL) near = [...pool].sort((a, b) => Math.abs(timeOf(a) - t) - Math.abs(timeOf(b) - t)).slice(0, MIN_LOCAL)
    if (!near.length) continue
    const isReel = postKind(p) === 'reel'
    const reelsNear = near.filter(o => postKind(o) === 'reel' && o.views > 0)
    const base = {
      likes: Math.max(1, median(near.map(o => o.likes))),
      comments: Math.max(1, median(near.map(o => o.comments))),
      views: reelsNear.length ? Math.max(1, median(reelsNear.map(o => o.views))) : NaN,
    }
    const sig = (v: number, b: number) => clamp(Math.log2(Math.max(v, 0.5) / b), -3, 4)
    const terms: { key: keyof IndexScore['parts']; w: number; L: number; ratio: number }[] = []
    if (isReel && p.views > 0 && Number.isFinite(base.views)) terms.push({ key: 'views', w: 0.5, L: sig(p.views, base.views), ratio: p.views / base.views })
    terms.push({ key: 'likes', w: isReel ? 0.3 : 0.6, L: sig(p.likes, base.likes), ratio: p.likes / base.likes })
    terms.push({ key: 'comments', w: (isReel ? 0.2 : 0.4) * 2, L: sig(p.comments, base.comments), ratio: p.comments / base.comments })
    const wSum = terms.reduce((n, x) => n + x.w, 0)
    const L = terms.reduce((n, x) => n + (x.w / wSum) * x.L, 0)
    let score = scoreOf(L)
    const age = (now - t) / DAY
    if (age < MATURE_DAYS) score = 50 + (score - 50) * Math.max(0, age) / MATURE_DAYS
    out.set(p.id, {
      score: Math.round(score),
      multiple: r1(2 ** L),
      parts: Object.fromEntries(terms.map(x => [x.key, r1(x.ratio)])),
    })
  }
  return out
}

/* ── 2. WHY IT BROKE OUT, RANKED — computed from numbers, never written by the model ── */

export type Verdict = 'strong' | 'likely' | 'not supported'
export type Factor = {
  key: string; label: string; verdict: Verdict; evidence: string; lift?: number
  /** well under the account's usual — where a post that fell behind fell short */
  below?: boolean
}

const r2 = (x: number) => Math.round(x * 100) / 100
/** a share as a percentage, with enough places that two different small shares never read the same */
const pct = (x: number) => `${x >= 0.1 ? Math.round(x * 100) : x >= 0.01 ? r1(x * 100) : Math.round(x * 10000) / 100}%`
export function lengthBand(p: Pick<TopPost, 'durationSec'>): string | null {
  const d = p.durationSec ?? 0
  if (!(d > 0)) return null
  return d < 15 ? 'under 15 seconds' : d < 30 ? '15 to 30 seconds' : d < 60 ? '30 to 60 seconds' : 'over a minute'
}
/** the share of a reel watched, on average — watch time over length */
export function watchedShare(p: Pick<TopPost, 'avgWatchMs' | 'durationSec'>): number | null {
  return (p.avgWatchMs ?? 0) > 0 && (p.durationSec ?? 0) > 0 ? Math.min(1.5, (p.avgWatchMs! / 1000) / p.durationSec!) : null
}

function featuresOf(p: TopPost): { key: string; label: string }[] {
  const kind = postKind(p)
  const out = [{ key: `kind:${kind}`, label: `${kind}s` }]
  const band = lengthBand(p)
  if (kind === 'reel' && band) out.push({ key: `length:${band}`, label: `reels ${band}` })
  return out
}

/** a lift row: this post's rate against the account's usual. Well under the usual (0.85x or less) is marked `below`:
 *  on a post that fell behind, that is where it fell short (Justin's October, 27 Oct 2026: a reel 32% of whose
 *  viewers stayed past three seconds, against 42% usual, read "not supported" and was hidden — it was the reason) */
function liftRow(key: string, label: string, below: string, mine: number, usual: number, strong: number, likely: number, words: (m: string, u: string, l: number) => string): Factor | null {
  if (!Number.isFinite(mine) || !Number.isFinite(usual) || usual <= 0) return null
  const lift = mine / usual
  const low = lift <= 0.85
  return {
    key, label: low ? below : label, lift: r2(lift), ...(low ? { below: true } : {}),
    verdict: lift >= strong ? 'strong' : lift >= likely ? 'likely' : 'not supported',
    evidence: words(pct(mine), pct(usual), r2(lift)),
  }
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** the ranked reasons for one post — strongest first, then where it fell below the usual, at most nine */
export function evidenceFor(post: TopPost, posts: readonly TopPost[], followers: number | null, index: Map<string, IndexScore>): Factor[] {
  const kind = postKind(post)
  // the same kind of post where there are five to compare with; otherwise every post on the account (an account
  // with three carousels in four months still has a usual for shares or saves)
  const sameKind = posts.filter(o => o.id !== post.id && postKind(o) === kind)
  const usualFor = (f: (o: TopPost) => number | null) => {
    const has = (xs: readonly TopPost[]) => xs.map(f).filter((x): x is number => x != null && Number.isFinite(x))
    const own = has(sameKind)
    if (own.length >= 5) return { usual: median(own), word: kind === 'reel' ? 'reel' : kind === 'carousel' ? 'carousel' : 'photo' }
    const all = has(posts.filter(o => o.id !== post.id))
    return all.length >= 5 ? { usual: median(all), word: 'post' } : null
  }
  const out: (Factor | null)[] = []
  const row = (key: string, label: string, below: string, mine: number, f: (o: TopPost) => number | null, strong: number, likely: number, words: (m: string, u: string, l: number, word: string) => string) => {
    const u = usualFor(f)
    if (u) out.push(liftRow(key, label, below, mine, u.usual, strong, likely, (m, us, l) => words(m, us, l, u.word)))
  }

  // reach beyond the followers
  if (followers && followers > 0 && post.reach > 0) row('reach', 'Reached people beyond the followers', 'Reached fewer people than usual', post.reach / followers,
    o => (o.reach > 0 ? o.reach / followers : null), 2, 1.3, (m, u, l, w) => `Reached ${m} of the follower count, against ${u} on a typical ${w} (${l}x the usual reach).`)
  // the hook: fewer skipped it in the first three seconds (Meta's own estimate) — reels only, compared with reels
  if (kind === 'reel' && (post.skipRate ?? 0) > 0) row('hook', 'The opening held people', 'The opening lost people', 1 - post.skipRate! / 100,
    o => (postKind(o) === 'reel' && (o.skipRate ?? 0) > 0 ? 1 - o.skipRate! / 100 : null), 1.25, 1.08, (m, u, l) => `${m} stayed past the first three seconds, against ${u} on a typical reel (${l}x).`)
  // watch time: how much of the reel people watched
  const ws = watchedShare(post)
  if (kind === 'reel' && ws != null) row('watch', 'People watched more of it', 'People watched less of it', ws,
    o => (postKind(o) === 'reel' ? watchedShare(o) : null), 1.4, 1.12, (m, u, l) => `On average people watched ${m} of it (${r1(post.avgWatchMs! / 1000)}s of ${post.durationSec}s), against ${u} on a typical reel (${l}x).`)
  // sends: shares per account reached — what Instagram weighs most for new viewers
  if (post.reach > 0) row('sends', 'People sent it to others', 'Few people sent it on', post.shares / post.reach,
    o => (o.reach > 0 ? o.shares / o.reach : null), 1.8, 1.25, (m, u, l, w) => `${plural(post.shares, 'share', 'shares')}, ${m} of the accounts it reached, against ${u} on a typical ${w} (${l}x).`)
  // saves per account reached
  if (post.reach > 0) row('saves', 'People saved it to come back to', 'Few people saved it', post.saves / post.reach,
    o => (o.reach > 0 ? o.saves / o.reach : null), 1.8, 1.25, (m, u, l, w) => `${plural(post.saves, 'save', 'saves')}, ${m} of the accounts it reached, against ${u} on a typical ${w} (${l}x).`)
  // likes per account reached
  if (post.reach > 0) row('likes', 'People liked it more than usual', 'People liked it less than usual', post.likes / post.reach,
    o => (o.reach > 0 ? o.likes / o.reach : null), 1.5, 1.15, (m, u, l, w) => `${m} of the accounts it reached liked it, against ${u} on a typical ${w} (${l}x).`)
  // profile visits per account reached — people curious enough to look at the account (feed posts; reels report none)
  if (post.reach > 0 && (post.profileVisits ?? 0) > 0) row('visits', 'It sent people to the profile', 'It sent few people to the profile', post.profileVisits! / post.reach,
    o => (o.reach > 0 && (o.profileVisits ?? 0) > 0 ? o.profileVisits! / o.reach : null), 1.6, 1.2, (m, u, l, w) => `${plural(post.profileVisits!, 'profile visit', 'profile visits')}, ${m} of the accounts it reached, against ${u} on a typical ${w} (${l}x).`)
  // follows the post brought (feed posts; Meta gives none for reels)
  if ((post.follows ?? 0) > 0) out.push({ key: 'follows', label: 'It brought new followers', verdict: post.follows! >= 5 ? 'strong' : 'likely', evidence: `${plural(post.follows!, 'person', 'people')} followed the account from this post.` })

  // what the post is: how posts with each of its features do on this account
  const mult = (o: TopPost) => index.get(o.id)?.multiple ?? NaN
  const others = posts.filter(o => o.id !== post.id && index.has(o.id))
  for (const feat of featuresOf(post)) {
    const withIt = others.filter(o => featuresOf(o).some(g => g.key === feat.key))
    const without = others.filter(o => !withIt.includes(o))
    if (withIt.length < 5 || without.length < 5) continue
    const a = median(withIt.map(mult)), b = median(without.map(mult))
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) continue
    const lift = a / b
    if (lift > 0.85 && lift < 1.1) continue // only what sets posts apart is a reason
    const low = lift <= 0.85
    out.push({ key: feat.key, label: low ? `${feat.label[0].toUpperCase()}${feat.label.slice(1)} do worse on this account` : `It is one of the account's ${feat.label}`, lift: r2(lift),
      ...(low ? { below: true } : {}),
      verdict: lift >= 1.5 && withIt.length >= 8 ? 'strong' : lift >= 1.2 ? 'likely' : 'not supported',
      evidence: `On this account, ${withIt.length} ${feat.label} do ${r1(a)}x a typical post, against ${r1(b)}x for the rest (${r2(lift)}x).` })
  }

  const rank = (f: Factor) => (f.below ? 3 : f.verdict === 'strong' ? 0 : f.verdict === 'likely' ? 1 : 2)
  return out.filter((x): x is Factor => !!x)
    .sort((x, y) => rank(x) - rank(y) || (x.below ? (x.lift ?? 0) - (y.lift ?? 0) : (y.lift ?? 0) - (x.lift ?? 0)))
    .slice(0, 9)
}

/* ── 3. THE POSTS TO COMPARE WITH: up to five hits and five flops of the same kind ── */

export function pickComparison(posts: readonly TopPost[], id: string, index: Map<string, IndexScore>, n = 5): { hits: TopPost[]; flops: TopPost[] } {
  const self = posts.find(p => p.id === id)
  const kind = self ? postKind(self) : null
  const pool = posts.filter(p => p.id !== id && index.has(p.id) && (!kind || postKind(p) === kind))
  const s = (p: TopPost) => index.get(p.id)!
  const sorted = [...pool].sort((a, b) => s(b).score - s(a).score || s(b).multiple - s(a).multiple)
  const size = Math.min(Math.floor(sorted.length / 2), Math.max(10, Math.ceil(sorted.length / 4)))
  // a hit is above the account's normal and a flop below it — on a thin account the top three can include a 25
  // (Justin's reels, 27 Oct 2026), and calling that a hit would teach the wrong lesson
  return {
    hits: sorted.slice(0, size).filter(p => s(p).score >= 50).slice(0, n),
    flops: sorted.slice(sorted.length - size).reverse().filter(p => s(p).score < 50).slice(0, n),
  }
}

/** which posts of the month get a breakdown: the five best by score, and up to three that fell behind */
export function postsToExplain(monthPosts: readonly TopPost[], index: Map<string, IndexScore>): { post: TopPost; mode: BreakdownMode }[] {
  const scored = monthPosts.filter(p => index.has(p.id)).sort((a, b) => index.get(b.id)!.score - index.get(a.id)!.score)
  const best = scored.slice(0, 5).map(post => ({ post, mode: modeOf(post, index.get(post.id)!) }))
  const worst = scored.slice(5).reverse().filter(p => index.get(p.id)!.score < UNDERPERFORM_BELOW).slice(0, 3)
    .map(post => ({ post, mode: modeOf(post, index.get(post.id)!) }))
  return [...best, ...worst]
}

/* ── 4. THE MODEL'S QUESTION ── */

export type BreakdownMode = 'work' | 'underperform' | 'early'
export function modeOf(p: TopPost, s: IndexScore, now = Date.now()): BreakdownMode {
  if (s.score >= UNDERPERFORM_BELOW) return 'work'
  return (now - timeOf(p)) / DAY < EARLY_DAYS ? 'early' : 'underperform'
}

/** what the model answers — a tool's input, so it comes back as one object */
export const BREAKDOWN_TOOL = {
  name: 'post_breakdown',
  description: 'Why one Instagram post did well or badly, and what the account should do next.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', description: 'One sentence, plain words, naming the moment or number that decided it.' },
      firstLook: { type: 'string', description: 'What the eye lands on first in the picture: the image, the words on it, the product. One or two sentences.' },
      whatWorked: { type: 'array', items: { type: 'string' }, description: '3 to 5 points, each tied to a number from the evidence. When it underperformed: what held it back.' },
      vsFlops: {
        type: 'array',
        items: { type: 'object', properties: { point: { type: 'string' }, hits: { type: 'string' }, flops: { type: 'string' } }, required: ['point', 'hits', 'flops'] },
        description: '2 to 4 contrasts between the HITS and the FLOPS, each citing the posts it draws on by their code in square brackets, e.g. [P3].',
      },
      tryThis: { type: 'array', items: { type: 'string' }, description: '3 to 5 ideas for next month, each ready to shoot.' },
    },
    required: ['verdict', 'firstLook', 'whatWorked', 'vsFlops', 'tryThis'],
  },
}

export const BREAKDOWN_SYSTEM = `You explain to a marketing agency's team why one of their client's Instagram posts did well or badly, and what the account's strongest posts do differently from its weakest. Answer only by calling the post_breakdown tool.
Rules:
- Only claim what the evidence shows. Never invent a moment, a quote, a number, a product or a scene. You see the post's picture (a reel's cover only), its caption and its numbers; you did not watch a reel, so never describe what happens in it after the cover.
- When an EVIDENCE list is given, the verdict names its strongest row or rows in plain words; never claim a cause the list marks "not supported". Rows marked "below usual" are where the post fell short of the account's normal: when the question is why it underperformed, build the verdict on those.
- verdict: one sentence naming the number that decided it, e.g. "Worked because 72% stayed past the first three seconds and people sent it on at twice the usual rate".
- firstLook: what the eye lands on first in the picture, in the order a viewer would notice it.
- whatWorked: 3 to 5 points, each tied to a number from the evidence. When the question is why it underperformed, these are what held it back, in the same form.
- vsFlops: 2 to 4 contrasts between the HITS and the FLOPS, each citing the posts it draws on by their code in square brackets, e.g. [P3]. Only compare what their numbers and captions show; if there are no hits or no flops, give fewer contrasts and say what is missing.
- tryThis: 3 to 5 ideas for next month's content, each ready to shoot, built on what this post and the account's own hits did, never generic advice. Each is a short paragraph: the idea in one sentence; then "Open with:" a first line or first shot written out in quotes, in the client's own voice; then "Show:" the key shot; then "Why:" the number or pattern from this account it borrows. Under 60 words each.
- The agency makes graphics for its clients too: never advise dropping static posts or carousels; say what angle or carousel would work better instead.
- No advertising or ad budgets. Content is planned month by month, for Instagram and Facebook alike.
- Never write a post's code on its own outside vsFlops; elsewhere name posts by date and subject.
- Plain Australian English, short sentences, no jargon ("retention curve", "pattern interrupt", "engagement velocity", "scroll-stopping"), no emoji, and no dashes as punctuation.`

const nf = (n: number) => Math.round(n).toLocaleString('en-AU')
const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

function numbersLine(p: TopPost, s: IndexScore | undefined): string {
  const bits = [
    s ? `score ${s.score} of 100 (${s.multiple}x a typical post)` : null,
    `${nf(p.views)} views`, `${nf(p.reach)} reached`, plural(p.likes, 'like', 'likes'), plural(p.comments, 'comment', 'comments'),
    plural(p.shares, 'share', 'shares'), plural(p.saves, 'save', 'saves'),
    (p.follows ?? 0) > 0 ? plural(p.follows!, 'follow', 'follows') : null,
    (p.profileVisits ?? 0) > 0 ? plural(p.profileVisits!, 'profile visit', 'profile visits') : null,
    (p.slides ?? 0) > 1 ? `${p.slides} slides` : null,
    (p.durationSec ?? 0) > 0 ? `${p.durationSec}s long` : null,
    watchedShare(p) != null ? `watched ${pct(watchedShare(p)!)} on average` : null,
    (p.skipRate ?? 0) > 0 ? `${r1(p.skipRate!)}% skipped in the first 3 seconds` : null,
  ]
  return bits.filter(Boolean).join(', ')
}

/** the short codes the model cites ([P1], [P2]…), and which post each one is */
export function codesFor(posts: readonly TopPost[]): Map<string, string> {
  return new Map(posts.map((p, i) => [p.id, `P${i + 1}`]))
}

export function buildBreakdownPrompt(input: {
  post: TopPost; mode: BreakdownMode; account: string; followers: number | null
  index: Map<string, IndexScore>; hits: TopPost[]; flops: TopPost[]; factors: Factor[]; codes: Map<string, string>
}): string {
  const { post: p, index, codes } = input
  const kind = postKind(p)
  const kindWord = kind === 'reel' ? 'reels' : kind === 'carousel' ? 'carousels' : 'photos'
  const date = (q: TopPost) => (q.publishedAt ?? '').slice(0, 10)
  const question = input.mode === 'early'
    ? 'How is this post doing so far? It went out under two weeks ago and is still gathering views, so its numbers are not final. Say how its start compares with the account\'s usual and what could still lift it; never call it a failure.'
    : input.mode === 'underperform' ? 'Why did this post underperform? It did below the account\'s typical post: explain the gap.'
    : 'Why did this post work?'
  const line = (q: TopPost) => `- [${codes.get(q.id)}] ${date(q)}, ${numbersLine(q, index.get(q.id))}. Caption: ${clip(q.caption, 160) || '(none)'}`
  return [
    `QUESTION: ${question}`,
    `ACCOUNT: ${input.account}${input.followers ? `, ${nf(input.followers)} followers` : ''}`,
    `THIS POST [${codes.get(p.id)}]: ${kind}, posted ${date(p)}`,
    `NUMBERS: ${numbersLine(p, index.get(p.id))}`,
    `CAPTION: ${clip(p.caption, 600) || '(none)'}`,
    kind === 'reel' ? 'PICTURES: the reel\'s cover only.' : kind === 'carousel' ? 'PICTURES: the carousel\'s first slides, in order.' : 'PICTURES: the post as published.',
    '',
    `HITS (the account's strongest ${kindWord}, highest first):`,
    input.hits.map(line).join('\n') || '- none',
    '',
    `FLOPS (the account's weakest ${kindWord}, lowest first):`,
    input.flops.map(line).join('\n') || '- none',
    ...(input.factors.length
      ? ['', 'EVIDENCE (computed from the account\'s own posts; build the verdict on the strong rows and never contradict these numbers):',
        ...input.factors.map(f => `- [${f.below ? 'below usual' : f.verdict}] ${f.label}: ${f.evidence}`)]
      : []),
  ].join('\n')
}

/* ── 5. WHAT IS KEPT ── */

export type PostBreakdown = {
  verdict: string
  firstLook: string
  whatWorked: string[]
  vsFlops: { point: string; hits: string; flops: string; hitIds: string[]; flopIds: string[] }[]
  tryThis: string[]
}
export type ExplainedPost = {
  postId: string
  mode: BreakdownMode
  index: IndexScore
  factors: Factor[]
  /** null when the model could not be asked or did not answer — the numbers above still stand */
  breakdown: PostBreakdown | null
  error?: string
}
export type PostsExplained = {
  at: string
  model: string
  items: ExplainedPost[]
  /** the posts the breakdowns name — the explained ones and every hit and flop they cite */
  posts: TopPost[]
}

/** a saved set read back whole: the database drops empty lists, so every list is put back (as readReportData does) */
export function readPostsExplained(raw: unknown): PostsExplained | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : v && typeof v === 'object' ? Object.values(v) as T[] : [])
  const items = list<Record<string, unknown>>(r.items).filter(i => i && typeof i.postId === 'string' && i.index && typeof i.index === 'object').map(i => {
    const b = i.breakdown && typeof i.breakdown === 'object' ? i.breakdown as Record<string, unknown> : null
    return {
      postId: String(i.postId),
      mode: (['work', 'underperform', 'early'] as const).find(x => x === i.mode) ?? 'work',
      index: { ...(i.index as IndexScore), parts: ((i.index as IndexScore).parts ?? {}) },
      factors: list<Factor>(i.factors),
      breakdown: b ? {
        verdict: String(b.verdict ?? ''),
        firstLook: String(b.firstLook ?? ''),
        whatWorked: list<string>(b.whatWorked),
        vsFlops: list<Record<string, unknown>>(b.vsFlops).map(c => ({ point: String(c.point ?? ''), hits: String(c.hits ?? ''), flops: String(c.flops ?? ''), hitIds: list<string>(c.hitIds), flopIds: list<string>(c.flopIds) })),
        tryThis: list<string>(b.tryThis),
      } : null,
      ...(typeof i.error === 'string' ? { error: i.error } : {}),
    } satisfies ExplainedPost
  })
  return { at: String(r.at ?? ''), model: String(r.model ?? ''), items, posts: list<TopPost>(r.posts) }
}

const strs = (v: unknown, max: number) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, max).map(s => s.trim().slice(0, 1200))

/** the model's answer made safe to keep: lists trimmed, every [P#] a contrast cites turned back into post ids */
export function tidyBreakdown(raw: unknown, codes: Map<string, string>): PostBreakdown | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const verdict = typeof r.verdict === 'string' ? r.verdict.trim().slice(0, 600) : ''
  if (!verdict) return null
  const byCode = new Map([...codes].map(([id, code]) => [code, id]))
  const cited = (s: string) => [...s.matchAll(/\[(P\d+)\]/g)].map(m => byCode.get(m[1])).filter((x): x is string => !!x)
  return {
    verdict,
    firstLook: typeof r.firstLook === 'string' ? r.firstLook.trim().slice(0, 600) : '',
    whatWorked: strs(r.whatWorked, 5),
    vsFlops: (Array.isArray(r.vsFlops) ? r.vsFlops : []).slice(0, 4).map(x => {
      const c = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      const point = String(c.point ?? '').trim().slice(0, 400), hits = String(c.hits ?? '').trim().slice(0, 600), flops = String(c.flops ?? '').trim().slice(0, 600)
      return { point, hits, flops, hitIds: cited(hits), flopIds: cited(flops) }
    }).filter(c => c.point),
    tryThis: strs(r.tryThis, 5),
  }
}

/** the breakdowns, as lines the monthly report's writer reads */
export function breakdownLines(items: readonly ExplainedPost[], posts: readonly TopPost[]): string[] {
  const got = items.filter(i => i.breakdown)
  if (!got.length) return []
  const byId = new Map(posts.map(p => [p.id, p]))
  return ['', 'POST BREAKDOWNS (worked out from this account\'s own numbers; use them for the top and underperforming content sections and do not contradict them):',
    ...got.flatMap(i => {
      const p = byId.get(i.postId)
      return [
        `- ${p ? `${(p.publishedAt ?? '').slice(0, 10)} ${postKind(p)}, "${clip(p.caption, 80)}"` : i.postId}: score ${i.index.score} (${i.index.multiple}x typical). ${i.breakdown!.verdict}`,
        ...i.breakdown!.whatWorked.slice(0, 3).map(w => `    ${w}`),
      ]
    })]
}
