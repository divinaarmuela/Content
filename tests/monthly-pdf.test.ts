import { describe, it, expect } from 'vitest'
import { renderMonthlyPdf } from '../app/lib/monthly-pdf'
import type { TemplateDefinition } from '../app/lib/intake-core'

/** Page dictionaries are written uncompressed by pdfkit, so the page count
 *  is countable straight off the buffer. `/Page` must not match `/Pages`. */
const countPages = (b: Buffer) =>
  (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-'

function def(questionCount: number): TemplateDefinition {
  return {
    key: 'one_off',
    name: 'Test monthly',
    sections: [{
      id: 's_0',
      title: 'Last month',
      blocks: Array.from({ length: questionCount }, (_, i) => ({
        id: `q_${i}`, type: 'long_text' as const, label: `Question number ${i + 1}`,
      })),
    }],
  }
}

function render(questionCount: number, answered = true) {
  const answers = answered
    ? Object.fromEntries(Array.from({ length: questionCount }, (_, i) => [`q_${i}`, `Answer ${i + 1}`]))
    : {}
  return renderMonthlyPdf({
    clientName: 'Test Client',
    formTitle: 'Monthly update — September 2026',
    definition: def(questionCount),
    answers,
    submittedAt: new Date('2026-08-11'),
  })
}

describe('renderMonthlyPdf', () => {
  it('renders a valid PDF', async () => {
    const pdf = await render(3)
    expect(isPdf(pdf)).toBe(true)
  })

  it('a short form is exactly one page — the footer must not spawn a blank page', async () => {
    const pdf = await render(3)
    expect(countPages(pdf)).toBe(1)
  })

  it('an unanswered form still renders (every question printed, greyed)', async () => {
    const pdf = await render(3, false)
    expect(isPdf(pdf)).toBe(true)
    expect(countPages(pdf)).toBe(1)
  })

  it('a long form paginates without interleaving blank footer pages', async () => {
    const pdf = await render(100)
    const pages = countPages(pdf)
    expect(pages).toBeGreaterThan(1)
    expect(pages).toBeLessThanOrEqual(12)
  })
})
