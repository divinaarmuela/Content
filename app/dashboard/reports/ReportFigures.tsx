'use client'

import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, ExternalLink } from 'lucide-react'
import { change, fmt, monthRange, type Breakdown, type MonthKey, type PlatformFigures, type ReportData, type TopPost, platformLabel } from '../../lib/client-report-core'

/** THE MONTH'S FIGURES, drawn — shared by the Reports page and the client's portal (5 Nov 2026) */

export function Kpi({ label, value, was, suffix, note, hint, compare = true }: { label: string; value: number | null; was?: number | null; suffix?: string; note?: string; hint?: string; compare?: boolean }) {
  const c = compare ? change(value, was) : null
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value == null ? '—' : `${fmt(value)}${suffix ?? ''}`}</span>
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

export function PlatformSection({ p, month, running }: { p: PlatformFigures; month: MonthKey; running: boolean }) {
  const name = platformLabel(p.platform)
  const { from, to } = monthRange(month)
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const soFar = running ? 'so far this month' : undefined
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[20px] font-semibold">{name}</h2>
        {p.handle && <span className="text-[14px] text-muted-foreground">@{p.handle}</span>}
        <span className="ml-auto text-[13px] text-muted-foreground">{day(from)} – {day(to)} · {p.posts} {p.posts === 1 ? 'post' : 'posts'} this month</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label={running ? 'Followers now' : 'Followers at the end of the month'} value={p.followers.end} was={p.followers.previousEnd} compare={!running}
          note={running ? `${fmt(p.followers.previousEnd)} when the month began` : undefined} hint="People following the account." />
        <Kpi label="Views" value={p.views} was={p.previous.views} compare={!running} note={soFar} hint="How many times the posts were seen, repeat views included." />
        <Kpi label="Accounts reached" value={p.reach} was={p.previous.reach} compare={!running} note={soFar} hint="How many different people saw them." />
        <Kpi label="Interactions" value={p.interactions} was={p.previous.interactions} compare={!running} note={soFar} hint="Likes, comments, shares and saves added together." />
        {p.platform === 'instagram' && <Kpi label="Profile visits" value={p.profileVisits} note={soFar ?? 'this month'} hint="People who opened the profile." />}
        {p.platform === 'instagram' && <Kpi label="Bio link taps" value={p.linkTaps} note={soFar ?? 'this month'} hint="Taps on the link in the bio." />}
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
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{p.topPosts.map((t, i) => <PostTile key={t.id} t={t} rank={i + 1} />)}</ol>
        </div>
      )}
    </section>
  )
}

export function PostTile({ t, rank }: { t: TopPost; rank: number }) {
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
        <p className="mt-auto text-[13px]"><strong className="tabular-nums">{fmt(t.views)}</strong> views</p>
        {/* Facebook gives no likes, comments, shares or saves for reels (Graph: "nonexisting field (reactions)",
            checked 5 Nov 2026): a row of zeros there is "not given", said so */}
        {t.platform === 'facebook' && !t.likes && !t.comments && !t.shares && !t.saves
          ? <p className="text-[12px] text-muted-foreground">Facebook gives views only for this post, not likes or comments.</p>
          : <p className="text-[12px] text-muted-foreground tabular-nums">{fmt(t.likes)} likes · {fmt(t.comments)} comments · {fmt(t.shares)} shares · {fmt(t.saves)} saves</p>}
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
