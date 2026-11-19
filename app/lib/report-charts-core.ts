import type { CandidatePost } from './client-report-core'

/**
 * THE REPORT'S CHARTS — the numbers behind them (the owner, 19 Nov 2026: "add beautifully designed charts"). Pure: what
 * each chart draws is worked out here from the page's own figures, so it can be tested without drawing anything.
 */

/** the chart colours: the report's blue first, then three more that stay apart for colour-blind readers (checked with
 *  the dataviz validator, 19 Nov 2026: every check passes on white; the two lighter ones always carry a written label) */
export const CHART_COLOURS = ['#1E81FD', '#eb6834', '#1baf7a', '#eda100'] as const
/** last month, beside this month: a quiet grey, so the eye goes to this month */
export const CHART_PREVIOUS = '#B9C0CC'

/** a post's medium in the team's words */
export function formatLabel(f: string | null | undefined): string {
  switch ((f ?? '').toLowerCase()) {
    case 'story': return 'Stories'
    case 'video': case 'reel': case 'reels': return 'Reels'
    case 'carousel': case 'carousel_album': case 'album': return 'Carousels'
    case 'image': case 'photo': return 'Images'
    default: return 'Other posts'
  }
}

export type Part = { label: string; value: number; pct: number }

/** a whole split into its parts, largest first, each with its share; nothing to split = no parts */
export function shares(rows: readonly { label: string; value: number }[], keep = 4): Part[] {
  const live = rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value)
  // a fifth kind and beyond fold into the last one shown, so the colours never run out
  const shown = live.length > keep ? [...live.slice(0, keep - 1), { label: 'Other posts', value: live.slice(keep - 1).reduce((n, r) => n + r.value, 0) }] : live
  const total = shown.reduce((n, r) => n + r.value, 0)
  if (!total) return []
  return shown.map(r => ({ ...r, pct: Math.round((r.value / total) * 1000) / 10 }))
}

/** the views this month's posts on one account have had, by kind of post (a platform that gives reach, not views, is read by reach) */
export function viewsByType(posts: readonly CandidatePost[], platform: string): Part[] {
  const by = new Map<string, number>()
  for (const p of posts) {
    if (p.platform !== platform) continue
    const k = formatLabel(p.format)
    by.set(k, (by.get(k) ?? 0) + (p.views || p.reach || 0))
  }
  return shares([...by].map(([label, value]) => ({ label, value })))
}

/** a round number at or above the largest value, for the top of an axis (4,210 → 5,000) */
export function niceMax(n: number): number {
  if (!(n > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(n))
  for (const step of [1, 2, 2.5, 5, 10]) if (n <= step * mag) return step * mag
  return 10 * mag
}

/** 12,400 → "12.4k" — an axis has no room for the full figure */
export function short(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${Math.round(n / 100_000) / 10}m`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 100) / 10}k`
  return String(Math.round(n))
}
