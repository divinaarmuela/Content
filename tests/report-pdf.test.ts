import { describe, it, expect } from 'vitest'
import { renderLeadsReportPdf } from '../app/lib/report-pdf'
import type { LeadsReportData } from '../app/lib/report-data'

const LONG_SERVICE =
  'Content Subscription — monthly photo & video production plus social media management and paid advertising'

function sample(overrides: Partial<LeadsReportData> = {}): LeadsReportData {
  return {
    month: 7, year: 2026, monthLabel: 'July 2026',
    periodStart: '2026-07-01', periodEnd: '2026-07-31',
    totals: {
      leads: 3, fromForm: 2, fromInbox: 1,
      prospectsCreated: 1, inboxScanned: 40, inboxSkipped: 37,
    },
    byService: [
      { label: LONG_SERVICE, count: 2 },
      { label: 'Branding', count: 1 },
    ],
    leads: [
      {
        date: '02 Jul', name: 'Alexandra Featherstonehaugh',
        business: 'Featherstonehaugh & Partners Hospitality Group',
        email: 'a@f.com', source: 'Website', service: LONG_SERVICE,
      },
      { date: '09 Jul', name: 'Bo Li', business: 'Li Co', email: 'b@l.com', source: 'Inbox', service: 'Branding' },
    ],
    ...overrides,
  }
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-'

describe('renderLeadsReportPdf', () => {
  it('renders a valid PDF', async () => {
    const pdf = await renderLeadsReportPdf(sample())
    expect(isPdf(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(1000)
  })

  it('handles very long service names and business names without failing', async () => {
    const pdf = await renderLeadsReportPdf(sample())
    expect(isPdf(pdf)).toBe(true)
  })

  it('renders an empty month', async () => {
    const pdf = await renderLeadsReportPdf(sample({
      totals: { leads: 0, fromForm: 0, fromInbox: 0, prospectsCreated: 0, inboxScanned: 0, inboxSkipped: 0 },
      byService: [], leads: [],
    }))
    expect(isPdf(pdf)).toBe(true)
  })

  it('paginates a large lead register', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      date: '01 Jul', name: `Lead Number ${i} With A Fairly Long Name`,
      business: `Business ${i} Pty Ltd trading as Something Longer`,
      email: `l${i}@x.com`, source: i % 2 ? 'Inbox' : 'Website', service: LONG_SERVICE,
    }))
    const pdf = await renderLeadsReportPdf(sample({ leads: many }))
    expect(isPdf(pdf)).toBe(true)
    // multi-page documents are substantially larger
    expect(pdf.length).toBeGreaterThan(5000)
  })
})
