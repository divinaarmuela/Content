/**
 * REPORT V2 — the shapes (the owner, 5 Nov 2026: "rebuild the code for this page"). Every number carries its state
 * (definitions.ts Figure); nothing is a bare 0 standing in for "not known". Pure types only.
 */
import type { AccountMetric, Figure, PostExtra, PostKind, PostStat } from './definitions'

export type V2PlatformId = 'instagram' | 'facebook' | 'tiktok' | 'linkedin'
export const V2_PLATFORMS: readonly V2PlatformId[] = ['instagram', 'facebook', 'tiktok', 'linkedin']

export type V2Account = { id: string; platform: V2PlatformId; handle: string | null }

/** what a Zernio read gave back */
export type ZernioAnswer<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string }
export type ZernioFetch = <T = Record<string, unknown>>(path: string, query: Record<string, string | number | undefined>) => Promise<ZernioAnswer<T>>

/** everything Zernio said about one account for one month — the input to normalise() */
export type RawAccountMonth = {
  account: V2Account
  month: string
  /** 'YYYY-MM-DD' — the day it was read (a running month reads to today) */
  today: string
  dash: ZernioAnswer
  prevDash: ZernioAnswer
  followerStats: ZernioAnswer
  posts: ZernioAnswer[]
  late: ZernioAnswer | null
  ig: null | { insights: ZernioAnswer; prevInsights: ZernioAnswer; split: ZernioAnswer; net: ZernioAnswer; prevNet: ZernioAnswer }
}

export type V2Post = {
  id: string
  platform: V2PlatformId
  kind: PostKind
  publishedAt: string | null
  url: string | null
  thumbnail: string | null
  caption: string
  byMdm: boolean
  stats: Record<PostStat, Figure>
  extras: Partial<Record<PostExtra, number>>
  /** TikTok only: who watched and where the views came from (%) */
  audienceTypes?: Record<string, number> | null
  impressionSources?: Record<string, number> | null
}

export type MonthMetric = Exclude<AccountMetric, 'followersGained'>
export const MONTH_METRICS: readonly MonthMetric[] = ['views', 'reach', 'interactions', 'likes', 'comments', 'shares', 'saves', 'profileVisits', 'linkTaps', 'accountsEngaged', 'replies', 'reposts', 'websiteClicks']

export type V2Platform = {
  platform: V2PlatformId
  accountId: string
  handle: string | null
  /** 'month' = what happened during the month on any post; 'posts' = the month's posts' own numbers (said as such) */
  countedAs: 'month' | 'posts'
  figures: Record<MonthMetric, Figure>
  previous: Record<'views' | 'reach' | 'interactions', Figure>
  followers: {
    gained: Figure
    previousGained: Figure
    /** daily counts, when read: first tracked day's count and the last */
    start: number | null
    end: number | null
    trackedFrom: string | null
    /** Instagram's own follows and unfollows (the net is `gained`) */
    follows: number | null
    unfollows: number | null
    /** the daily-count gain, kept beside Instagram's net for the checks */
    dailyGained: Figure
  }
  /** Instagram: total_interactions beyond likes + comments + shares + saves */
  interactionsOther: number | null
  viewsFromFollowersPct: number | null
  tiktokMix: { audienceTypes: Record<string, number>; impressionSources: Record<string, number> } | null
  posts: V2Post[]
  notes: string[]
}

export type CheckResult = { key: string; platform: string | null; ok: boolean; level: 'fail' | 'warn'; words: string }

export type V2Report = {
  clientId: string
  clientName: string
  month: string
  readAt: string
  platforms: V2Platform[]
  gaps: string[]
  checks: CheckResult[]
}
