'use client'

import { X } from 'lucide-react'
import { readPostsExplained } from '../../lib/post-breakdown-core'
import { change, fmt, monthLabel, monthRange, platformLabel, type ReportData } from '../../lib/client-report-core'
import { viewsByType } from '../../lib/report-charts-core'
import { tileList, type Figure } from '../../lib/report-figures'
import PlatformIcon from '../social/PlatformIcon'
import { CompareBars, DailyLine, SplitBar } from './ReportCharts'

/**
 * ONE FIGURE OF THE REPORT, DRAWN (20 Nov 2026, report-figures.ts): the summary table, an account's heading, its
 * tiles, one of its charts, its top posts, why they worked, or the audience. The very same drawing is used in the
 * editor, the preview and the PDF, so a block looks in the editor exactly as it will on paper.
 *
 * Every number is read from the month's figures here — the report's document only says which figure goes where.
 */

/** the part of a saved report a figure reads */
export type FigureReport = { objective?: string | null; posts_explained?: unknown } | null

/** "1–31 October 2026" */
function shortPeriod(month: ReportData['month']): string {
  const { from, to } = monthRange(month)
  return `${Number(from.slice(8))}–${Number(to.slice(8))} ${monthLabel(month)}`
}

export default function SheetFigure({ figure, data, report, onHideTile }: {
  figure: Figure
  data: ReportData
  report: FigureReport
  /** in the editor only: a tile can be left out of the report */
  onHideTile?: (label: string) => void
}) {
  if (figure.kind === 'summary') {
    return (
      <div className="report-prose">
        <table>
          <thead><tr><th>Platform</th><th>Period</th><th>Followers</th><th>Objective</th></tr></thead>
          <tbody>
            {data.platforms.map(p => (
              <tr key={p.platform}>
                <td>{platformLabel(p.platform)}{p.handle ? ` · @${p.handle}` : ''}</td>
                <td>{shortPeriod(data.month)}</td>
                <td>{p.followers.end != null ? fmt(p.followers.end) : 'Not available'}{p.followers.gained != null ? ` (${p.followers.gained >= 0 ? '+' : ''}${fmt(p.followers.gained)})` : ''}</td>
                <td>{report?.objective || 'Not set'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (figure.kind === 'audience') {
    const a = data.audience
    if (!a) return null
    return (
      <>
        <h2>Audience</h2>
        <p className="pr-small">Age: {a.age.slice(0, 4).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>
        <p className="pr-small">Top cities: {a.cities.slice(0, 5).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>
        {a.engaged && <p className="pr-small">Who engaged this month: {a.engaged.age.slice(0, 4).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>}
      </>
    )
  }
  const p = data.platforms.find(x => x.platform === figure.platform)
  if (!p) return null
  switch (figure.kind) {
    case 'platform':
      return <h2 className="pr-plat"><PlatformIcon platform={p.platform} size={26} /> {platformLabel(p.platform)} at a Glance{p.handle ? <span> · @{p.handle}</span> : null}</h2>
    case 'tiles': {
      const tiles = tileList(p).filter(t => !figure.hide.includes(t.label))
      return (
        <div className="pr-tiles">
          {tiles.map(t => (
            <div key={t.label} className="pr-tile">
              {onHideTile && (
                <button type="button" className="pr-tile-x" title={`Leave “${t.label}” out of the report`} aria-label={`Leave ${t.label} out of the report`}
                  onMouseDown={e => e.preventDefault()} onClick={() => onHideTile(t.label)}><X className="h-3.5 w-3.5" aria-hidden /></button>
              )}
              <b>{t.label === 'Followers gained' && t.value != null && t.value > 0 ? '+' : ''}{fmt(t.value)}</b>
              <span>{t.label}</span>
              {t.was != null && <i>{change(t.value, t.was)?.text ? `${change(t.value, t.was)!.text} · ` : ''}last month {fmt(t.was)}</i>}
            </div>
          ))}
        </div>
      )
    }
    case 'daily':
      return <div className="pr-chart"><h3>Views each day</h3><DailyLine daily={p.daily} /></div>
    case 'compare':
      return (
        <div className="pr-chart">
          <h3>This month beside last month</h3>
          <CompareBars rows={[
            { label: 'Views', now: p.views, was: p.previous.views },
            { label: 'Accounts reached', now: p.reach, was: p.previous.reach },
            { label: 'Interactions', now: p.interactions, was: p.previous.interactions },
          ]} />
        </div>
      )
    case 'split': {
      const byKind = viewsByType(data.candidates ?? [], p.platform)
      return (
        <div className="pr-chart">
          {byKind.length > 1 && (
            <>
              <h3>Where this month’s posts were seen, by kind of post</h3>
              <SplitBar parts={byKind} unit="views" />
            </>
          )}
          {p.viewsFromFollowers != null && p.viewsFromNonFollowers != null && (
            <>
              <h3>Who saw it</h3>
              <SplitBar parts={[
                { label: 'People who do not follow yet', value: p.viewsFromNonFollowers, pct: p.viewsFromNonFollowers },
                { label: 'Followers', value: p.viewsFromFollowers, pct: p.viewsFromFollowers },
              ]} />
            </>
          )}
        </div>
      )
    }
    case 'posts':
      return (
        <>
          <h3>Top posts by views</h3>
          <div className="pr-posts">
            {p.topPosts.map((t, i) => (
              <div key={t.id} className="pr-post">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.thumbnail && (t.url ? <a href={t.url}><img src={t.thumbnail} alt="" referrerPolicy="no-referrer" /></a> : <img src={t.thumbnail} alt="" referrerPolicy="no-referrer" />)}
                <p><strong>{i + 1}. {fmt(t.views)} views</strong></p>
                <p className="pr-small">{fmt(t.likes)} likes · {fmt(t.comments)} comments · {fmt(t.shares)} shares</p>
                {t.url && <p className="pr-small"><a href={t.url}>See the post</a></p>}
              </div>
            ))}
          </div>
        </>
      )
    case 'why': {
      // the post breakdowns: each post's score and the one-line verdict
      const x = readPostsExplained(report?.posts_explained)
      const items = (x?.items ?? []).filter(i => i.breakdown)
      if (!items.length) return null
      const byId = new Map((x?.posts ?? []).map(post => [post.id, post]))
      return (
        <>
          <h3>Why the posts worked</h3>
          {items.map(i => {
            const post = byId.get(i.postId)
            return (
              <p key={i.postId} className="pr-small">
                <strong>{post?.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''} · score {i.index.score} ({i.index.multiple}× a typical post).</strong> {i.breakdown!.verdict}
                {post?.url && <> <a href={post.url}>See the post</a></>}
              </p>
            )
          })}
        </>
      )
    }
    default: return null
  }
}
