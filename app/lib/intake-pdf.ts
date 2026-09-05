import 'server-only'
import PDFDocument from 'pdfkit'
import type { Answers, TemplateDefinition } from './intake-core'
import { completion } from './intake-core'

/**
 * The completed intake form as a PDF, attached to the submission email.
 *
 * The point is that it reads like the brief it is: something you open on a
 * phone before a kickoff call, or forward to whoever is running the shoot,
 * without needing a dashboard login. Same zinc/blue system as the leads
 * report, drawn with pdfkit's built-in Helvetica so it is serverless-safe.
 *
 * Unanswered questions are printed too, greyed and marked. A brief that
 * silently omits what the client skipped reads as complete when it is not,
 * and the gaps are exactly what the kickoff call is for.
 */

const INK = '#18181b'
const DIM = '#71717a'
const FAINT = '#a1a1aa'
const LINE = '#e4e4e7'
const BLUE = '#2563eb'
const PAGE = { width: 595.28, height: 841.89, margin: 48 } // A4

/* One rhythm for every question, answered or not — the gaps are named so the
 * measurement and the drawing cannot drift apart again. */
const LABEL_GAP = 1          // between wrapped lines of a question
const ANSWER_GAP = 2         // between wrapped lines of an answer
const LABEL_TO_ANSWER = 5    // question to its answer
const BLOCK_GAP = 16         // answer to the next question

export type IntakePdfData = {
  clientName: string
  formTitle: string
  templateKey: string
  definition: TemplateDefinition
  answers: Answers
  files: { block_id: string; filename: string; url: string }[]
  submittedAt: Date
}

export function renderIntakePdf(data: IntakePdfData): Promise<Buffer> {
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
      .text('MD MEDIA · CLIENT INTAKE', PAGE.margin, 60)
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
        const files = data.files.filter(f => f.block_id === block.id)
        const answered =
          Array.isArray(raw) ? raw.length > 0
          : typeof raw === 'string' ? raw.trim() !== ''
          : false

        const text = files.length > 0
          ? files.map(f => `${f.filename}  —  ${f.url}`).join('\n')
          : Array.isArray(raw) ? raw.join(', ')
          : (raw ?? '')

        const has = answered || files.length > 0
        const body = has ? String(text) : 'Not answered'
        /* Measure with the FONT AND OPTIONS THE TEXT IS DRAWN WITH.
         *
         * These two calls used to disagree twice over: an unanswered line is
         * drawn in Helvetica-Oblique but was measured in Helvetica, and every
         * answer is drawn with `lineGap: 2` that the measurement did not know
         * about — so a wrapped answer was measured short by two points a line
         * and the next question was pulled up into it. Unanswered questions
         * showed it worst, because a one-line "Not answered" between two bold
         * labels left almost nothing between the two. */
        const answerFont = has ? 'Helvetica' : 'Helvetica-Oblique'
        const qH = doc.font('Helvetica-Bold').fontSize(9)
          .heightOfString(block.label, { width: contentW, lineGap: LABEL_GAP })
        const aH = doc.font(answerFont).fontSize(10)
          .heightOfString(body, { width: contentW, lineGap: ANSWER_GAP })
        y = room(qH + LABEL_TO_ANSWER + aH + BLOCK_GAP, y)

        doc.fillColor(DIM).font('Helvetica-Bold').fontSize(9)
          .text(block.label, PAGE.margin, y, { width: contentW, lineGap: LABEL_GAP })
        y += qH + LABEL_TO_ANSWER

        doc.fillColor(has ? INK : FAINT)
          .font(answerFont)
          .fontSize(10)
          .text(body, PAGE.margin, y, { width: contentW, lineGap: ANSWER_GAP })
        y += aH + BLOCK_GAP
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
          `${data.clientName} · intake · ${i + 1}/${range.count}`,
          PAGE.margin, PAGE.height - 32,
          { width: contentW, align: 'center' },
        )
    }

    doc.end()
  })
}
