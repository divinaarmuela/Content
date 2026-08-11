import { describe, it, expect } from 'vitest'
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
