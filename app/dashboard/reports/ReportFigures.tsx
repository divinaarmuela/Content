'use client'

import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, ExternalLink } from 'lucide-react'
import { availableStats, statsFor, STAT_WORD, STATS, type Stat, change, fmt, monthRange, type Breakdown, type MonthKey, type PlatformFigures, type ReportData, type TopPost, platformLabel } from '../../lib/client-report-core'

/** THE MONTH'S FIGURES, drawn — shared by the Reports page and the client's portal (5 Nov 2026) */

export function Kpi({ label, value, was, suffix, prefix = '', note, hint, compare = true }: { label: string; value: number | null; was?: number | null; suffix?: string; prefix?: string; note?: string; hint?: string; compare?: boolean }) {
  const c = compare ? change(value, was) : null
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value == null ? '—' : `${prefix}${fmt(value)}${suffix ?? ''}`}</span>
      <span className="flex min-h-5 items-center gap-1 text-[12px]">
        {c && (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${c.up ? 'text-accent-green' : 'text-accent-red'}`}>
            {c.up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}{c.text}
          </span>
        )}
        <span className="text-muted-foreground">{c ? `vs last month (${fmt(was ?? null)})` : note ?? ''}</span>
      </span>
      {hint && <span className="text-[12px] leading-snug text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function PlatformSection({ p, month, running, avail = null }: { p: PlatformFigures; month: MonthKey; running: boolean
  /** which numbers each platform and kind of post gives (availableStats over the month's posts) */
  avail?: Map<string, Set<Stat>> | null }) {
  // a figure the platform did not give is left out, never drawn as 0 (5 Nov 2026)
  const has = (v: number | null | undefined, was?: number | null) => (v ?? 0) > 0 || (was ?? 0) > 0
  const stats = avail ?? availableStats(p.topPosts)
  const name = platformLabel(p.platform)
  const { from, to } = monthRange(month)
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  // DURING THE MONTH (5 Nov 2026): the totals are what happened in the month, on any post; where the platform gives
  // nothing day by day they are the month's own posts so far, and the label says so
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long' })
  const byPosts = p.countedAs === 'posts'
  // WHAT THE INTERACTIONS ARE MADE OF, as the platform gave them (5 Nov 2026, Capila's Facebook: "saves added
  // together, but you said saves are not given") — "1 like + 6 shares", never a fixed list
  const ip = p.interactionParts
  const said = ip ? (['likes', 'comments', 'shares', 'saves'] as const).filter(k => (ip[k] ?? 0) > 0).map(k => `${fmt(ip[k])} ${ip[k] === 1 ? k.slice(0, -1) : k}`) : []
  // Instagram's total counts more than these four (reposts, replies): the rest is named, so the sum adds up
  const partsSum = ip ? (['likes', 'comments', 'shares', 'saves'] as const).reduce((n, k) => n + (ip[k] ?? 0), 0) : 0
  const other = p.interactions != null && ip && p.interactions > partsSum ? p.interactions - partsSum : 0
  const interactionWords = said.length ? `${[...said, ...(other ? [`${fmt(other)} other`] : [])].join(' + ')}, as ${name} counted them.` : `What ${name} counted as interactions.`
  const soFar = byPosts ? `on ${monthName}'s posts so far` : running ? 'so far this month' : `during ${monthName}, on any post`
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[20px] font-semibold">{name}</h2>
        {p.handle && <span className="text-[14px] text-muted-foreground">@{p.handle}</span>}
        <span className="ml-auto text-[13px] text-muted-foreground">{day(from)} – {day(to)} · {p.posts} {p.posts === 1 ? 'post' : 'posts'} this month</span>
      </header>
      {/* WHAT THIS PLATFORM GIVES (the owner, 5 Nov 2026: "each social media line should say what analytics it provides") */}
      <GivesLine platform={p.platform} avail={stats} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* only what the platform gives: the gain in the month, and the count today (5 Nov 2026) */}
        {p.followers.gained != null && <Kpi label="Followers gained this month" value={p.followers.gained} prefix={p.followers.gained > 0 ? '+' : ''} compare={false}
          note={p.followers.trackedFrom && !p.followers.trackedFrom.endsWith('-01') ? `${fmt(p.followers.start)} on ${new Date(`${p.followers.trackedFrom}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} (first day tracked) → ${fmt(p.followers.end)}${running ? ' now' : ' at the month’s end'} · last month: ${p.followers.previousGained == null ? 'not available' : `${p.followers.previousGained > 0 ? '+' : ''}${fmt(p.followers.previousGained)}`}` : `${fmt(p.followers.start)} on the 1st → ${fmt(p.followers.end)}${running ? ' now' : ' at the month’s end'} · last month: ${p.followers.previousGained == null ? 'not available' : `${p.followers.previousGained > 0 ? '+' : ''}${fmt(p.followers.previousGained)}`}`}
          hint="Zernio’s daily follower count: the first day it has in the month to the last." />}
        {/* the month picker shows THAT month (the owner, 5 Nov 2026): today's count is not a past month's number */}
        {running && p.followers.end != null && <Kpi label="Followers now" value={p.followers.end} compare={false} hint="People following the account today." />}
        {has(p.views, p.previous.views) && <Kpi label={byPosts ? 'Views on the month’s posts' : `Views in ${monthName}`} value={p.views} was={p.previous.views} compare={!running} note={soFar} hint="How many times the posts were seen, repeat views included." />}
        {has(p.reach, p.previous.reach) && <Kpi label={byPosts ? 'Reached by the month’s posts' : `Accounts reached in ${monthName}`} value={p.reach} was={p.previous.reach} compare={!running} note={soFar} hint="How many different people saw them." />}
        {has(p.interactions, p.previous.interactions) && <Kpi label={byPosts ? 'Interactions on the month’s posts' : `Interactions in ${monthName}`} value={p.interactions} was={p.previous.interactions} compare={!running} note={soFar} hint={interactionWords} />}
        {p.platform === 'instagram' && has(p.profileVisits) && <Kpi label="Profile visits" value={p.profileVisits} note={soFar ?? 'this month'} hint="People who opened the profile." />}
        {p.platform === 'instagram' && has(p.linkTaps) && <Kpi label="Bio link taps" value={p.linkTaps} note={soFar ?? 'this month'} hint="Taps on the link in the bio." />}
      </div>
      {p.viewsFromFollowers != null && p.viewsFromNonFollowers != null && (
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="mb-2 flex justify-between text-[13px]"><span>Views from followers <strong>{p.viewsFromFollowers}%</strong></span><span>from non-followers <strong>{p.viewsFromNonFollowers}%</strong></span></div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${p.viewsFromFollowers}% of views from followers, ${p.viewsFromNonFollowers}% from non-followers`}>
            <div className="bg-foreground" style={{ width: `${p.viewsFromFollowers}%` }} />
            <div className="bg-accent-blue" style={{ width: `${p.viewsFromNonFollowers}%` }} />
          </div>
        </div>
      )}
      {p.daily.some(d => d.views > 0) && (
        <div className="no-print rounded-card border border-border bg-surface p-4">
          <p className="mb-2 text-[13px] text-muted-foreground">Views each day</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={p.daily} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <XAxis dataKey="date" tickFormatter={d => String(d).slice(8)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => fmt(Number(v))} labelFormatter={l => new Date(String(l)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} />
                <Area type="monotone" dataKey="views" stroke="var(--dbx-blue, #2f6fed)" fill="var(--dbx-blue, #2f6fed)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {p.topPosts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">Top {p.topPosts.length} posts by views</h3>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{p.topPosts.map((t, i) => <PostTile key={t.id} t={t} rank={i + 1} shown={statsFor({ ...t, platform: p.platform }, stats)} />)}</ol>
        </div>
      )}
    </section>
  )
}

export function PostTile({ t, rank, shown = null }: { t: TopPost; rank: number; shown?: Stat[] | null }) {
  const list = shown ?? statsFor(t, null)
  const lead: Stat | null = list.includes('views') ? 'views' : list.includes('reach') ? 'reach' : null
  const rest = list.filter(s => s !== lead)
  // a picture that will not load (an expired Instagram address on a month read before 2 Nov 2026) opens the post instead
  const [failed, setFailed] = useState(false)
  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="relative aspect-[4/5] bg-muted">
        {t.thumbnail && !failed
          // eslint-disable-next-line @next/next/no-img-element -- the platform's own picture of the post
          ? <img src={t.thumbnail} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
          : <div className="flex h-full items-center justify-center p-3 text-center text-[12px] text-muted-foreground">{t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Open the post</a> : 'No picture'}</div>}
        <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[13px] font-bold text-background">{rank}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="text-[12px] text-muted-foreground">{t.publishedAt ? new Date(t.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}{t.format ? ` · ${t.format}` : ''}</span>
        <p className="line-clamp-2 text-[13px]">{t.caption || 'No caption'}</p>
        {lead
          ? <p className="mt-auto text-[13px]"><strong className="tabular-nums">{fmt(t[lead])}</strong> {STAT_WORD[lead][t[lead] === 1 ? 0 : 1]}{lead === 'reach' && <span className="text-muted-foreground"> · no views given</span>}</p>
          : <p className="mt-auto text-[13px] text-muted-foreground">{t.format === 'story' ? 'Story: no numbers once it expires' : 'No numbers given for this post'}</p>}
        {/* Facebook gives no likes, comments, shares or saves for reels (Graph: "nonexisting field (reactions)",
            checked 5 Nov 2026): a row of zeros there is "not given", said so */}
        {rest.length > 0 && <p className="text-[12px] text-muted-foreground tabular-nums">{rest.map(s => `${fmt(t[s])} ${STAT_WORD[s][t[s] === 1 ? 0 : 1]}`).join(' · ')}</p>}
        {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="no-print inline-flex items-center gap-1 text-[12px] underline underline-offset-4">Open <ExternalLink className="h-3 w-3" aria-hidden /></a>}
      </div>
    </li>
  )
}

export function Bars({ title, rows }: { title: string; rows: Breakdown[] }) {
  if (!rows.length) return null
  const max = Math.max(...rows.map(r => r.pct), 1)
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="mb-3 text-[13px] font-semibold">{title}</p>
      <ul className="flex flex-col gap-2">
        {rows.map(r => (
          <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_3rem] items-center gap-2 text-[13px]">
            <span className="truncate" title={r.label}>{r.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground" style={{ width: `${(r.pct / max) * 100}%` }} /></span>
            <span className="text-right tabular-nums text-muted-foreground">{r.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AudienceSection({ a }: { a: NonNullable<ReportData['audience']> }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-2">
        <h2 className="text-[20px] font-semibold">Audience</h2>
        <span className="text-[13px] text-muted-foreground">Instagram followers{a.asOf ? ` · as of ${new Date(a.asOf).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}</span>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        <Bars title="Age" rows={a.age} />
        <Bars title="Top cities" rows={a.cities} />
      </div>
      {a.engaged && (
        <>
          <p className="mt-2 text-[14px] font-semibold">Who engaged this month <span className="font-normal text-muted-foreground">— the people who liked, commented, shared or saved, not just followers</span></p>
          <div className="grid gap-3 md:grid-cols-2">
            <Bars title="Age" rows={a.engaged.age} />
            <Bars title="Top cities" rows={a.engaged.cities} />
          </div>
        </>
      )}
    </section>
  )
}

const KIND_WORD: Record<string, string> = { reel: 'videos and reels', carousel: 'carousels', image: 'images', story: 'stories' }
// views and reach are different numbers, said so: views = times seen (repeats count), reach = different people
const statWord = (st: Stat) => (st === 'views' ? 'views (times seen)' : st === 'reach' ? 'reach (people who saw it)' : STAT_WORD[st][1])

/** "Gives: views, reach, likes… · Not given: …", per kind of post when they differ */
export function GivesLine({ platform, avail }: { platform: string; avail: Map<string, Set<Stat>> }) {
  const kinds = [...avail.entries()].filter(([k]) => k.startsWith(`${platform}:`)).map(([k, set]) => [k.split(':')[1], set] as const)
  if (!kinds.length) return null
  const say = (set: ReadonlySet<Stat>) => {
    const given = STATS.filter(st => set.has(st)).map(statWord)
    const not = STATS.filter(st => !set.has(st)).map(statWord)
    return `${given.length ? given.join(', ') : 'no numbers'}${not.length && given.length ? ` · not given: ${not.join(', ')}` : ''}`
  }
  const same = kinds.every(([, set]) => STATS.every(st => set.has(st) === kinds[0][1].has(st)))
  return (
    <div className="-mt-2 rounded-inner bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
      <span className="font-semibold text-foreground">What {platformLabel(platform)} gives: </span>
      {same
        ? say(kinds[0][1])
        : kinds.map(([kind, set]) => <span key={kind} className="block"><span className="text-foreground">{KIND_WORD[kind] ?? kind}</span>: {kind === 'story' && set.size === 0 ? 'no numbers once a story expires' : say(set)}</span>)}
    </div>
  )
}
