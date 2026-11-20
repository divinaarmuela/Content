'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { monthLabel, monthRange, type ReportData } from '../../lib/client-report-core'
import { sheetParts, type Figure, type SheetPart } from '../../lib/report-figures'
import SheetFigure from './SheetFigure'

/**
 * THE REPORT'S PDF (moved out of page.tsx, 19 Nov 2026, so the print view can be rendered and looked at by itself).
 * The print view is on the page but hidden; Preview shows it, and Download PDF sends it to be made into a file.
 */

/** the part of a saved report the PDF reads */
export type PdfReport = { body?: string | null; body_doc?: unknown; objective?: string | null; posts_explained?: unknown } | null

/* ── the PDF: the print view — the figures, the top posts, the audience and the report ── */

/** THE PRINT COPY: the sheet, straight under <body>, drawn only on paper (see PRINT_CSS for why it sits there) */
export function PrintReport(props: { data: ReportData; report: PdfReport; clientName: string }) {
  const [home, setHome] = useState<HTMLElement | null>(null)
  useEffect(() => { setHome(document.body) }, [])
  if (!home) return null
  return createPortal(<div id="report-print" className="dbx" aria-hidden><ReportSheet {...props} /></div>, home)
}

/** the two half-width charts sit side by side when they follow one another (as they always have) */
const HALF = new Set<Figure['kind']>(['compare', 'split'])
type Row = { type: 'html'; html: string } | { type: 'figure'; figure: Figure } | { type: 'pair'; figures: Figure[] }
function rows(parts: SheetPart[]): Row[] {
  const out: Row[] = []
  for (const part of parts) {
    const last = out[out.length - 1]
    if (part.type === 'figure' && HALF.has(part.figure.kind)) {
      if (last?.type === 'pair' && last.figures.length < 2 && last.figures[0].platform === part.figure.platform && last.figures[0].kind !== part.figure.kind) last.figures.push(part.figure)
      else out.push({ type: 'pair', figures: [part.figure] })
    } else out.push(part)
  }
  return out
}

/**
 * THE REPORT AS IT IS PRINTED — the cover, then the report top to bottom: its figures and its written parts in the
 * order the report's own document gives (20 Nov 2026, report-figures.ts), or the usual order for a report nobody has
 * rearranged.
 */
export function ReportSheet({ data, report, clientName, className = '' }: { data: ReportData; report: PdfReport; clientName: string; className?: string }) {
  // "1 October 2026 to 31 October 2026" on the cover
  const period = useMemo(() => {
    const { from, to } = monthRange(data.month)
    const d = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    return `${d(from)} to ${d(to)}`
  }, [data.month])
  const body = useMemo(() => rows(sheetParts(report, data)), [report, data])
  return (
    <div className={`report-sheet ${className}`}>
      {/* THE COVER (the owner, 19 Nov 2026, after the Basfoods report: "this is how the report should look like") */}
      <div className="pr-cover">
        {/* THE CLIENT'S OWN PICTURE (the owner, 19 Nov 2026: "client logos added … Zernio has that data"): the profile
            picture of their account, kept as our own copy when the figures are read */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.logo && <img className="pr-logo" src={data.logo} alt="" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
        <p className="pr-kicker">Social media monthly report</p>
        <h1>{clientName}</h1>
        <p className="pr-sub">Monthly Performance Review</p>
        <p className="pr-month">{period}</p>
        <p className="pr-by">Prepared by MD Media for {clientName}</p>
        <p className="pr-conf">Confidential | {monthLabel(data.month)}</p>
      </div>
      {body.map((row, i) => {
        if (row.type === 'html') return <div key={i} className="pr-block report-prose" dangerouslySetInnerHTML={{ __html: row.html }} />
        if (row.type === 'pair') {
          return (
            <div key={i} className={`pr-block pr-fig ${row.figures.length > 1 ? 'pr-charts' : ''}`}>
              {row.figures.map(f => <SheetFigure key={f.kind} figure={f} data={data} report={report} />)}
            </div>
          )
        }
        return <div key={i} className={`pr-block pr-fig pr-fig-${row.figure.kind}`}><SheetFigure figure={row.figure} data={data} report={report} /></div>
      })}
    </div>
  )
}

export { PRINT_CSS } from '../../lib/report-sheet-css'
