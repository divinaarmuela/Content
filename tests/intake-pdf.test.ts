import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { renderIntakePdf } from '../app/lib/intake-pdf'
import type { TemplateDefinition } from '../app/lib/intake-core'

/** Page dictionaries are written uncompressed by pdfkit, so the page count
 *  is countable straight off the buffer. `/Page` must not match `/Pages`. */
const countPages = (b: Buffer) =>
  (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-'

function def(questionCount: number): TemplateDefinition {
  return {
    key: 'ongoing',
    name: 'Test intake',
    sections: [{
      id: 's_0',
      title: 'Brand snapshot',
      blocks: Array.from({ length: questionCount }, (_, i) => ({
        id: `q_${i}`, type: 'short_text' as const, label: `Question number ${i + 1}`,
      })),
    }],
  }
}

function render(questionCount: number, answered = true) {
  const answers = answered
    ? Object.fromEntries(Array.from({ length: questionCount }, (_, i) => [`q_${i}`, `Answer ${i + 1}`]))
    : {}
  return renderIntakePdf({
    clientName: 'Test Client',
    formTitle: 'Test intake',
    templateKey: 'ongoing',
    definition: def(questionCount),
    answers,
    files: [],
    submittedAt: new Date('2026-08-11'),
  })
}

describe('renderIntakePdf', () => {
  it('renders a valid PDF', async () => {
    const pdf = await render(3)
    expect(isPdf(pdf)).toBe(true)
  })

  it('a short form is exactly one page — the footer must not spawn a blank page', async () => {
    // Regression: stamping the footer below the bottom margin used to trigger
    // pdfkit's auto page-break, doubling the page count with blank pages.
    const pdf = await render(3)
    expect(countPages(pdf)).toBe(1)
  })

  it('a long form paginates without interleaving blank footer pages', async () => {
    const pdf = await render(100)
    const pages = countPages(pdf)
    expect(pages).toBeGreaterThan(1)
    // With the footer bug the count exactly doubles; ~100 short answers fit
    // well inside 10 pages when every page actually carries content.
    expect(pages).toBeLessThanOrEqual(10)
  })
})

/**
 * The spacing bug the owner reported: an unanswered question was drawn in
 * italic but measured in regular, and every answer was drawn with a line gap
 * the measurement did not know about — so the next question crept up into the
 * one above it. These two assert the measurement and the drawing agree.
 */
describe('question spacing', () => {
  it('measures an unanswered answer in the italic it is drawn in', async () => {
    const src = await readFile(new URL('../app/lib/intake-pdf.ts', import.meta.url), 'utf8')
    // one font choice, used by BOTH heightOfString and text
    expect(src).toMatch(/const answerFont = has \? 'Helvetica' : 'Helvetica-Oblique'/)
    expect(src).toMatch(/\.font\(answerFont\)\s*\n?\s*\.fontSize\(10\)\s*\n?\s*\.heightOfString/)
  })

  it('measures with the same line gaps it draws with', async () => {
    const src = await readFile(new URL('../app/lib/intake-pdf.ts', import.meta.url), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    // each named gap appears twice: once measured, once drawn
    expect((code.match(/lineGap: LABEL_GAP/g) ?? [])).toHaveLength(2)
    expect((code.match(/lineGap: ANSWER_GAP/g) ?? [])).toHaveLength(2)
    // and no bare number is left to drift
    expect(code).not.toMatch(/lineGap: \d/)
  })
})
