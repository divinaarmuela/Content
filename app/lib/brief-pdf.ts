import 'server-only'
import PDFDocument from 'pdfkit'
import type { PlannedDeliverable, ShotRow } from './batch-brief-core'

/**
 * Shoot-brief PDF — the brief as a hand-out: client, date, location,
 * concept, deliverables, and the shot list with capture ticks. Same visual
 * system as the leads report (pdfkit, built-in Helvetica, serverless-safe).
 */

const INK = '#18181b'
const DIM = '#71717a'
const FAINT = '#a1a1aa'
const LINE = '#e4e4e7'
const BLUE = '#2563eb'
const PAGE = { width: 595.28, height: 841.89, margin: 48 } // A4

export type BriefPdfData = {
  title: string
  clientName: string
  statusLabel: string
  shootDate: string | null
  location: string | null
  concept: string | null
  deliverables: PlannedDeliverable[]
  shotList: ShotRow[]
}

export function renderBriefPdf(data: BriefPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const contentW = PAGE.width - PAGE.margin * 2
    const ensureRoom = (needed: number) => {
      if (doc.y + needed > PAGE.height - PAGE.margin) doc.addPage()
    }

    // ─── Header band ───
    doc.rect(0, 0, PAGE.width, 110).fill(INK)
    doc.rect(0, 110, PAGE.width, 3).fill(BLUE)
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
      .text('Shoot Brief', PAGE.margin, 34)
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text('MD MEDIA · PRODUCTION', PAGE.margin, 62)
    doc.fillColor('#ffffff').font('Helvetica').fontSize(11)
      .text(`${data.clientName} — ${data.title}`, PAGE.margin, 78, { width: contentW })
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text(data.statusLabel.toUpperCase(), PAGE.margin, 40, { width: contentW, align: 'right' })

    doc.y = 140
    doc.x = PAGE.margin

    // ─── Facts row ───
    const dateLabel = data.shootDate
      // the plain date is already local wall-clock; naming the zone keeps it
      // from drifting a day when this renders on a UTC server
      ? new Date(`${data.shootDate}T00:00:00`).toLocaleDateString('en-AU', {
          timeZone: 'Australia/Melbourne',
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      : 'To be confirmed'
    const facts: [string, string][] = [
      ['SHOOT DATE', dateLabel],
      ['LOCATION', data.location || 'To be confirmed'],
    ]
    const factW = contentW / facts.length
    const factsY = doc.y
    facts.forEach(([label, value], i) => {
      const x = PAGE.margin + i * factW
      doc.fillColor(FAINT).font('Courier').fontSize(7.5).text(label, x, factsY)
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(value, x, factsY + 12, { width: factW - 12 })
    })
    doc.y = factsY + 44

    const section = (title: string) => {
      ensureRoom(60)
      doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.width - PAGE.margin, doc.y).lineWidth(0.5).stroke(LINE)
      doc.y += 10
      doc.fillColor(FAINT).font('Courier').fontSize(8).text(title, PAGE.margin, doc.y)
      doc.y += 16
    }

    // ─── Concept ───
    if (data.concept?.trim()) {
      section('CONCEPT & NOTES')
      doc.fillColor(INK).font('Helvetica').fontSize(10)
        .text(data.concept.trim(), PAGE.margin, doc.y, { width: contentW, lineGap: 3 })
      doc.y += 18
    }

    // ─── Deliverables ───
    if (data.deliverables.length > 0) {
      section('PLANNED DELIVERABLES')
      for (const d of data.deliverables) {
        ensureRoom(18)
        doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10)
          .text(String(d.qty), PAGE.margin, doc.y, { continued: true, width: contentW })
        doc.fillColor(INK).font('Helvetica').fontSize(10)
          .text(`  ${d.type}${d.qty > 1 ? 's' : ''}`)
        doc.y += 4
      }
      doc.y += 12
    }

    // ─── Shot list ───
    if (data.shotList.length > 0) {
      const done = data.shotList.filter(r => r.done).length
      section(done > 0 ? `SHOT LIST · ${done}/${data.shotList.length} CAPTURED` : 'SHOT LIST')
      for (const r of data.shotList) {
        ensureRoom(20)
        const y = doc.y
        doc.rect(PAGE.margin, y + 1, 9, 9).lineWidth(0.8).stroke(r.done ? BLUE : FAINT)
        if (r.done) {
          doc.moveTo(PAGE.margin + 2, y + 5.5).lineTo(PAGE.margin + 4, y + 8)
            .lineTo(PAGE.margin + 7.5, y + 3).lineWidth(1.1).stroke(BLUE)
        }
        doc.fillColor(r.done ? DIM : INK).font('Helvetica').fontSize(10)
          .text(
            `${r.text}${r.qty ? `  ×${r.qty}` : ''}${r.type ? `  (${r.type})` : ''}`,
            PAGE.margin + 18, y, { width: contentW - 18 },
          )
        doc.y = Math.max(doc.y, y + 14)
      }
    }

    // ─── Footer on every page ───
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      // the footer sits INSIDE the bottom margin — pdfkit treats any text
      // past the margin as overflow and silently appends a blank page per
      // footer line. Zero the margin while stamping, and never line-break.
      const savedBottom = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc.fillColor(FAINT).font('Courier').fontSize(7)
        .text(
          `MD MEDIA · SHOOT BRIEF · ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne' })}`,
          PAGE.margin, PAGE.height - 34, { width: contentW, lineBreak: false },
        )
      doc.text(`${i - range.start + 1} / ${range.count}`, PAGE.margin, PAGE.height - 34, {
        width: contentW, align: 'right', lineBreak: false,
      })
      doc.page.margins.bottom = savedBottom
    }
    doc.end()
  })
}
