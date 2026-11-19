'use client'

import { useMemo } from 'react'
import { readPostsExplained } from '../../lib/post-breakdown-core'
import { change, fmt, monthLabel, monthRange, platformLabel, reportHtml, type ReportData } from '../../lib/client-report-core'
import { REPORT_BLUE, REPORT_TILE, reportProseCss } from '../../lib/report-look'

/**
 * THE REPORT'S PDF, AND THE REPORT'S STYLES (moved out of page.tsx, 19 Nov 2026, so the print view can be rendered and
 * looked at by itself). The print view is on the page but hidden; Download PDF prints it and nothing else.
 */

/** the part of a saved report the PDF reads */
export type PdfReport = { body?: string | null; objective?: string | null; posts_explained?: unknown } | null

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

export function PrintReport({ data, report, clientName }: { data: ReportData; report: PdfReport; clientName: string }) {
  // "1 October 2026 to 31 October 2026" on the cover, "1–31 October 2026" in the table
  const period = useMemo(() => {
    const { from, to } = monthRange(data.month)
    const d = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    return { long: `${d(from)} to ${d(to)}`, short: `${Number(from.slice(8))}–${Number(to.slice(8))} ${monthLabel(data.month)}` }
  }, [data.month])
  return (
    <div id="report-print" aria-hidden>
      {/* THE COVER, THE SUMMARY ROW AND THE FIGURE TILES (the owner, 19 Nov 2026, after the Basfoods report: "this is how
          the report should look like"). Every number here is the page's own figure — none is typed. */}
      <div className="pr-cover">
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
          <h2>{platformLabel(p.platform)} at a Glance{p.handle ? ` · @${p.handle}` : ''}</h2>
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
          {p.viewsFromFollowers != null && <p className="pr-note">Views from followers {p.viewsFromFollowers}% · from people who do not follow yet {p.viewsFromNonFollowers}%</p>}
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
      {report?.body && <div className="pr-block report-prose" dangerouslySetInnerHTML={{ __html: reportHtml(report.body) }} />}
    </div>
  )
}

export const PRINT_CSS = `${reportProseCss('.report-prose')}
#report-print a{color:${REPORT_BLUE};text-decoration:underline;text-underline-offset:3px}
#report-print{display:none}
@media print{
  @page{size:A4;margin:16mm}
  body *{visibility:hidden}
  #report-print,#report-print *{visibility:visible}
  #report-print{display:block;position:absolute;left:0;top:0;width:100%;color:#0a0a0a;background:#fff;font-family:inherit}
  .pr-cover{text-align:center;padding:26px 0 22px;margin-bottom:8px}
  .pr-kicker{font-size:19px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${REPORT_BLUE};margin:0}
  .pr-cover h1{font-size:44px;font-weight:800;letter-spacing:.01em;text-transform:uppercase;margin:16px 0 10px;line-height:1.1}
  .pr-sub{font-size:19px;font-weight:700;margin:0 0 12px}
  .pr-month{font-size:15px;color:#666;margin:0 0 22px}
  .pr-by{font-size:14px;margin:0 0 10px}
  .pr-conf{font-size:12px;color:#777;margin:0}
  .pr-block > h2{font-size:22px;font-weight:700;margin:0 0 10px;padding-bottom:6px;border-bottom:3px solid ${REPORT_BLUE}}
  .pr-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin:0 0 6px}
  .pr-tile{background:${REPORT_TILE};padding:11px 6px 9px;text-align:center;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pr-tile b{display:block;font-size:21px;font-weight:700;line-height:1.15;color:${REPORT_BLUE}}
  .pr-tile span{display:block;font-size:9px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#555;margin-top:2px}
  .pr-tile i{display:block;font-size:9px;font-style:normal;color:#777;margin-top:2px}
  .pr-note{font-size:11px;font-style:italic;color:#666;margin:4px 0 0}
  .report-prose td{border-color:#d9d9d9}
  .pr-block{margin:0 0 22px;break-inside:avoid-page}
  .pr-block > h3{font-size:14px;font-weight:700;color:${REPORT_BLUE};margin:14px 0 6px}
  .pr-posts{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
  .pr-post img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px}
  .pr-post p{margin:4px 0 0;font-size:11px}
  .pr-small{font-size:11px;color:#555}
}
`
