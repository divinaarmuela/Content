import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A `report_settings` row written before the recipients field existed has no
 * array at all — that is the shape live has. Everything downstream must read
 * it as "nobody on the list", never as a missing property to call `.map` on:
 * the Reports page threw `Cannot read properties of undefined (reading 'map')`
 * and rendered nothing at all, for a report that simply had no recipients yet.
 *
 * This pins both halves of that contract: the route hands the row back
 * untouched (200, not a 500), and the tick treats it as no recipients and
 * skips instead of trying to email `undefined`.
 */

class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => ({ role: 'super_admin', email: 'am@example.invalid' }),
  authzErrorResponse: (e: unknown) => e instanceof AuthzError
    ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))
// the tick must not reach a PDF renderer or a mailbox to answer this question
vi.mock('../app/lib/report-data', () => ({ buildLeadsReportData: async () => ({}) }))
vi.mock('../app/lib/report-pdf', () => ({ renderLeadsReportPdf: async () => Buffer.from('') }))
vi.mock('../app/lib/mailer', () => ({
  sendRawEmail: async () => { throw new Error('must not send') },
  renderEmail: () => '',
}))

const { GET } = await import('../app/api/reports/leads/route')
const { runLeadsReportTick } = await import('../app/lib/report-send')

/** the live shape: enabled, on a send day, and with no recipients key */
const NO_RECIPIENTS = {
  id: 'leads_report',
  updated_at: '2026-09-01T00:00:00.000Z',
  enabled: true,
  send_day: new Date().getUTCDate(),
  data_from: null,
  last_sent_for: null,
} as unknown as Row

describe('report settings without a recipients array', () => {
  let fake: ReturnType<typeof seedDb> | null = null
  afterEach(() => { fake?.restore(); fake = null })

  it('the route hands the row back rather than failing', async () => {
    fake = seedDb({ report_settings: [NO_RECIPIENTS] })
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json() as { recipients?: string[]; enabled: boolean }
    expect(json.enabled).toBe(true)
    // the field really is absent — this is the shape the page has to survive
    expect(json.recipients).toBeUndefined()
    // and the reading every consumer does gives an empty list, not a throw
    expect(() => (json.recipients ?? []).map(r => r)).not.toThrow()
    expect(json.recipients ?? []).toEqual([])
  })

  it('the monthly tick reads it as nobody, and sends nothing', async () => {
    fake = seedDb({ report_settings: [NO_RECIPIENTS] })
    await expect(runLeadsReportTick()).resolves.toEqual({ skipped: 'no recipients' })
  })
})
