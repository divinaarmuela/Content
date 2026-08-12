import 'server-only'
import PDFDocument from 'pdfkit'
import type { LeadsReportData } from './report-data'

/**
 * Branded leads report PDF — MD Media zinc/blue system, drawn with pdfkit
 * (pure JS, serverless-safe, built-in Helvetica).
 */

const INK = '#18181b'
const DIM = '#71717a'
const FAINT = '#a1a1aa'
const LINE = '#e4e4e7'
const BLUE = '#2563eb'
const BLUE_SOFT = '#eff6ff'
const PAGE = { width: 595.28, height: 841.89, margin: 48 } // A4

export function renderLeadsReportPdf(data: LeadsReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const contentW = PAGE.width - PAGE.margin * 2
    let y = PAGE.margin

    // ─── Header band ───
    doc.rect(0, 0, PAGE.width, 110).fill(INK)
    doc.rect(0, 110, PAGE.width, 3).fill(BLUE)
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
      .text('Leads Report', PAGE.margin, 34)
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text('MD MEDIA · MARKETING', PAGE.margin, 62)
    doc.fillColor('#ffffff').font('Helvetica').fontSize(11)
      .text(data.monthLabel, PAGE.margin, 78)
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text(`PERIOD ${data.periodStart} — ${data.periodEnd}`, PAGE.margin, 78, {
        width: contentW, align: 'right',
      })
    y = 140

    // ─── KPI row ───
    const kpis = [
      { label: 'TOTAL LEADS', value: String(data.totals.leads) },
      { label: 'WEBSITE FORM', value: String(data.totals.fromForm) },
      { label: 'INBOX SCANNER', value: String(data.totals.fromInbox) },
      { label: 'NEW PROSPECTS', value: String(data.totals.prospectsCreated) },
    ]
    const kpiW = (contentW - 12 * 3) / 4
    kpis.forEach((k, i) => {
      const x = PAGE.margin + i * (kpiW + 12)
      doc.roundedRect(x, y, kpiW, 64, 6).lineWidth(0.75).stroke(LINE)
      doc.fillColor(FAINT).font('Courier').fontSize(6.5).text(k.label, x + 10, y + 10)
      doc.fillColor(i === 0 ? BLUE : INK).font('Helvetica-Bold').fontSize(24)
        .text(k.value, x + 10, y + 24)
    })
    y += 88

    // ─── Source split bar ───
    sectionTitle(doc, 'Where leads came from', y); y += 22
    if (data.totals.leads > 0) {
      const formFrac = data.totals.fromForm / data.totals.leads
      doc.roundedRect(PAGE.margin, y, contentW, 14, 4).fill('#f4f4f5')
      if (formFrac > 0) {
        doc.roundedRect(PAGE.margin, y, Math.max(8, contentW * formFrac), 14, 4).fill(BLUE)
      }
      y += 22
      legend(doc, PAGE.margin, y, BLUE, `Website form — ${data.totals.fromForm}`)
      legend(doc, PAGE.margin + 180, y, '#d4d4d8', `Inbox scanner — ${data.totals.fromInbox}`)
      y += 26
    } else {
      doc.fillColor(DIM).font('Helvetica').fontSize(9.5)
        .text('No leads recorded in this period.', PAGE.margin, y)
      y += 24
    }

    // ─── Service interest ───
    // Labels wrap rather than truncate — every entry is shown in full, and
    // rows grow to fit. Long service names are common in real enquiries.
    if (data.byService.length > 0) {
      sectionTitle(doc, 'Service interest', y); y += 22
      const maxCount = Math.max(...data.byService.map(s => s.count))
      const labelW = 190
      const barMax = contentW - labelW - 50
      for (const s of data.byService) {
        doc.font('Helvetica').fontSize(9)
        const labelH = doc.heightOfString(s.label, { width: labelW })
        const rowH = Math.max(18, labelH + 8)
        if (y + rowH > PAGE.height - PAGE.margin - 20) { doc.addPage(); y = PAGE.margin }
        doc.fillColor(INK).font('Helvetica').fontSize(9)
          .text(s.label, PAGE.margin, y + 1, { width: labelW })
        const w = Math.max(6, (s.count / maxCount) * barMax)
        doc.roundedRect(PAGE.margin + labelW + 10, y + 1, w, 10, 3).fill(BLUE)
        doc.fillColor(DIM).font('Courier').fontSize(8)
          .text(String(s.count), PAGE.margin + labelW + 16 + w, y + 2)
        y += rowH
      }
      y += 12
    }

    // ─── Inbox scanner health ───
    sectionTitle(doc, 'Inbox scanner', y); y += 22
    doc.roundedRect(PAGE.margin, y, contentW, 40, 6).fill(BLUE_SOFT)
    doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(
      `${data.totals.inboxScanned} emails screened this period · ` +
      `${data.totals.fromInbox} became leads · ` +
      `${data.totals.inboxSkipped} filtered out (newsletters, non-enquiries)`,
      PAGE.margin + 14, y + 14, { width: contentW - 28 }
    )
    y += 62

    // ─── Lead register ───
    if (data.leads.length > 0) {
      sectionTitle(doc, `Lead register (${data.leads.length})`, y); y += 20
      // Column widths include a gutter; text wraps inside `tw` so nothing is
      // ever cut off — rows grow to fit the tallest cell.
      const cols = [
        { key: 'date', label: 'DATE', w: 46, tw: 40 },
        { key: 'name', label: 'NAME', w: 104, tw: 96 },
        { key: 'business', label: 'BUSINESS', w: 116, tw: 108 },
        { key: 'service', label: 'INTEREST', w: 132, tw: 124 },
        { key: 'source', label: 'SOURCE', w: 50, tw: 46 },
      ] as const

      const drawHead = () => {
        let x = PAGE.margin
        doc.fillColor(FAINT).font('Courier').fontSize(6.5)
        for (const c of cols) { doc.text(c.label, x, y, { width: c.tw }); x += c.w }
        y += 12
        doc.moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).lineWidth(0.75).stroke(LINE)
        y += 6
      }
      drawHead()

      for (const lead of data.leads) {
        // measure the tallest wrapped cell to size this row
        let rowH = 0
        for (const c of cols) {
          const val = String(lead[c.key] ?? '')
          if (c.key === 'source') doc.font('Courier').fontSize(7.5)
          else doc.font('Helvetica').fontSize(8.5)
          rowH = Math.max(rowH, doc.heightOfString(val, { width: c.tw }))
        }
        rowH = Math.max(14, rowH) + 5

        if (y + rowH > PAGE.height - PAGE.margin - 20) {
          doc.addPage(); y = PAGE.margin; drawHead()
        }

        let x = PAGE.margin
        for (const c of cols) {
          const val = String(lead[c.key] ?? '')
          if (c.key === 'source') {
            doc.fillColor(lead.source === 'Inbox' ? BLUE : DIM).font('Courier').fontSize(7.5)
          } else {
            doc.fillColor(c.key === 'name' ? INK : DIM).font('Helvetica').fontSize(8.5)
          }
          doc.text(val, x, y, { width: c.tw })
          x += c.w
        }
        y += rowH
        doc.moveTo(PAGE.margin, y - 3).lineTo(PAGE.width - PAGE.margin, y - 3)
          .lineWidth(0.4).stroke('#f4f4f5')
      }
    }

    // ─── Footer on every page ───
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      // Footer sits below the bottom margin — lift it so pdfkit doesn't
      // auto-page-break and stamp the footer onto a spawned blank page.
      doc.page.margins.bottom = 0
      doc.fillColor(FAINT).font('Courier').fontSize(7)
        .text(
          `MD MEDIA · get seen · get known · get booked · page ${i + 1}/${range.count}`,
          PAGE.margin, PAGE.height - 30, { width: contentW, align: 'center' }
        )
    }

    doc.end()
  })
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  doc.fillColor('#3f3f46').font('Helvetica-Bold').fontSize(11).text(title, PAGE.margin, y)
}

function legend(doc: PDFKit.PDFDocument, x: number, y: number, color: string, label: string) {
  doc.circle(x + 4, y + 4, 4).fill(color)
  doc.fillColor(DIM).font('Helvetica').fontSize(8.5).text(label, x + 14, y)
}

