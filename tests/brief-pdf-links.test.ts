import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { pdfRuns, renderBriefPdf } from '../app/lib/brief-pdf'

// 29 Oct 2026: "shoot brief pdfs when generated links are not working in there"
describe('links in the shoot plan PDF', () => {
  it('an address is its own run with its link; the words around it stay words', () => {
    expect(pdfRuns('See https://drive.google.com/x?id=1 for refs.\nNo link here')).toEqual([
      [{ text: 'See ' }, { text: 'https://drive.google.com/x?id=1', href: 'https://drive.google.com/x?id=1' }, { text: ' for refs.' }],
      [{ text: 'No link here' }],
    ])
    expect(pdfRuns('www.instagram.com/reel/abc')[0][0]).toEqual({ text: 'www.instagram.com/reel/abc', href: 'https://www.instagram.com/reel/abc' })
  })
  it('the PDF carries a pressable link for every address in it', async () => {
    const pdf = await renderBriefPdf({
      title: 'T', clientName: 'C', statusLabel: 'Draft', shootDate: null, location: null, concept: null,
      deliverables: [{ title: 'Reel — ref https://example.com/ref1' } as never],
      shotList: [{ text: 'Hook like https://example.com/shot2', done: false } as never],
      objective: 'Moodboard: https://example.com/board3',
    })
    const s = pdf.toString('latin1')
    for (const u of ['https://example.com/ref1', 'https://example.com/shot2', 'https://example.com/board3']) {
      expect(s).toContain(`/URI (${u})`)
    }
  })
})
