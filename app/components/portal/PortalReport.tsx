'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ExternalLink, X } from 'lucide-react'
import { fmt, reportHtml, type CandidatePost, platformLabel, availableStats, statsFor, STAT_WORD } from '../../lib/client-report-core'
import { Kpi, AudienceSection } from '../../dashboard/reports/ReportFigures'
import type { PortalReport as Report } from '../../lib/portal-reports'

/**
 * THE CLIENT'S MONTHLY REPORT, INTERACTIVE (the owner, 5 Nov 2026: "highly interactive with the social media accounts
 * and posts included"). Pick an account and its figures and daily chart change; the posts in the report can be
 * filtered by account and type and sorted; a post opens with every number, why it worked, and a link to it live; the
 * written report sits underneath.
 */

// the dashboard's colour tokens, given values on the portal (they live on .dbx there)
const TOKENS = {
  '--dbx-surface': 'hsl(var(--card))',
  '--dbx-green': '#1f8a4c',
  '--dbx-red': '#c2412d',
  '--dbx-blue': '#2f6fed',
  '--dbx-tint-amber': 'rgba(230, 170, 60, 0.22)',
} as CSSProperties

const platformName = platformLabel
function mediumName(f: string | null | undefined): string {
  switch ((f ?? '').toLowerCase()) {
    case 'story': return 'Story'
    case 'video': case 'reel': case 'reels': return 'Reel'
    case 'carousel': case 'carousel_album': case 'album': return 'Carousel'
    case 'image': case 'photo': return 'Image'
    default: return f ? f[0].toUpperCase() + f.slice(1) : 'Post'
  }
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '')

export default function PortalReport({ report }: { report: Report }) {
  const accounts = report.platforms
  const [account, setAccount] = useState(accounts[0]?.platform ?? 'instagram')
  const p = accounts.find(a => a.platform === account) ?? accounts[0]

  // our own kept copies of pictures (the explained posts) beat the platform's expiring links
  const keptPicture = useMemo(() => new Map((report.explained?.posts ?? []).map(t => [t.id, t.thumbnail])), [report.explained])
  const why = useMemo(() => new Map((report.explained?.items ?? []).map(i => [i.postId, i])), [report.explained])

  const [where, setWhere] = useState<'all' | string>('all')
  const [kind, setKind] = useState<'all' | string>('all')
  const [sort, setSort] = useState<'views' | 'newest'>('views')
  const [open, setOpen] = useState<CandidatePost | null>(null)
  const kinds = [...new Set(report.posts.map(c => mediumName(c.format)))]
  // only the numbers each platform gives (5 Nov 2026)
  const avail = useMemo(() => availableStats(report.posts), [report.posts])
  const postPlatforms = [...new Set(report.posts.map(c => c.platform))]
  const posts = report.posts
    .filter(c => (where === 'all' || c.platform === where) && (kind === 'all' || mediumName(c.format) === kind))
    .sort((a, b) => (sort === 'views' ? (b.views || b.reach || 0) - (a.views || a.reach || 0) : String(b.publishedAt).localeCompare(String(a.publishedAt))))

  const chip = (on: boolean) => `min-h-10 rounded-full border px-4 text-[14px] font-medium transition ${on ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`

  return (
    <div className="flex flex-col gap-8" style={TOKENS}>
      {/* THE ACCOUNTS */}
      {accounts.length > 0 && p && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Account">
            {accounts.map(a => (
              <button key={a.platform} type="button" role="tab" aria-selected={a.platform === account} onClick={() => setAccount(a.platform)} className={chip(a.platform === account)}>
                {platformName(a.platform)}{a.handle ? ` · @${a.handle}` : ''}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Followers" value={p.followers.end} was={p.followers.previousEnd} hint="People following the account at the end of the month." />
            <Kpi label="Views" value={p.views} was={p.previous.views} hint="How many times your posts were seen." />
            <Kpi label="Accounts reached" value={p.reach} was={p.previous.reach} hint="How many different people saw them." />
            <Kpi label="Interactions" value={p.interactions} was={p.previous.interactions} hint="Likes, comments, shares and saves." />
          </div>
          {p.daily.some(d => d.views > 0) && (
            <div className="rounded-card border border-border bg-card p-4">
              <p className="mb-2 text-[13px] text-muted-foreground">Views each day on {platformName(p.platform)} — move along the chart to see a day</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={p.daily} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <XAxis dataKey="date" tickFormatter={d => String(d).slice(8)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={v => [fmt(Number(v)), 'Views']} labelFormatter={l => new Date(String(l)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} />
                    <Area type="monotone" dataKey="views" stroke="#2f6fed" fill="#2f6fed" fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </section>
      )}

      {/* THE POSTS IN THIS REPORT */}
      {report.posts.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-[22px] font-semibold tracking-tight">Your posts this month <span className="text-muted-foreground">({report.posts.length})</span></h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* the accounts the POSTS are on (5 Nov 2026: a lone "Instagram" chip filtered nothing) — shown only when there are two */}
            {postPlatforms.length > 1 && (
              <>
                <button type="button" className={chip(where === 'all')} onClick={() => setWhere('all')}>All accounts</button>
                {postPlatforms.map(pl => <button key={pl} type="button" className={chip(where === pl)} onClick={() => setWhere(pl)}>{platformName(pl)} ({report.posts.filter(c => c.platform === pl).length})</button>)}
                <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              </>
            )}
            <button type="button" className={chip(kind === 'all')} onClick={() => setKind('all')}>Every type</button>
            {kinds.map(k => <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>{k}s</button>)}
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <button type="button" className={chip(sort === 'views')} onClick={() => setSort('views')}>Most seen</button>
            <button type="button" className={chip(sort === 'newest')} onClick={() => setSort('newest')}>Newest</button>
          </div>
          {posts.length === 0 ? (
            <p className="rounded-inner border border-dashed border-border px-4 py-8 text-center text-[14px] text-muted-foreground">No posts match.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {posts.map(c => {
                const pic = keptPicture.get(c.id) ?? c.thumbnail
                const score = why.get(c.id)?.index
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setOpen(c)} className="flex w-full flex-col overflow-hidden rounded-inner border border-border bg-card text-left transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="relative aspect-[4/5] w-full bg-muted">
                        <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-[12px] text-muted-foreground">{c.format === 'story' ? 'Story — no longer shown' : 'Tap to open'}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {pic && <img src={pic} alt="" loading="lazy" referrerPolicy="no-referrer" className="relative h-full w-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
                        {score && <span className="absolute left-2 top-2 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">{score.multiple}× usual</span>}
                      </div>
                      <div className="flex flex-col gap-1 p-2.5">
                        <span className="flex flex-wrap gap-1">
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold">{platformName(c.platform)}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{mediumName(c.format)}</span>
                        </span>
                        <span className="text-[13px]"><strong className="tabular-nums">{fmt(c.views || c.reach || 0)}</strong> <span className="text-muted-foreground">{c.views ? 'views' : 'people reached'} · {day(c.publishedAt)}</span></span>
                        <span className="line-clamp-2 text-[12px] text-muted-foreground">{c.caption || 'No caption'}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {report.audience && <div className="[&_.bg-surface]:bg-card"><AudienceSection a={report.audience} /></div>}

      {/* THE WRITTEN REPORT */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[22px] font-semibold tracking-tight">The report</h2>
        <style>{PROSE}</style>
        <article className="portal-report-prose rounded-card border border-border bg-card p-5 sm:p-7" dangerouslySetInnerHTML={{ __html: reportHtml(report.body) }} />
      </section>

      {/* ONE POST, OPENED */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Post" onClick={() => setOpen(null)}>
          <div className="max-h-[92vh] w-full max-w-[860px] overflow-y-auto rounded-t-[22px] bg-background sm:rounded-[22px]" onClick={e => e.stopPropagation()}>
            <div className="grid gap-0 md:grid-cols-[minmax(0,320px)_1fr]">
              <div className="relative aspect-[4/5] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {(keptPicture.get(open.id) ?? open.thumbnail) && <img src={(keptPicture.get(open.id) ?? open.thumbnail)!} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
              </div>
              <div className="flex flex-col gap-4 p-5">
                <div className="flex items-start gap-2">
                  <span className="flex flex-wrap gap-1">
                    <span className="rounded-full border border-border px-2 py-0.5 text-[12px] font-semibold">{platformName(open.platform)}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold">{mediumName(open.format)}</span>
                    <span className="px-1 py-0.5 text-[12px] text-muted-foreground">{day(open.publishedAt)}</span>
                  </span>
                  <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="ml-auto flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"><X className="h-5 w-5" /></button>
                </div>
                <dl className="grid grid-cols-3 gap-2">
                  {statsFor(open, avail).map(s => [s === 'reach' ? 'People reached' : STAT_WORD[s][1][0].toUpperCase() + STAT_WORD[s][1].slice(1), open[s]] as [string, number | undefined])
                    .map(([k, v]) => (
                      <div key={k} className="rounded-inner border border-border p-2.5">
                        <dt className="text-[11px] text-muted-foreground">{k}</dt>
                        <dd className="text-[18px] font-semibold tabular-nums">{fmt(v ?? 0)}</dd>
                      </div>
                    ))}
                </dl>
                {(() => {
                  const w = why.get(open.id)
                  if (!w?.breakdown) return null
                  return (
                    <div className="flex flex-col gap-2 rounded-inner bg-muted/60 p-3">
                      <p className="text-[13px] font-semibold">{w.mode === 'work' ? `Why it worked — about ${w.index.multiple}× a usual post` : `Why it fell behind — about ${w.index.multiple}× a usual post`}</p>
                      <p className="text-[14px]">{w.breakdown.verdict}</p>
                      {w.breakdown.whatWorked.length > 0 && <ul className="list-disc pl-5 text-[13px]">{w.breakdown.whatWorked.map(x => <li key={x}>{x}</li>)}</ul>}
                    </div>
                  )
                })()}
                <p className="whitespace-pre-line text-[14px]">{open.caption || 'No caption'}</p>
                {open.url && open.format !== 'story' && (
                  <a href={open.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background">
                    See it on {platformName(open.platform)} <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PROSE = `
.portal-report-prose{font-size:15px;line-height:1.65}
.portal-report-prose h1,.portal-report-prose h2{font-size:20px;font-weight:600;margin:22px 0 8px}
.portal-report-prose h3{font-size:16px;font-weight:600;margin:18px 0 6px}
.portal-report-prose p{margin:8px 0}
.portal-report-prose ul,.portal-report-prose ol{margin:8px 0;padding-left:22px}
.portal-report-prose ul{list-style:disc}.portal-report-prose ol{list-style:decimal}
.portal-report-prose a{text-decoration:underline;text-underline-offset:3px}
.portal-report-prose table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
.portal-report-prose th,.portal-report-prose td{border:1px solid hsl(var(--border));padding:6px 8px;text-align:left}
`
