'use client'

import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { CAL_TZ } from '@/app/lib/gcal-core'
import { durationWords, pct, type Point, type SectionKey, type Slice } from '@/app/lib/channel-insights-core'
import type { SectionResult } from '@/app/lib/channel-insights'
import { Thumb, n } from '../../shared'
import { SliceBars } from '../../PostExtras'

/**
 * A CHANNEL'S DEEP ANALYTICS, AS TABS BESIDE ITS POSTS (the owner, 2 Nov 2026: "let's add this in detail, no misses,
 * and LinkedIn too"). Each tab is read when it is opened. Every number is named in plain words; where the platform
 * gives nothing, the tab says why.
 */
export function ChannelSection({ accountId, section, range }: {
  accountId: string; section: SectionKey; range: { from: string; to: string }
}) {
  const [data, setData] = useState<SectionResult | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    fetch(`/api/social/analytics/channel?account=${encodeURIComponent(accountId)}&section=${section}&from=${range.from}&to=${range.to}`)
      .then(async r => { const j = await r.json(); return r.ok ? j : { problem: j.error ?? 'These numbers could not be read.' } })
      .then(j => { if (live) setData(j) })
      .catch(() => { if (live) setData({ problem: 'These numbers could not be read. Try again in a moment.' }) })
    return () => { live = false }
  }, [accountId, section, range.from, range.to])

  if (!data) return <div className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
  if ('problem' in data) return <Note>{data.problem}</Note>

  switch (data.kind) {
    case 'ig_account': return (
      <Stack>
        <RangeNote range={data.range} clamped={data.clamped} delay={data.delay} />
        <Grid items={[
          ['Accounts reached', data.totals.reach, 'different people who saw anything'],
          ['Views', data.totals.views, 'times anything was seen'],
          ['Accounts engaged', data.totals.accounts_engaged, 'people who liked, commented, saved, shared or replied'],
          ['Interactions', data.totals.total_interactions, 'all likes, comments, saves, shares and replies'],
          ['Likes', data.totals.likes], ['Comments', data.totals.comments], ['Saves', data.totals.saves], ['Shares', data.totals.shares],
          ['Replies', data.totals.replies, 'to Stories'], ['Reposts', data.totals.reposts],
          ['Profile visits', data.totals.profile_views], ['Link taps in bio', data.totals.profile_links_taps],
          ['Website clicks', data.totals.website_clicks],
          ['Follows', data.follows, 'people who followed in these days'], ['Unfollows', data.unfollows, 'people who unfollowed in these days'],
        ]} />
        {data.reach.length > 0 && <Panel title="Accounts reached, day by day"><DayBars points={data.reach} /></Panel>}
        {data.viewsByFormat.length > 0 && (
          <Panel title="Where the views came from">
            <SliceBars slices={data.viewsByFormat.map(s => ({ ...s, label: FORMAT_WORDS[s.label] ?? s.label }))} counts />
          </Panel>
        )}
      </Stack>
    )

    case 'followers': return (
      <Stack>
        <RangeNote range={data.range} clamped={data.clamped} delay={data.delay} />
        <Grid items={[
          ['Followers now', data.current],
          ['Gained', data.gained, 'net rise, day by day'],
          ['Lost', data.lost, 'net fall, day by day'],
        ]} />
        <Note>Gained and lost come from one count a day: a day that grew shows as gained, a day that shrank as lost. Real follows and unfollows are on the Account tab.</Note>
        {data.count.length > 0 && <Panel title="Followers, day by day"><DayBars points={data.count} relative /></Panel>}
        {data.gainedByDay.some(p => p.value) && <Panel title="Gained each day"><DayBars points={data.gainedByDay} /></Panel>}
        {data.lostByDay.some(p => p.value) && <Panel title="Lost each day"><DayBars points={data.lostByDay} /></Panel>}
      </Stack>
    )

    case 'ig_audience': {
      const none = Object.keys(data.followers).length === 0
      return (
        <Stack>
          {none ? (
            <Note>Instagram shares who the followers are only for accounts with 100 or more followers.</Note>
          ) : (
            <>
              <Note>This month, from Instagram. Each list shows its top entries, so they need not add up to the follower count.</Note>
              <Demographics title="Who follows" demo={data.followers} />
              {Object.keys(data.engaged).length > 0 && <Demographics title="Who engaged this month" demo={data.engaged} />}
            </>
          )}
        </Stack>
      )
    }

    case 'stories': return (
      <Stack>
        <Note>Instagram gives Story numbers only while a Story is up (24 hours), so these are the Stories live right now. Counts under 5 can show as 0 — Instagram hides small numbers.</Note>
        {data.stories.length === 0 ? <Note>No Stories are up right now.</Note> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.stories.map(s => (
              <li key={s.id} className="flex gap-3 rounded-inner border border-border p-3">
                <Thumb src={s.thumbnail} platform="instagram" className="h-28 w-16 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="text-secondary-13 text-muted-foreground">
                    {s.at ? when(s.at) : ''}{s.mediaType ? ` · ${s.mediaType.toLowerCase()}` : ''}
                    {s.source === 'unavailable' ? ' · Instagram gave no numbers for this one' : ''}
                  </p>
                  <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1">
                    {STORY_METRICS.map(([k, label]) => (
                      <div key={k}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="font-mono text-body-15 tabular-nums">{n(s.metrics[k] ?? 0)}</dd></div>
                    ))}
                  </dl>
                  {s.permalink && <OpenLink href={s.permalink} label="Open on Instagram" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    )

    case 'tagged': return (
      <Stack>
        <Note>Posts by other accounts that tag this one — creators, customers, partners. Newest first.</Note>
        {data.posts.length === 0 ? <Note>Nobody has tagged this account recently.</Note> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.posts.map(p => (
              <li key={p.id} className="flex flex-col gap-1.5 rounded-inner border border-border p-2">
                <Thumb src={p.thumbnail} platform="instagram" className="aspect-square w-full rounded-md" />
                <p className="truncate text-secondary-13 font-medium">{p.username ? `@${p.username}` : 'Someone'}</p>
                <p className="line-clamp-2 text-[12px] text-muted-foreground">{p.caption || '(no caption)'}</p>
                <p className="font-mono text-[12px] tabular-nums text-muted-foreground">
                  {p.likes !== null ? `${n(p.likes)} likes · ` : ''}{p.comments !== null ? `${n(p.comments)} comments` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground">{p.at ? when(p.at) : ''}</p>
                {p.permalink && <OpenLink href={p.permalink} label="Open" />}
              </li>
            ))}
          </ul>
        )}
      </Stack>
    )

    case 'tt_account': return (
      <Stack>
        <RangeNote range={data.range} clamped={data.clamped} delay={data.delay} />
        <Grid items={[
          ['Followers', data.totals.follower_count], ['Following', data.totals.following_count],
          ['Likes, all time', data.totals.likes_count, 'on every video ever posted'], ['Videos', data.totals.video_count, 'all time'],
          ['Gained', data.totals.followers_gained, 'in these days'], ['Lost', data.totals.followers_lost, 'in these days'],
        ]} />
        <Note>TikTok gives no account-wide reach, views or audience. Those are per video — open a video on the Posts tab to see who watched it.</Note>
        {data.followers.length > 0 && <Panel title="Followers, day by day"><DayBars points={data.followers} relative /></Panel>}
      </Stack>
    )

    case 'fb_page': return (
      <Stack>
        <RangeNote range={data.range} clamped={data.clamped} delay={data.delay} />
        <Grid items={[
          ['Views', data.totals.page_media_view, 'times the Page’s posts and Page were seen'],
          ['Page visits', data.totals.page_views_total], ['Post engagements', data.totals.page_post_engagements, 'reactions, comments, shares, clicks'],
          ['Video views', data.totals.page_video_views],
          ['Video watch time', null, durationWords(data.totals.page_video_view_time ?? 0)],
          ['Page followers', data.totals.page_follows, 'now'],
          ['Gained', data.totals.followers_gained], ['Lost', data.totals.followers_lost],
        ]} />
        {data.unavailable.length > 0 && <Note>Facebook gave nothing for: {data.unavailable.join(', ')}.</Note>}
        {data.views.length > 0 && <Panel title="Views, day by day"><DayBars points={data.views} /></Panel>}
        {data.engagements.length > 0 && <Panel title="Post engagements, day by day"><DayBars points={data.engagements} /></Panel>}
      </Stack>
    )

    case 'fb_audience': return (
      <Stack>
        <Note>Who follows the Page, by country and city{data.snapshotDate ? `, as of ${dayWords(data.snapshotDate)}` : ''}. Meta stopped giving age and gender in November 2025.</Note>
        {Object.keys(data.demographics).length === 0 ? <Note>Facebook gave no audience for this Page.</Note> : <Demographics title="Who follows" demo={data.demographics} />}
      </Stack>
    )

    case 'li_org': return (
      <Stack>
        <RangeNote range={data.range} clamped={data.clamped} delay={data.delay ?? 'LinkedIn’s numbers run about 2 days behind'} />
        <Grid items={[
          ['Impressions', data.totals.impressions], ['Unique impressions', data.totals.unique_impressions, 'different people'],
          ['Clicks', data.totals.clicks], ['Likes', data.totals.likes], ['Comments', data.totals.comments], ['Shares', data.totals.shares],
          ['Engagement rate', null, data.totals.engagement_rate !== undefined ? pct(data.totals.engagement_rate) : '—'],
          ['Followers gained', data.totals.organic_followers_gained, 'without ads'], ['Followers from ads', data.totals.paid_followers_gained],
          ['Followers lost', data.totals.followers_lost], ['Page views', data.totals.page_views_total],
        ]} />
        {data.impressions.length > 0 && <Panel title="Impressions, day by day"><DayBars points={data.impressions} /></Panel>}
        {data.clicks.length > 0 && <Panel title="Clicks, day by day"><DayBars points={data.clicks} /></Panel>}
      </Stack>
    )

    case 'li_personal': return (
      <Stack>
        <Note>A personal profile: LinkedIn gives its totals for the days picked.</Note>
        <Grid items={[
          ['Impressions', data.totals.impressions], ['Members reached', data.totals.reach, 'different people'],
          ['Reactions', data.totals.reactions], ['Comments', data.totals.comments], ['Reshares', data.totals.shares],
          ['Saves', data.totals.saves], ['Sends', data.totals.sends, 'shared in messages'],
          ['Engagement rate', null, typeof data.totals.engagementRate === 'number' ? `${data.totals.engagementRate}%` : '—'],
        ]} />
      </Stack>
    )

    case 'li_audience': return (
      <Stack>
        <Note>Who follows the page, all time. LinkedIn lists its top entries in each, so they need not add up to the follower count.</Note>
        {Object.keys(data.demographics).length === 0 ? <Note>LinkedIn gave no follower make-up for this page.</Note> : <Demographics title="Who follows" demo={data.demographics} />}
      </Stack>
    )
  }
}

// ── pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────

const FORMAT_WORDS: Record<string, string> = {
  REEL: 'Reels', STORY: 'Stories', POST: 'Posts', CAROUSEL_CONTAINER: 'Carousels', CAROUSEL_ITEM: 'Carousel slides', AD: 'Ads',
}

const STORY_METRICS: [string, string][] = [
  ['views', 'Views'], ['reach', 'Reach'], ['replies', 'Replies'], ['shares', 'Shares'], ['profileVisits', 'Profile visits'],
  ['follows', 'Follows'], ['tapsForward', 'Taps forward'], ['tapsBack', 'Taps back'], ['exits', 'Exits'],
  ['swipesForward', 'Swipes away'], ['reposts', 'Reposts'], ['totalInteractions', 'Interactions'],
]

const DEMO_WORDS: Record<string, string> = {
  age: 'Age', gender: 'Gender', country: 'Country', city: 'City',
  function: 'Job function', seniority: 'Seniority', industry: 'Industry', company_size: 'Company size', region: 'Region',
}
const GENDER: Record<string, string> = { F: 'Women', M: 'Men', U: 'Not said' }

let regions: Intl.DisplayNames | null = null
function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code === 'other' ? 'Other' : code
  try { regions ??= new Intl.DisplayNames(['en-AU'], { type: 'region' }); return regions.of(code) ?? code } catch { return code }
}

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: CAL_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const dayWords = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function Stack({ children }: { children: React.ReactNode }) { return <div className="flex flex-col gap-4">{children}</div> }

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary-13 text-muted-foreground">{children}</p>
}

function RangeNote({ range, clamped, delay }: { range: { from: string; to: string }; clamped: boolean; delay: string | null }) {
  return (
    <Note>
      {clamped ? `Account numbers reach back 90 days at most, so these are ${dayWords(range.from)} – ${dayWords(range.to)}. ` : ''}
      {delay ? `${delay.replace(/\.$/, '')}.` : ''}
    </Note>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="mb-3 text-card-title">{title}</h3>
      {children}
    </section>
  )
}

/** A number per tile; a tile with a null number shows its hint large instead (a duration, a rate). */
function Grid({ items }: { items: [string, number | null | undefined, string?][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(([label, value, hint]) => (
        <div key={label} className="rounded-card border border-border bg-surface p-3">
          <p className="text-secondary-13 text-muted-foreground">{label}</p>
          <p className="font-mono text-xl tabular-nums">{value === null ? (hint ?? '—') : n(value ?? 0)}</p>
          {value !== null && hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
      ))}
    </div>
  )
}

/** Day bars; `relative` starts the scale near the lowest day, so a follower count's small moves show. */
export function DayBars({ points, relative }: { points: readonly Point[]; relative?: boolean }) {
  const recent = points.slice(-60)
  const values = recent.map(p => p.value)
  const max = Math.max(1, ...values)
  const min = relative ? Math.min(...values) : 0
  const span = Math.max(1, max - min)
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 130 }}>
      {recent.map(p => (
        <div key={p.date} className="flex w-9 shrink-0 flex-col items-center gap-1" title={`${short(p.date)} · ${n(p.value)}`}>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{n(p.value)}</span>
          <div className="w-full rounded-t bg-foreground/[0.18]" style={{ height: Math.max(3, ((p.value - min) / span) * 70 + (relative ? 6 : 0)) }} />
          <span className="text-[10px] text-muted-foreground">{short(p.date)}</span>
        </div>
      ))}
    </div>
  )
}

function Demographics({ title, demo }: { title: string; demo: Record<string, Slice[]> }) {
  const order = ['age', 'gender', 'country', 'city', 'function', 'seniority', 'industry', 'company_size', 'region']
  const at = (k: string) => (order.includes(k) ? order.indexOf(k) : 99)
  const keys = Object.keys(demo).sort((a, b) => at(a) - at(b))
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-card-title">{title}</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        {keys.map(k => {
          let slices = demo[k]
          if (k === 'gender') slices = slices.map(s => ({ ...s, label: GENDER[s.label] ?? s.label }))
          if (k === 'country') slices = slices.map(s => ({ ...s, label: countryName(s.label) }))
          // ages read best in order, not by size
          if (k === 'age') slices = [...slices].sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
          return <Panel key={k} title={DEMO_WORDS[k] ?? k}><SliceBars slices={slices} counts limit={k === 'age' ? 10 : 8} /></Panel>
        })}
      </div>
    </section>
  )
}

function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
      <ExternalLink className="h-3 w-3" /> {label}
    </a>
  )
}
