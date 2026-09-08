/**
 * IS THIS ACCOUNT STILL CONNECTED? — the pure half.
 *
 * The owner, 9 Sep 2026: "if an account is disconnected or needs connection
 * send a notification to the scheduler … they can do it in the icons there
 * to connect, like how Social channels does it."
 *
 * The provider's `GET /accounts/health` answers per account (read on 9 Sep
 * 2026 against the live workspace):
 *
 *   { accountId, platform, username, status: 'healthy' | 'warning' | 'error',
 *     canPost, tokenValid, tokenExpiresAt, needsReconnect, issues: string[] }
 *
 * This turns one such row into the three words the app uses — ok / watch /
 * act — and the sentence that goes with them, and keeps that on the
 * account's own row (`social_accounts.health`) so the Schedule page's icons
 * read it live without asking the provider on every render.
 */

export type ProviderHealth = {
  accountId?: unknown
  platform?: unknown
  username?: unknown
  status?: unknown
  canPost?: unknown
  tokenValid?: unknown
  tokenExpiresAt?: unknown
  needsReconnect?: unknown
  issues?: unknown
}

export type HealthLevel = 'ok' | 'watch' | 'act'

export type StoredHealth = {
  level: HealthLevel
  /** one plain sentence — what is wrong, or "Connected" */
  reason: string
  can_post: boolean
  expires_at: string | null
  checked_at: string
}

const DAY = 86_400_000
/** a token that dies inside this many days is worth a word */
export const WATCH_DAYS = 7

export function daysLeft(expiresAt: string | null, now: number): number | null {
  if (!expiresAt) return null
  const t = Date.parse(expiresAt)
  if (!Number.isFinite(t)) return null
  return Math.ceil((t - now) / DAY)
}

/** the provider's row → what the app keeps and says */
export function healthVerdict(row: ProviderHealth, now: number): StoredHealth {
  const checked_at = new Date(now).toISOString()
  const expires_at = typeof row.tokenExpiresAt === 'string' ? row.tokenExpiresAt : null
  const status = String(row.status ?? '').toLowerCase()
  const issues = Array.isArray(row.issues) ? row.issues.map(String).filter(Boolean) : []
  const canPost = row.canPost !== false
  const left = daysLeft(expires_at, now)

  if (row.needsReconnect === true || row.tokenValid === false || status === 'error' || !canPost) {
    return {
      level: 'act', can_post: false, expires_at, checked_at,
      reason: issues[0] ?? (row.tokenValid === false ? 'Its connection has expired — posts will not go out until it is reconnected.' : 'It needs reconnecting — posts will not go out until it is.'),
    }
  }
  if (left !== null && left <= 0) {
    return { level: 'act', can_post: false, expires_at, checked_at, reason: 'Its connection has expired — reconnect it before the next post.' }
  }
  if (status === 'warning' || (left !== null && left <= WATCH_DAYS)) {
    return {
      level: 'watch', can_post: true, expires_at, checked_at,
      reason: issues[0] ?? (left !== null ? `Its connection runs out in ${left} ${left === 1 ? 'day' : 'days'} — reconnect it before then.` : 'The posting service flagged it — worth a look.'),
    }
  }
  return { level: 'ok', can_post: true, expires_at, checked_at, reason: 'Connected' }
}

export function readStoredHealth(v: unknown): StoredHealth | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<StoredHealth>
  if (o.level !== 'ok' && o.level !== 'watch' && o.level !== 'act') return null
  return {
    level: o.level,
    reason: String(o.reason ?? ''),
    can_post: o.can_post !== false,
    expires_at: typeof o.expires_at === 'string' ? o.expires_at : null,
    checked_at: String(o.checked_at ?? ''),
  }
}

/** does a Reconnect press belong on this account */
export function needsReconnect(h: StoredHealth | null | undefined): boolean {
  return h?.level === 'act'
}

/** the subject line of the note to the team */
export function reconnectSubject(account: { username?: string | null; name?: string | null; platform: string }, clientName: string | null): string {
  const who = account.username || account.name || account.platform
  return `Reconnect ${who} (${account.platform})${clientName ? ` — ${clientName}` : ''}`
}

/** who in the summary needs a word: the accounts at "act", then at "watch" */
export function accountsNeedingWord<T extends { health: StoredHealth | null }>(rows: readonly T[]): { act: T[]; watch: T[] } {
  return {
    act: rows.filter(r => r.health?.level === 'act'),
    watch: rows.filter(r => r.health?.level === 'watch'),
  }
}
