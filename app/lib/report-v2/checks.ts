/**
 * REPORT V2 — AUTOMATIC CHECKS (plan step 5, 5 Nov 2026). Run on every read. A 'fail' is listed in red as "Needs
 * checking" and blocks sharing; a 'warn' is shown but does not block. Pure.
 */
import { platformLabel } from '../client-report-core'
import { accountGives, hasValue, postGives, POST_STATS } from './definitions'
import { MONTH_METRICS, type CheckResult, type V2Platform, type V2Report } from './types'

export function runChecks(platforms: readonly V2Platform[], gaps: readonly string[], previous: Pick<V2Report, 'platforms'> | null = null): CheckResult[] {
  const out: CheckResult[] = []
  const push = (key: string, platform: string | null, ok: boolean, words: string, level: 'fail' | 'warn' = 'fail') => out.push({ key, platform, ok, level, words })
  for (const p of platforms) {
    const L = platformLabel(p.platform)
    const f = p.followers
    // followers gained = end − start (daily count) / = follows − unfollows (Instagram's own)
    if (f.follows != null && f.unfollows != null && hasValue(f.gained)) {
      push('followers_math', p.platform, f.follows - f.unfollows === f.gained.value, `${L}: followers gained ${f.gained.value} = ${f.follows} follows − ${f.unfollows} unfollows`)
    } else if (hasValue(f.dailyGained) && f.start != null && f.end != null) {
      push('followers_math', p.platform, f.end - f.start === f.dailyGained.value, `${L}: followers gained ${f.dailyGained.value} = ${f.end} − ${f.start}`)
    }
    if (f.follows != null && hasValue(f.dailyGained) && hasValue(f.gained) && Math.abs(f.gained.value - f.dailyGained.value) > Math.max(3, Math.abs(f.gained.value) * 0.2)) {
      push('followers_sources', p.platform, false, `${L}: Instagram's own net (${f.gained.value}) and Zernio's daily count (${f.dailyGained.value}) disagree`, 'warn')
    }
    // last month = that month's own report
    const before = previous?.platforms.find(x => x.platform === p.platform && x.accountId === p.accountId)
    if (before) {
      if (hasValue(before.followers.gained) && hasValue(f.previousGained)) {
        push('prev_followers', p.platform, before.followers.gained.value === f.previousGained.value, `${L}: last month's follower gain (${f.previousGained.value}) = last month's own report (${before.followers.gained.value})`)
      }
      for (const k of ['views', 'reach', 'interactions'] as const) {
        const mine = p.previous[k], theirs = before.figures[k]
        if (hasValue(mine) && hasValue(theirs)) push(`prev_${k}`, p.platform, mine.value === theirs.value, `${L}: last month's ${k} (${mine.value}) = last month's own report (${theirs.value})`)
      }
    }
    // IG interaction parts ≤ total
    if (p.platform === 'instagram' && hasValue(p.figures.interactions)) {
      const parts = (['likes', 'comments', 'shares', 'saves'] as const).reduce((n, k) => n + (hasValue(p.figures[k]) ? p.figures[k].value! : 0), 0)
      push('ig_parts', p.platform, parts <= p.figures.interactions.value, `${L}: likes + comments + shares + saves (${parts}) ≤ interactions (${p.figures.interactions.value})`)
    }
    // month totals vs the month's posts — a flag, not a fail (old posts count in the month too)
    const postViews = p.posts.reduce((n, x) => n + (hasValue(x.stats.views) ? x.stats.views.value : 0), 0)
    if (p.countedAs === 'month' && hasValue(p.figures.views) && p.figures.views.value > 0 && postViews > p.figures.views.value * 5) {
      push('ratio', p.platform, false, `${L}: the month's posts have ${postViews} views, over 5× the month's ${p.figures.views.value}`, 'warn')
    }
    if (p.countedAs === 'month' && hasValue(p.figures.views) && p.figures.views.value === 0 && postViews > 0) {
      push('zero_month', p.platform, false, `${L}: the month reads 0 views while its posts have ${postViews}`)
    }
    // no number where the definition list says the platform does not give it
    for (const k of MONTH_METRICS) if (p.figures[k].state === 'value' && !accountGives(p.platform, k)) push('not_given', p.platform, false, `${L}: ${k} is shown but ${L} does not give it`)
    // one line per kind of post and number, with how many posts had it
    const extra = new Map<string, number>()
    for (const x of p.posts) for (const s of POST_STATS) {
      if (x.stats[s].state === 'value' && !postGives(p.platform, x.kind).includes(s)) extra.set(`${x.kind}|${s}`, (extra.get(`${x.kind}|${s}`) ?? 0) + 1)
    }
    for (const [k, count] of extra) {
      const [kind, s] = k.split('|')
      push('post_unexpected', p.platform, false, `${L}: ${count} ${kind} post${count === 1 ? '' : 's'} came back with ${s}, which the definition list says ${L} does not give for a ${kind} — check the list`, 'warn')
    }
    // every figure read
    const bad = [...MONTH_METRICS.filter(k => p.figures[k].state === 'unreadable'), ...(['views', 'reach', 'interactions'] as const).filter(k => p.previous[k].state === 'unreadable').map(k => `last month's ${k}`), ...(f.gained.state === 'unreadable' ? ['followers'] : [])]
    push('read', p.platform, !bad.length, bad.length ? `${L}: could not read ${bad.join(', ')}` : `${L}: every figure read`)
  }
  if (gaps.length) push('gaps', null, false, `Not everything was read: ${gaps.join('; ')}`)
  // de-duplicate repeated warnings (one per platform+key+words)
  const seen = new Set<string>()
  return out.filter(c => { const k = `${c.platform}|${c.key}|${c.words}`; if (seen.has(k)) return false; seen.add(k); return true })
}

/** why the report may not be shared yet, in words (empty = it may) */
export function shareBlockers(checks: readonly CheckResult[]): string[] {
  return checks.filter(c => !c.ok && c.level === 'fail').map(c => c.words)
}
