/**
 * HOW MANY POSTS TODAY IS LEFT, IN WORDS.
 *
 * Instagram allows a fixed number of posts per account per rolling 24 hours,
 * every kind counted, and TikTok answers the same question with a yes or a
 * no. Both are facts only the network can give us, and both are the reason a
 * perfectly good post fails hours after everybody has gone home: the caption
 * is fine, the video is fine, the account has simply run out of day.
 *
 * TWO RULES THIS FILE KEEPS:
 *
 *  1. THE NUMBER IS NEVER OURS. Instagram's documented cap and its live cap
 *     disagree, and the live one is the one that refuses the post, so the
 *     total is whatever the network just said. Nothing here hardcodes 100.
 *  2. A FULL DAY IS A REFUSAL, NOT A WARNING. When there is nothing left the
 *     window stops the post rather than sending it to fail, and says when it
 *     can go instead.
 *
 * Pure: no I/O, no clock. The caller hands in what the provider answered and,
 * where it knows one, the moment the window rolls already written in the
 * client's own time zone.
 */

import { networkName } from './publish-core'

/** What one account has used of its day, as the provider reports it. */
export type PostingQuota = { used: number; total: number }

/**
 * Read Instagram's publishing-limit answer.
 *
 * `GET /v1/accounts/{id}/instagram/publishing-limit` →
 * `{ quotaUsage, quotaTotal, quotaDurationSeconds }`. Anything that is not
 * two real numbers is NO ANSWER — never a zero, which would read as "the
 * whole day is free" on an account that has already used it.
 */
export function readQuota(raw: unknown): PostingQuota | null {
  const j = (raw ?? {}) as Record<string, unknown>
  const inner = (j.publishingLimit ?? j.limit ?? j) as Record<string, unknown>
  const number = (...names: string[]): number | null => {
    for (const name of names) {
      const value = inner[name] ?? j[name]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.trunc(value)
      }
    }
    return null
  }
  const used = number('quotaUsage', 'quota_usage', 'used')
  const total = number('quotaTotal', 'quota_total', 'total')
  if (used === null || total === null || total <= 0) return null
  return { used, total }
}

/** How many are left, never below zero and never above the day's own total. */
export function postsLeft(quota: PostingQuota | null | undefined): number | null {
  if (!quota) return null
  return Math.max(0, Math.min(quota.total, quota.total - quota.used))
}

/**
 * The one line under a channel, and the refusal when the day is gone.
 *
 * `line` is the quiet fact — shown whether or not anything is wrong, because
 * "3 of 100 left" is worth knowing before the third post rather than after
 * the hundredth. `problem` is only there when this account cannot post again
 * today, and it is written to be acted on: whose account, what ran out, and
 * when it can go instead.
 */
export function quotaWords(input: {
  platform: string
  /** the account's @name, when the screen knows it */
  handle?: string | null
  /** Instagram's answer */
  quota?: PostingQuota | null
  /** TikTok's answer: may this account post again inside its 24 hours */
  canPostMore?: boolean | null
  /** when the window rolls, ALREADY in the client's words ("6:20 pm"), when
   *  the provider gave one. It does not, today, so this is usually absent and
   *  the sentence says "tomorrow" instead of inventing a time. */
  resetWords?: string | null
}): { line: string | null; problem: string | null } {
  const name = networkName(input.platform)
  const who = String(input.handle ?? '').trim()
    ? `@${String(input.handle).trim().replace(/^@/, '')}`
    : `This ${name} account`
  const when = String(input.resetWords ?? '').trim()
    ? `Book it for after ${String(input.resetWords).trim()}.`
    : 'Book it for tomorrow.'

  const left = postsLeft(input.quota)
  if (left !== null && input.quota) {
    const line = `${name}: ${left} of ${input.quota.total} posts left today`
    if (left > 0) return { line, problem: null }
    return {
      line,
      problem: `${who} has used today’s ${name} posting limit (${input.quota.total}). ${when}`,
    }
  }

  // TikTok answers with a yes or a no and no numbers at all
  if (input.canPostMore === false) {
    return {
      line: `${name}: no posts left today`,
      problem: `${who} has used today’s ${name} posting limit. ${when}`,
    }
  }
  return { line: null, problem: null }
}
