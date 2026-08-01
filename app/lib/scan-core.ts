/**
 * Pure decision logic for the inbox scanner. No I/O, no SDK, no database —
 * so it can be unit-tested directly, per the convention in CLAUDE.md.
 */

/** The knobs a super admin controls, mirroring the scan_settings row. */
export type ScanSettings = {
  lookback_days: number
  max_messages: number
  min_confidence: number
  duplicate_window_days: number
  rules_only: boolean
  schedule_enabled: boolean
  blocked_domains: string[]
  blocked_senders: string[]
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  lookback_days: 3,
  max_messages: 25,
  min_confidence: 0.6,
  duplicate_window_days: 30,
  rules_only: false,
  schedule_enabled: true,
  blocked_domains: [],
  blocked_senders: [],
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Coerce anything (a database row, a PUT body, undefined) into settings that
 *  are safe to act on. Bad input is clamped to the nearest legal value rather
 *  than rejected, so a malformed row can never stop the scanner running. */
export function normaliseSettings(input: unknown): ScanSettings {
  const r = (input ?? {}) as Record<string, unknown>
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === 'string' ? Number(v) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : fallback
  }
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [])
      .map(s => String(s).trim().toLowerCase())
      .filter(Boolean)

  return {
    lookback_days:         clamp(Math.round(num(r.lookback_days, 3)), 1, 30),
    max_messages:          clamp(Math.round(num(r.max_messages, 25)), 1, 100),
    min_confidence:        clamp(num(r.min_confidence, 0.6), 0, 1),
    duplicate_window_days: clamp(Math.round(num(r.duplicate_window_days, 30)), 0, 365),
    rules_only:            Boolean(r.rules_only),
    schedule_enabled:      r.schedule_enabled === undefined ? true : Boolean(r.schedule_enabled),
    blocked_domains:       list(r.blocked_domains).map(d => d.replace(/^@/, '')),
    blocked_senders:       list(r.blocked_senders),
  }
}

/** The Gmail search this settings object implies. */
export function gmailQuery(s: Pick<ScanSettings, 'lookback_days'>): string {
  return `in:inbox newer_than:${s.lookback_days}d`
}

/** Is this sender blocked outright? Domains match the part after @, including
 *  subdomains, so blocking "example.com" also blocks "mail.example.com". */
export function blockedReason(
  fromEmail: string,
  s: Pick<ScanSettings, 'blocked_domains' | 'blocked_senders'>
): string | null {
  const email = fromEmail.trim().toLowerCase()
  if (!email) return null
  if (s.blocked_senders.includes(email)) return 'sender is on the block list'

  const domain = email.split('@')[1] ?? ''
  if (!domain) return null
  for (const blocked of s.blocked_domains) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) {
      return `sender domain ${blocked} is on the block list`
    }
  }
  return null
}

/** Raised when the problem is with the account or key rather than the message.
 *  Retrying the next email would fail identically, so the scan stops and says
 *  so once, instead of logging the same failure against every message. */
export class FatalScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalScanError'
  }
}

/** Billing, auth and quota failures are account-level: every subsequent call
 *  fails the same way. Anything else (a malformed body, a transient blip) is
 *  per-message and must not abort the run.
 *
 *  Returns an operator-facing explanation, or null when the failure is
 *  per-message and the scan should carry on. */
export function fatalApiReason(e: unknown): string | null {
  const status =
    typeof e === 'object' && e !== null && 'status' in e
      ? Number((e as { status: unknown }).status)
      : undefined
  const raw = e instanceof Error ? e.message : String(e ?? '')

  if (/credit balance is too low|insufficient.*credit/i.test(raw)) {
    return 'The Anthropic account is out of credit, so emails cannot be classified. Top up under Plans & Billing at console.anthropic.com, then scan again. (A Claude Max subscription does not cover API usage.)'
  }
  if (status === 401 || /invalid x-api-key|authentication_error/i.test(raw)) {
    return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.'
  }
  if (status === 403 || /permission_error/i.test(raw)) {
    return 'The Anthropic API key is not permitted to use this model.'
  }
  if (status === 429 || /rate_limit/i.test(raw)) {
    return 'Anthropic rate limit reached. Wait a moment and scan again.'
  }
  return null
}
