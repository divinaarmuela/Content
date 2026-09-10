/**
 * TRIAL REELS — the pure half.
 *
 * Instagram can show a Reel to people who do NOT follow the account first,
 * and only later — by hand, or on its own when the trial does well — put it
 * in front of the followers. Zernio carries it as
 * `platformSpecificData.trialParams.graduationStrategy` on the Instagram
 * entry (docs.zernio.com/platforms/instagram); `publish-core` already sends
 * it when the kind is a Reel. This file holds the words and the one rule
 * everything else asks — is this post a trial? — so the post window, the
 * preview, the calendar, the Post approval card, the Posts page and the
 * emails all say the same thing (the owner, 10 Sep 2026: "trial reels, we
 * need to emphasise this feature… per post basis… on the modal").
 */

export type TrialStrategy = 'MANUAL' | 'SS_PERFORMANCE'

export const TRIAL_STRATEGIES: readonly TrialStrategy[] = ['MANUAL', 'SS_PERFORMANCE']

/** The three answers the post window offers, in order. '' is an ordinary Reel. */
export const TRIAL_CHOICES: readonly { value: '' | TrialStrategy; label: string; help: string }[] = [
  {
    value: '',
    label: 'Everyone',
    help: 'An ordinary Reel: followers and non-followers see it from the start.',
  },
  {
    value: 'MANUAL',
    label: 'Non-followers first — we decide',
    help: 'Only people who do not follow the account see it. It reaches the followers when somebody graduates it in the Instagram app.',
  },
  {
    value: 'SS_PERFORMANCE',
    label: 'Non-followers first — Instagram decides',
    help: 'Only non-followers see it. Instagram moves it to the followers on its own when it performs well.',
  },
]

/** The one sentence under the switch. */
export const TRIAL_SENTENCE =
  'A Trial Reel is shown to people who do not follow this account, and stays off the profile and the followers’ feed until it graduates. Instagram reports how it did after about a day.'

/** Instagram's own floor for trial reels: a public professional account with
 *  this many followers. Below it Meta refuses the post — the 12:45 pm post of
 *  10 Sep 2026: "Trial Reels require an Instagram account with 1,000+
 *  followers. Publish as a regular Reel instead." */
export const TRIAL_MIN_FOLLOWERS = 1000

/** The latest follower count we hold for an account, from its snapshots. */
export function latestFollowerCount(
  rows: readonly { account_id?: string | null; count?: number | null; taken_at?: string | null }[] | null | undefined,
  accountId: string,
): number | null {
  const mine = (rows ?? [])
    .filter(r => r && r.account_id === accountId && typeof r.count === 'number')
    .sort((a, b) => String(b.taken_at ?? '').localeCompare(String(a.taken_at ?? '')))
  return mine[0]?.count ?? null
}

/** Why this account cannot post a trial reel, or null when it can (or when
 *  nobody has counted its followers yet — the network is the judge then). */
export function trialFollowersProblem(count: number | null | undefined, username?: string | null): string | null {
  if (typeof count !== 'number') return null
  if (count >= TRIAL_MIN_FOLLOWERS) return null
  const who = username ? `@${String(username).replace(/^@/, '')}` : 'This account'
  return `${who} has ${count.toLocaleString('en-AU')} followers — Instagram only allows Trial Reels on accounts with ${TRIAL_MIN_FOLLOWERS.toLocaleString('en-AU')} or more. Post it as a Reel instead.`
}

export function isTrialStrategy(v: unknown): v is TrialStrategy {
  return v === 'MANUAL' || v === 'SS_PERFORMANCE'
}

/** "Trial Reel · non-followers first, we decide when it goes to followers" — or null. */
export function trialWords(strategy: unknown): string | null {
  if (!isTrialStrategy(strategy)) return null
  return strategy === 'MANUAL'
    ? 'Trial Reel · non-followers first, we decide when it goes to followers'
    : 'Trial Reel · non-followers first, Instagram decides when it goes to followers'
}

/**
 * Is this Instagram target going out as a trial? Only a Reel can be one:
 * the publisher drops the setting on a feed post or a Story, so a tag that
 * said "trial" over one of those would be a lie.
 */
export function isTrialTarget(
  platform: string | null | undefined,
  options: { kind?: string | null; trialGraduation?: unknown } | null | undefined,
): boolean {
  if (String(platform ?? '').toLowerCase() !== 'instagram') return false
  if (!isTrialStrategy(options?.trialGraduation)) return false
  const kind = String(options?.kind ?? 'reel').toLowerCase()
  return kind === 'reel'
}

/**
 * The trial strategy on a post, from its per-channel extras and the client's
 * accounts (an extra is keyed by account id, and only an Instagram account's
 * extra counts). Null when the post is not a trial.
 */
export function postTrial(
  perChannel: Record<string, { kind?: string | null; trialGraduation?: unknown } | null | undefined> | null | undefined,
  accounts: readonly { id: string; platform: string }[],
): TrialStrategy | null {
  if (!perChannel) return null
  for (const a of accounts) {
    const extras = perChannel[a.id]
    if (isTrialTarget(a.platform, extras)) return extras!.trialGraduation as TrialStrategy
  }
  return null
}
