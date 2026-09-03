/**
 * Does this connected account actually need a human?
 *
 * The old rule was a fixed fortnight — `needsRefresh || days <= 14` — written
 * for a Meta page token that lives 60 days and dies for good. It is wrong for
 * every platform that issues a SHORT-lived access token against a long-lived
 * refresh token: TikTok's lasts a day, Google's an hour, and both renew
 * themselves without anybody touching anything. Those accounts are one day
 * from expiry the second they are connected and every day after, so the
 * fortnight rule fires on a healthy account, permanently, from the moment it
 * is set up.
 *
 * Two things went wrong when it fired. It told people to press a "Reconnect
 * account" button that a separate, stricter condition had decided not to
 * render — advice pointing at nothing. And it printed the provider's own
 * "Auto-refreshes" and our "posts will quietly fail" in the same sentence,
 * which is not a warning, it is a coin toss.
 *
 * So the provider decides. `valid` and `needsRefresh` are the upstream
 * account's own account of itself, and this never overrules them: a date is
 * only ever allowed to raise a calm note, never to contradict a provider that
 * says the account is fine. The one thing this file guarantees is that
 * `needsReconnect` and the words on screen always agree — if it tells someone
 * to press the button, the button is there.
 */

/** As the provider reports it. Every field is optional: an account health
 *  call that fails collapses to nothing rather than to a false alarm. */
export type TokenStatus = {
  valid?: boolean
  expiresAt?: string | null
  /** free text from the provider, e.g. "Auto-refreshes", "in 58 days" */
  expiresIn?: string | null
  needsRefresh?: boolean
}

export type TokenLevel =
  /** nothing to do */
  | 'ok'
  /** it dies on a date and will not renew itself — reconnect before then */
  | 'watch'
  /** it is dead or the provider says it cannot renew — reconnect now */
  | 'act'

export type TokenNotice = {
  level: TokenLevel
  /** the provider renews this without anybody doing anything */
  autoRenews: boolean
  daysLeft: number | null
  /** does the "Reconnect account" button belong on screen */
  needsReconnect: boolean
  /** the sentence after the expiry date. Never mentions a button unless
   *  `needsReconnect` puts one there. */
  advice: string
}

const DAY = 86400000

/** Inside this many days, a token that will not renew is worth mentioning. */
export const WATCH_DAYS = 14

/**
 * A short window the provider calls healthy describes a refreshing token.
 *
 * Nothing issues a token that dies within a week, reports itself valid, and
 * expects a human to notice. Below this, "healthy" and "expires soon" together
 * mean refresh-token, and the honest reading is the provider's.
 */
const SHORT_WINDOW_DAYS = 7

export function daysUntil(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null
  const at = new Date(expiresAt).getTime()
  if (Number.isNaN(at)) return null
  return Math.ceil((at - now) / DAY)
}

/** Does the provider say, in its own words, that this renews itself? */
export function saysAutoRenews(expiresIn: string | null | undefined): boolean {
  return /auto|renew|refresh/i.test(expiresIn ?? '')
}

/**
 * What to show for one account, or null when there is nothing to say.
 *
 * Missing permissions are deliberately NOT folded in here: that panel has its
 * own wording ("tick every permission the login screen asks for") and its own
 * page. The caller ORs it into the button. What this returns must be true of
 * the token alone.
 */
export function tokenNotice(
  status: TokenStatus | null | undefined,
  now: number,
): TokenNotice | null {
  if (!status) return null
  const s = status
  const daysLeft = daysUntil(s.expiresAt, now)
  const autoRenews = saysAutoRenews(s.expiresIn)
    // the provider reports it healthy on a window no human could be expected
    // to act inside — that is a refresh token, described the long way round
    || (s.valid !== false && s.needsRefresh !== true
        && daysLeft !== null && daysLeft <= SHORT_WINDOW_DAYS)

  if (s.valid === false) {
    return {
      level: 'act', autoRenews, daysLeft, needsReconnect: true,
      advice: 'This account is disconnected. Reconnect it — until you do, posts scheduled for it will not go out.',
    }
  }

  if (s.needsRefresh === true) {
    return {
      level: 'act', autoRenews, daysLeft, needsReconnect: true,
      advice: 'The provider can no longer renew this on its own. Reconnect the account — until you do, posts scheduled for it will not go out.',
    }
  }

  if (autoRenews) {
    return {
      level: 'ok', autoRenews, daysLeft, needsReconnect: false,
      advice: 'It renews itself — there is nothing to do. This date moves on its own.',
    }
  }

  if (daysLeft !== null && daysLeft <= WATCH_DAYS) {
    return {
      level: 'watch', autoRenews, daysLeft, needsReconnect: true,
      advice: 'This one does not renew on its own. Reconnect the account before then to keep posting working.',
    }
  }

  if (daysLeft === null) return null

  // Far out and not self-renewing. True, and worth knowing — but not yet an
  // instruction, because the button that would carry it out is not on screen.
  // This panel turns into one at `WATCH_DAYS`.
  return {
    level: 'ok', autoRenews, daysLeft, needsReconnect: false,
    advice: 'This one does not renew on its own, so it will need doing again nearer the time. Nothing to do yet.',
  }
}

/** The accounts worth putting in front of somebody, worst first.
 *
 *  Only 'act' and 'watch': an account that renews itself has no business in a
 *  list headed "needs reconnecting", which is what put two channels connected
 *  minutes earlier into it. */
export function needsAttention<T>(
  rows: { row: T; status: TokenStatus | null | undefined }[],
  now: number,
): { row: T; notice: TokenNotice }[] {
  const rank: Record<TokenLevel, number> = { act: 0, watch: 1, ok: 2 }
  return rows
    .map(r => ({ row: r.row, notice: tokenNotice(r.status, now) }))
    .filter((r): r is { row: T; notice: TokenNotice } =>
      r.notice !== null && r.notice.level !== 'ok')
    .sort((a, b) =>
      rank[a.notice.level] - rank[b.notice.level]
      || (a.notice.daysLeft ?? -1) - (b.notice.daysLeft ?? -1))
}

/** "1 day left", "expired", "in 58 days" — the same words in both places. */
export function timeLeftWords(daysLeft: number | null): string {
  if (daysLeft === null) return 'no expiry date given'
  if (daysLeft <= 0) return 'expired'
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
}
