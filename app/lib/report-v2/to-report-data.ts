/**
 * THE REBUILT FIGURES INTO THE WRITER (the owner, 5 Nov 2026: "replace the current reports page with the new one").
 * Build report's AI writes from ReportData (client-report-core's reportPrompt). The page shows report v2's figures, so
 * the writer is given those same numbers: each account's month figures, last month's, and the followers are laid over
 * the saved ReportData. A figure v2 has no value for (not tracked, not given, unreadable) becomes null — the prompt
 * then says nothing about it rather than a 0. Posts, audience and candidates stay the saved ones. Pure.
 */
import type { PlatformFigures, ReportData } from '../client-report-core'
import { hasValue, type Figure } from './definitions'
import type { V2Platform, V2Report } from './types'

const n = (f: Figure | null | undefined): number | null => (hasValue(f) ? f.value : null)

export function overlayPlatform(old: PlatformFigures, v: V2Platform): PlatformFigures {
  const f = v.figures
  return {
    ...old,
    countedAs: v.countedAs,
    views: n(f.views), reach: n(f.reach), interactions: n(f.interactions),
    likes: n(f.likes), comments: n(f.comments), shares: n(f.shares), saves: n(f.saves),
    interactionParts: { likes: n(f.likes), comments: n(f.comments), shares: n(f.shares), saves: n(f.saves) },
    profileVisits: n(f.profileVisits), linkTaps: n(f.linkTaps),
    previous: { views: n(v.previous.views), reach: n(v.previous.reach), interactions: n(v.previous.interactions) },
    followers: {
      start: v.followers.start, end: v.followers.end, previousEnd: v.followers.start,
      gained: n(v.followers.gained), previousGained: n(v.followers.previousGained),
      followsIn: v.followers.follows, unfollowsOut: v.followers.unfollows, trackedFrom: v.followers.trackedFrom,
    },
  }
}

/** the saved ReportData with every account's figures replaced by report v2's (accounts v2 did not read are kept) */
export function overlayV2(data: ReportData, v2: V2Report): ReportData {
  return {
    ...data,
    platforms: data.platforms.map(p => {
      const v = v2.platforms.find(x => x.platform === p.platform)
      return v ? overlayPlatform(p, v) : p
    }),
    gaps: [...new Set([...data.gaps, ...v2.gaps])],
  }
}
