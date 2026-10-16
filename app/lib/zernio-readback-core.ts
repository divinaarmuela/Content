/**
 * READ BACK WHAT ZERNIO DID — pure rules (the rebuild spec §7; the owner, 16 Oct 2026: Zernio is the truth for what
 * went out). No I/O: publish.ts asks Zernio, these decide what its answer means.
 *
 * WHY. Jordan "3" was booked on 30 Sep for 12 Oct; Zernio posted it at 01:31 on both networks. The dispatcher could
 * not reach the app from 6 to 15 Oct (the domain outage: every run "Unable to reach SDK URL"). When it could again,
 * the job had left the old window — 14 days from the job's CREATED time — so it would never be looked at, and the
 * client's portal kept asking them to review a post that was already live. The window now follows the POSTING time.
 */

export const READBACK_BEFORE_MS = 24 * 3600_000
export const READBACK_AFTER_MS = 14 * 24 * 3600_000

const OPEN = ['scheduled', 'queued', 'publishing', 'published']

export type ReadbackJob = { id: string; status: string; created_at: string; scheduled_for?: string | null; provider_post_id?: unknown }

/** the jobs to ask Zernio about now: those it holds, from a day before their posting time until 14 days after — all of them, oldest first */
export function readbackCandidates<T extends ReadbackJob>(jobs: readonly T[], nowMs: number): T[] {
  const at = (j: T) => { const t = Date.parse(String(j.scheduled_for ?? '')); return Number.isFinite(t) ? t : Date.parse(j.created_at) }
  return jobs
    .filter(j => OPEN.includes(j.status) && j.provider_post_id != null && String(j.provider_post_id) !== '')
    .filter(j => { const t = at(j); return Number.isFinite(t) && t - READBACK_BEFORE_MS <= nowMs && nowMs <= t + READBACK_AFTER_MS })
    .sort((a, b) => at(a) - at(b))
}

export type ReadbackVerdict = { kind: 'posted' | 'waiting' | 'partial' | 'failed' | 'not_found' | 'gone' | 'unknown' }

const LIVE = ['published', 'posted', 'success']
const GONE = ['deleted', 'cancelled', 'canceled', 'removed']

type PlatformRow = { platform?: unknown; name?: unknown; status?: unknown; error?: unknown }
const still = (p: PlatformRow) => /process/i.test(String(p.error ?? ''))

/**
 * What Zernio's answer for one post means for a job sent to `targets` (platform names). Live needs a publish time or
 * a live platform, AND every targeted network live; a refused network (other than TikTok still processing) is partial.
 */
export function readbackVerdict(remote: unknown, targets: readonly string[]): ReadbackVerdict {
  if (!remote || typeof remote !== 'object') return { kind: 'unknown' }
  const r = remote as { status?: unknown; publishedAt?: unknown; platforms?: PlatformRow[]; platformAnalytics?: PlatformRow[]; type?: unknown; code?: unknown }
  if (r.type === 'not_found' || r.code === 'post_not_found') return { kind: 'not_found' }
  const status = String(r.status ?? '').toLowerCase()
  if (GONE.includes(status)) return { kind: 'gone' }
  const platforms = (Array.isArray(r.platforms) ? r.platforms : Array.isArray(r.platformAnalytics) ? r.platformAnalytics : []) as PlatformRow[]
  const pStatus = (p: PlatformRow) => String(p.status ?? '').toLowerCase()
  const failed = platforms.filter(p => pStatus(p) === 'failed' && !still(p))
  const liveNames = new Set(platforms.filter(p => LIVE.includes(pStatus(p))).map(p => String(p.platform ?? p.name ?? '').toLowerCase()))
  if (status === 'failed' && liveNames.size === 0) return { kind: 'failed' }
  if (failed.length > 0) return liveNames.size > 0 ? { kind: 'partial' } : { kind: 'failed' }
  if (status === 'partial') return { kind: 'partial' }
  const live = LIVE.includes(status) && (Boolean(r.publishedAt) || liveNames.size > 0)
  if (!live) return { kind: 'waiting' }
  const want = targets.map(t => t.toLowerCase())
  return want.every(t => liveNames.has(t)) || (want.length === 0) ? { kind: 'posted' } : { kind: 'waiting' }
}

/** the misses counted against one post; kept on the job (`readback_misses`) */
export type NotFoundState = { misses: string[] }
export const MISS_GAP_MS = 30 * 60_000
export const MISSES_TO_REMOVE = 3

/**
 * ONE MISSING ANSWER NEVER REMOVES A POST. A not-found is counted only while Zernio is answering other posts
 * normally (an outage must not cancel real posts), and only once per half hour; the first flags the post for the
 * team, the third removes it as "Removed in Zernio" (which a manager can restore).
 */
export function notFoundStep(state: NotFoundState, nowMs: number, ctx: { zernioHealthy: boolean }): NotFoundState & { action: 'none' | 'flag' | 'remove' } {
  const misses = [...(state.misses ?? [])]
  if (!ctx.zernioHealthy) return { misses, action: 'none' }
  const last = misses.length ? Date.parse(misses[misses.length - 1]) : NaN
  if (!Number.isFinite(last) || nowMs - last >= MISS_GAP_MS) misses.push(new Date(nowMs).toISOString())
  return { misses, action: misses.length >= MISSES_TO_REMOVE ? 'remove' : 'flag' }
}
