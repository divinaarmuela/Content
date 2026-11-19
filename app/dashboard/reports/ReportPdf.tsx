'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { readPostsExplained } from '../../lib/post-breakdown-core'
import { change, fmt, monthLabel, monthRange, platformLabel, type ReportData } from '../../lib/client-report-core'
import { reportBodyHtml } from '../../lib/report-doc'
import { REPORT_BLUE, REPORT_TILE, reportProseCss } from '../../lib/report-look'
import { viewsByType } from '../../lib/report-charts-core'
import PlatformIcon from '../social/PlatformIcon'
import { CompareBars, DailyLine, SplitBar } from './ReportCharts'

/**
 * THE REPORT'S PDF, AND THE REPORT'S STYLES (moved out of page.tsx, 19 Nov 2026, so the print view can be rendered and
 * looked at by itself). The print view is on the page but hidden; Download PDF prints it and nothing else.
 */

/** the part of a saved report the PDF reads */
export type PdfReport = { body?: string | null; body_doc?: unknown; objective?: string | null; posts_explained?: unknown } | null

/** the post breakdowns in the PDF: each post's score and the one-line verdict */
function PrintBreakdowns({ raw }: { raw: unknown }) {
  const x = readPostsExplained(raw)
  const items = (x?.items ?? []).filter(i => i.breakdown)
  if (!items.length) return null
  const byId = new Map((x?.posts ?? []).map(p => [p.id, p]))
  return (
    <>
      <h3>Why the posts worked</h3>
      {items.map(i => {
        const p = byId.get(i.postId)
        return (
          <p key={i.postId} className="pr-small">
            <strong>{p?.publishedAt ? new Date(p.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''} · score {i.index.score} ({i.index.multiple}× a typical post).</strong> {i.breakdown!.verdict}
            {p?.url && <> <a href={p.url}>See the post</a></>}
          </p>
        )
      })}
    </>
  )
}

/* ── the PDF: the print view — the figures, the top posts, the audience and the report ── */

/** THE PRINT COPY: the sheet, straight under <body>, drawn only on paper (see PRINT_CSS for why it sits there) */
export function PrintReport(props: { data: ReportData; report: PdfReport; clientName: string }) {
  const [home, setHome] = useState<HTMLElement | null>(null)
  useEffect(() => { setHome(document.body) }, [])
  if (!home) return null
  return createPortal(<div id="report-print" className="dbx" aria-hidden><ReportSheet {...props} /></div>, home)
}

/** THE REPORT AS IT IS PRINTED — the cover, each account's figures and charts, the top posts, then the written report */
export function ReportSheet({ data, report, clientName, className = '' }: { data: ReportData; report: PdfReport; clientName: string; className?: string }) {
  // "1 October 2026 to 31 October 2026" on the cover, "1–31 October 2026" in the table
  const period = useMemo(() => {
    const { from, to } = monthRange(data.month)
    const d = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    return { long: `${d(from)} to ${d(to)}`, short: `${Number(from.slice(8))}–${Number(to.slice(8))} ${monthLabel(data.month)}` }
  }, [data.month])
  return (
    <div className={`report-sheet ${className}`}>
      {/* THE COVER, THE SUMMARY ROW AND THE FIGURE TILES (the owner, 19 Nov 2026, after the Basfoods report: "this is how
          the report should look like"). Every number here is the page's own figure — none is typed. */}
      <div className="pr-cover">
        {/* THE CLIENT'S OWN PICTURE (the owner, 19 Nov 2026: "client logos added … Zernio has that data"): the profile
            picture of their account, kept as our own copy when the figures are read */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.logo && <img className="pr-logo" src={data.logo} alt="" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
        <p className="pr-kicker">Social media monthly report</p>
        <h1>{clientName}</h1>
        <p className="pr-sub">Monthly Performance Review</p>
        <p className="pr-month">{period.long}</p>
        <p className="pr-by">Prepared by MD Media for {clientName}</p>
        <p className="pr-conf">Confidential | {monthLabel(data.month)}</p>
      </div>
      {data.platforms.length > 0 && (
        <div className="pr-block report-prose">
          <table>
            <thead><tr><th>Platform</th><th>Period</th><th>Followers</th><th>Objective</th></tr></thead>
            <tbody>
              {data.platforms.map(p => (
                <tr key={p.platform}>
                  <td>{platformLabel(p.platform)}{p.handle ? ` · @${p.handle}` : ''}</td>
                  <td>{period.short}</td>
                  <td>{p.followers.end != null ? fmt(p.followers.end) : 'Not available'}{p.followers.gained != null ? ` (${p.followers.gained >= 0 ? '+' : ''}${fmt(p.followers.gained)})` : ''}</td>
                  <td>{report?.objective || 'Not set'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.platforms.map(p => (
        <div key={p.platform} className="pr-block">
          <h2 className="pr-plat"><PlatformIcon platform={p.platform} size={26} /> {platformLabel(p.platform)} at a Glance{p.handle ? <span> · @{p.handle}</span> : null}</h2>
          <div className="pr-tiles">
            {([
              ['Views', p.views, p.previous.views],
              ['Accounts reached', p.reach, p.previous.reach],
              ['Interactions', p.interactions, p.previous.interactions],
              ['Followers gained', p.followers.gained, p.followers.previousGained ?? null],
              ...(p.platform === 'instagram' ? [['Profile visits', p.profileVisits, null], ['Bio link taps', p.linkTaps, null]] as const : []),
            ] as [string, number | null, number | null][]).map(([l, v, w]) => (
              <div key={l} className="pr-tile">
                <b>{l === 'Followers gained' && v != null && v > 0 ? '+' : ''}{fmt(v)}</b>
                <span>{l}</span>
                {w != null && <i>{change(v, w)?.text ? `${change(v, w)!.text} · ` : ''}last month {fmt(w)}</i>}
              </div>
            ))}
          </div>
          {/* THE CHARTS (the owner, 19 Nov 2026: "add beautifully designed charts") — each drawn from the figures above */}
          {p.daily.some(d => d.views > 0) && (
            <div className="pr-chart">
              <h3>Views each day</h3>
              <DailyLine daily={p.daily} />
            </div>
          )}
          <div className="pr-charts">
            {[p.previous.views, p.previous.reach, p.previous.interactions].some(v => v != null) && (
              <div className="pr-chart">
                <h3>This month beside last month</h3>
                <CompareBars rows={[
                  { label: 'Views', now: p.views, was: p.previous.views },
                  { label: 'Accounts reached', now: p.reach, was: p.previous.reach },
                  { label: 'Interactions', now: p.interactions, was: p.previous.interactions },
                ]} />
              </div>
            )}
            <div className="pr-chart">
              {viewsByType(data.candidates ?? [], p.platform).length > 1 && (
                <>
                  <h3>Where this month’s posts were seen, by kind of post</h3>
                  <SplitBar parts={viewsByType(data.candidates ?? [], p.platform)} unit="views" />
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
          </div>
          {p.topPosts.length > 0 && (
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
          )}
          {p.platform === 'instagram' && <PrintBreakdowns raw={report?.posts_explained} />}
        </div>
      ))}
      {data.audience && (
        <div className="pr-block">
          <h2>Audience</h2>
          <p className="pr-small">Age: {data.audience.age.slice(0, 4).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>
          <p className="pr-small">Top cities: {data.audience.cities.slice(0, 5).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>
          {data.audience.engaged && <p className="pr-small">Who engaged this month: {data.audience.engaged.age.slice(0, 4).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>}
        </div>
      )}
      {report?.body && <div className="pr-block report-prose" dangerouslySetInnerHTML={{ __html: reportBodyHtml(report) }} />}
    </div>
  )
}

/**
 * THE SHEET'S LOOK, ON SCREEN AND ON PAPER (19 Nov 2026). These rules used to live inside `@media print`, so the only
 * way to see the PDF was to print it. They are the sheet's own now: the preview draws the very same sheet.
 *
 * THE EMPTY PAGES (the owner, 19 Nov 2026: "look at how many empty pages"). Print used to HIDE the rest of the page
 * (`visibility:hidden`), and a hidden thing still takes its room: the whole Reports page — figures, posts, the editor —
 * was printed as blank paper after the report. The sheet now sits straight under <body> (a portal) and print takes
 * everything else OFF the page (`display:none`), so the PDF is the report and nothing after it.
 */
export const PRINT_CSS = `${reportProseCss('.report-prose')}
.report-sheet{color:#0a0a0a;background:#fff;font-family:inherit}
.report-sheet a{color:${REPORT_BLUE};text-decoration:underline;text-underline-offset:3px}
.report-sheet .report-prose h2,.report-sheet .report-prose h3,.report-sheet .report-prose h4{color:inherit;break-after:avoid}
.report-sheet .report-prose h3,.report-sheet .report-prose h4{color:${REPORT_BLUE}}
.report-sheet .report-prose tr,.report-sheet .report-prose img,.report-sheet .pr-post,.report-sheet .pr-posts{break-inside:avoid}
.report-sheet .pr-block > h2,.report-sheet .pr-block > h3{break-after:avoid}
.report-sheet .pr-cover{text-align:center;padding:26px 0 22px;margin-bottom:8px}
.report-sheet .pr-kicker{font-size:19px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${REPORT_BLUE};margin:0}
.report-sheet .pr-cover h1{font-size:44px;font-weight:800;letter-spacing:.01em;text-transform:uppercase;margin:16px 0 10px;line-height:1.1}
.report-sheet .pr-sub{font-size:19px;font-weight:700;margin:0 0 12px}
.report-sheet .pr-month{font-size:15px;color:#666;margin:0 0 22px}
.report-sheet .pr-by{font-size:14px;margin:0 0 10px}
.report-sheet .pr-conf{font-size:12px;color:#777;margin:0}
.report-sheet .pr-block > h2{font-size:22px;font-weight:700;margin:0 0 10px;padding-bottom:6px;border-bottom:3px solid ${REPORT_BLUE}}
.report-sheet .pr-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin:0 0 6px}
.report-sheet .pr-tile{background:${REPORT_TILE};padding:11px 6px 9px;text-align:center;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.report-sheet .pr-tile b{display:block;font-size:21px;font-weight:700;line-height:1.15;color:${REPORT_BLUE}}
.report-sheet .pr-tile span{display:block;font-size:9px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#555;margin-top:2px}
.report-sheet .pr-tile i{display:block;font-size:9px;font-style:normal;color:#777;margin-top:2px}
.report-sheet .pr-note{font-size:11px;font-style:italic;color:#666;margin:4px 0 0}
.report-sheet .pr-logo{width:84px;height:84px;border-radius:50%;object-fit:cover;margin:0 auto 16px;display:block;border:1px solid #e5e5e5}
.report-sheet .pr-plat{display:flex;align-items:center;gap:9px}
.report-sheet .pr-plat span[role=img]{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.report-sheet .pr-plat > span:not([role=img]){font-weight:400;color:#666}
.report-sheet .pr-charts{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
.report-sheet .pr-chart{break-inside:avoid;margin-top:6px}
.report-sheet .pr-chart svg{max-width:100%;height:auto}
.report-sheet .pr-chart h3{font-size:12px;font-weight:700;color:#1b1b1b;margin:12px 0 6px}
.report-sheet .report-prose td{border-color:#d9d9d9}
.report-sheet .pr-block{margin:0 0 22px}
.report-sheet .pr-block > h3{font-size:14px;font-weight:700;color:${REPORT_BLUE};margin:14px 0 6px}
.report-sheet .pr-posts{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.report-sheet .pr-post img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px}
.report-sheet .pr-post p{margin:4px 0 0;font-size:11px}
.report-sheet .pr-small{font-size:11px;color:#555}
#report-print{display:none}
@media print{
  @page{size:A4;margin:16mm}
  html,body{background:#fff !important;height:auto !important}
  body > *:not(#report-print){display:none !important}
  #report-print{display:block !important}
}
/* the preview: the sheet as a page on the screen */
.report-sheet-screen{width:210mm;max-width:100%;margin:0 auto;padding:16mm;box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 30px rgba(0,0,0,.10);border-radius:4px}
@media (max-width:640px){.report-sheet-screen{padding:18px}.report-sheet .pr-tiles{grid-template-columns:repeat(2,1fr)}.report-sheet .pr-charts{grid-template-columns:1fr}.report-sheet .pr-posts{grid-template-columns:repeat(3,1fr)}.report-sheet .pr-cover h1{font-size:30px}}
`
