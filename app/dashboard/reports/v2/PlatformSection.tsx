import { platformLabel, monthLabel } from '../../../lib/client-report-core'
import { DEFINITIONS, givesWords, hasValue, type AccountMetric, type MetricPlatform } from '../../../lib/report-v2/definitions'
import type { MonthMetric, V2Platform } from '../../../lib/report-v2/types'
import FigureCard from './FigureCard'

/** REPORT V2 — one account's month, driven entirely by the definition list and each figure's state */

const LABEL: Record<MonthMetric, string> = {
  views: 'Views', reach: 'Accounts reached', interactions: 'Interactions', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves',
  profileVisits: 'Profile visits', linkTaps: 'Bio link taps', accountsEngaged: 'Accounts engaged', replies: 'Replies', reposts: 'Reposts', websiteClicks: 'Website clicks',
}
const HEADLINE: readonly MonthMetric[] = ['views', 'reach', 'interactions']
const PARTS: readonly MonthMetric[] = ['likes', 'comments', 'shares', 'saves']
const MORE: readonly MonthMetric[] = ['profileVisits', 'linkTaps', 'accountsEngaged', 'replies', 'reposts', 'websiteClicks']
const KIND_WORD = { reel: 'Reels / videos', carousel: 'Carousels', image: 'Images', story: 'Stories', text: 'Text posts' } as const
const MIX_WORD: Record<string, string> = {
  follower: 'Followers', nonFollower: 'Non-followers', newViewer: 'New viewers', returnViewer: 'Returning viewers',
  forYou: 'For You', follow: 'Following', personalProfile: 'Profile', search: 'Search', sound: 'Sound', directMessage: 'Messages', other: 'Other',
}

export default function PlatformSection({ p, month }: { p: V2Platform; month: string }) {
  const name = platformLabel(p.platform)
  const defs = DEFINITIONS[p.platform as MetricPlatform] ?? {}
  const given = (k: AccountMetric) => !!defs[k]
  const byPosts = p.countedAs === 'posts'
  const f = p.followers
  const followerNote = f.follows != null && f.unfollows != null
    ? `${f.follows.toLocaleString('en-AU')} follows − ${f.unfollows.toLocaleString('en-AU')} unfollows, as Instagram counts them`
    : f.start != null && f.end != null && f.trackedFrom ? `${f.start.toLocaleString('en-AU')} on ${f.trackedFrom} → ${f.end.toLocaleString('en-AU')} (Zernio's daily count)` : null
  return (
    <section className="flex flex-col gap-4" data-platform={p.platform}>
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[20px] font-semibold">{name}</h2>
        {p.handle && <span className="text-[14px] text-muted-foreground">@{p.handle}</span>}
        <span className="ml-auto text-[13px] text-muted-foreground">{monthLabel(month)} · {p.posts.length} {p.posts.length === 1 ? 'post' : 'posts'}</span>
      </header>
      <div className="rounded-card border border-border bg-muted/40 p-3 text-[13px]">
        <strong>What {name} gives per post: </strong>
        {givesWords(p.platform).map(g => `${KIND_WORD[g.kind]}: ${g.stats.length ? g.stats.join(', ') : 'nothing'}`).join(' · ')}
        {byPosts && <div className="mt-1 text-muted-foreground">These totals are the month&apos;s own posts&apos; numbers, not the whole month — so there is no comparison with last month.</div>}
        {p.notes.map(n => <div key={n} className="mt-1 text-muted-foreground">{n}</div>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FigureCard label="Followers gained" figure={f.gained} previous={f.previousGained} platformName={name} note={followerNote} signed />
        {HEADLINE.filter(given).map(k => (
          <FigureCard key={k} label={byPosts ? `${LABEL[k]} on the month's posts` : `${LABEL[k]} in the month`} figure={p.figures[k]} previous={p.previous[k as 'views']} platformName={name}
            note={k === 'interactions' && p.interactionsOther ? `includes ${p.interactionsOther.toLocaleString('en-AU')} other (reposts, replies…) beyond the parts below` : null} />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PARTS.map(k => <FigureCard key={k} label={LABEL[k]} figure={p.figures[k]} platformName={name} />)}
      </div>
      {MORE.some(given) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MORE.filter(given).map(k => <FigureCard key={k} label={LABEL[k]} figure={p.figures[k]} platformName={name} />)}
        </div>
      )}
      {p.viewsFromFollowersPct != null && (
        <p className="text-[13px]">Views from followers <strong>{p.viewsFromFollowersPct}%</strong> · from non-followers <strong>{Math.round((100 - p.viewsFromFollowersPct) * 10) / 10}%</strong></p>
      )}
      {p.tiktokMix && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(['audienceTypes', 'impressionSources'] as const).map(k => (
            <div key={k} className="rounded-card border border-border bg-surface p-4 text-[13px]">
              <div className="mb-2 font-medium">{k === 'audienceTypes' ? 'Who watched this month (by views)' : 'Where the views came from (by views)'}</div>
              {Object.entries(p.tiktokMix![k]).sort((a, b) => b[1] - a[1]).map(([key, pct]) => (
                <div key={key} className="flex justify-between"><span>{MIX_WORD[key] ?? key}</span><span className="tabular-nums">{pct}%</span></div>
              ))}
              {!Object.keys(p.tiktokMix![k]).length && <span className="text-muted-foreground">TikTok gave none this month</span>}
            </div>
          ))}
        </div>
      )}
      {!hasValue(f.gained) && hasValue(f.dailyGained) && <p className="text-[12px] text-muted-foreground">Zernio&apos;s daily count says {f.dailyGained.value}.</p>}
    </section>
  )
}
