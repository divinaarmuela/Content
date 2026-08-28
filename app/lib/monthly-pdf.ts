import 'server-only'
import PDFDocument from 'pdfkit'
import type { Answers, TemplateDefinition } from './intake-core'
import { completion } from './intake-core'

/**
 * The completed monthly update as a PDF, attached to the submission email that
 * goes to the chosen TEAM members (never the client).
 *
 * Modelled on intake-pdf.ts: same zinc/blue system, pdfkit's built-in Helvetica
 * so it is serverless-safe, unanswered questions printed greyed and marked so a
 * brief never reads as more complete than it is. The monthly form has no file
 * blocks, so there is no attachments column here.
 */

const INK = '#18181b'
const DIM = '#71717a'
const FAINT = '#a1a1aa'
const LINE = '#e4e4e7'
const BLUE = '#2563eb'
const PAGE = { width: 595.28, height: 841.89, margin: 48 } // A4

export type MonthlyPdfData = {
  clientName: string
  formTitle: string
  definition: TemplateDefinition
  answers: Answers
  submittedAt: Date
}

export function renderMonthlyPdf(data: MonthlyPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const contentW = PAGE.width - PAGE.margin * 2
    const bottom = PAGE.height - PAGE.margin
    const progress = completion(data.definition, data.answers)

    /** Start a new page when the next block would run off this one. Called
     *  before drawing, never after — a heading stranded at the foot of a page
     *  with its answer overleaf is the classic generated-PDF tell. */
    const room = (needed: number, y: number): number => {
      if (y + needed <= bottom) return y
      doc.addPage()
      return PAGE.margin
    }

    // ─── Header band ───
    doc.rect(0, 0, PAGE.width, 118).fill(INK)
    doc.rect(0, 118, PAGE.width, 3).fill(BLUE)
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
      .text(data.clientName, PAGE.margin, 30, { width: contentW })
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text('MD MEDIA · MONTHLY UPDATE', PAGE.margin, 60)
    doc.fillColor('#ffffff').font('Helvetica').fontSize(11)
      .text(data.formTitle, PAGE.margin, 78, { width: contentW })
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text(
        `${progress.answered} OF ${progress.total} ANSWERED · ${data.submittedAt
          .toISOString().slice(0, 10)}`,
        PAGE.margin, 96,
      )

    let y = 150

    for (const section of data.definition.sections) {
      const blocks = section.blocks.filter(b => b.type !== 'guidance')
      if (blocks.length === 0) continue

      // keep the section heading with at least its first question
      y = room(90, y)

      doc.fillColor(BLUE).font('Courier').fontSize(7)
        .text(section.title.toUpperCase(), PAGE.margin, y)
      y += 14
      doc.moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y)
        .lineWidth(0.75).stroke(LINE)
      y += 14

      for (const block of blocks) {
        const raw = data.answers[block.id]
        const answered =
          Array.isArray(raw) ? raw.length > 0
          : typeof raw === 'string' ? raw.trim() !== ''
          : false

        const text = Array.isArray(raw) ? raw.join(', ') : (raw ?? '')
        const body = answered ? String(text) : 'Not answered'
        const qH = doc.font('Helvetica-Bold').fontSize(9).heightOfString(block.label, { width: contentW })
        const aH = doc.font('Helvetica').fontSize(10).heightOfString(body, { width: contentW })
        y = room(qH + aH + 22, y)

        doc.fillColor(DIM).font('Helvetica-Bold').fontSize(9)
          .text(block.label, PAGE.margin, y, { width: contentW })
        y += qH + 4

        doc.fillColor(answered ? INK : FAINT)
          .font(answered ? 'Helvetica' : 'Helvetica-Oblique')
          .fontSize(10)
          .text(body, PAGE.margin, y, { width: contentW, lineGap: 2 })
        y += aH + 14
      }

      y += 8
    }

    // ─── Page numbers, added last so the count is known ───
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      // The footer sits below the bottom margin; writing there would trigger
      // pdfkit's auto page-break and spawn a blank page per footer. Lift the
      // margin while stamping so the text stays on this page.
      doc.page.margins.bottom = 0
      doc.fillColor(FAINT).font('Courier').fontSize(7)
        .text(
          `${data.clientName} · monthly update · ${i + 1}/${range.count}`,
          PAGE.margin, PAGE.height - 32,
          { width: contentW, align: 'center' },
        )
    }

    doc.end()
  })
}
