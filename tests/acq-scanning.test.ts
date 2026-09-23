import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { agentSummary, findingsList, INGEST_STATUS_WORDS, mailboxSummaries, recentReads } from '../app/lib/acq-scanning-core'

/** SCANNING (the acquisition blueprint's Scanning page; built 22 Sep 2026): every line is a row the system wrote. */
const NOW = '2026-09-22T10:30:00.000Z' // 8:30 pm Melbourne, 22 Sep
const rows = [
  { id: 'a', created_at: '2026-09-22T10:25:05.000Z', mailbox: 'hello@mdmmarketing.com.au', from_email: 'no-reply@x.test', subject: 'Receipt', received_at: '2026-09-22T10:24:37.000Z', status: 'skipped', reasoning: 'no-reply sender' },
  { id: 'b', created_at: '2026-09-21T23:55:00.000Z', mailbox: 'hello@mdmmarketing.com.au', from_email: 'sam@ausvenueco.com.au', subject: 'Reels?', received_at: '2026-09-21T23:50:00.000Z', status: 'lead_created', reasoning: 'asks for content', lead_id: 'l1' },
  { id: 'c', created_at: '2026-09-21T10:00:00.000Z', mailbox: 'contact@mdmmarketing.com.au', from_email: 'x@y.test', subject: '', received_at: null, status: 'error', reasoning: null },
]
const boxes = [{ email: 'Hello@mdmmarketing.com.au', enabled: true, last_run_at: '2026-09-22T10:28:00.000Z', last_status: 'success' }, { email: 'contact@mdmmarketing.com.au', enabled: false }, { email: 'tech@mdmmarketing.com.au', enabled: true, last_run_at: '2026-09-22T10:28:00.000Z', last_status: 'success' }]

describe('the mailboxes', () => {
  it('each one: on or off, when it last looked, today’s tally in Melbourne’s day', () => {
    const s = mailboxSummaries(boxes, rows, NOW)
    expect(s.map(m => m.email)).toEqual(['contact@mdmmarketing.com.au', 'hello@mdmmarketing.com.au', 'tech@mdmmarketing.com.au'])
    const hello = s.find(m => m.email === 'hello@mdmmarketing.com.au')!
    expect(hello).toMatchObject({ enabled: true, last_read_at: '2026-09-22T10:25:05.000Z', today: { read: 2, skipped: 1, leads: 1, errors: 0 } })
    expect(s.find(m => m.email === 'contact@mdmmarketing.com.au')).toMatchObject({ enabled: false, today: { read: 0, errors: 0 } })
    // scanned two minutes ago with nothing new: the scan is recent, the last message is none (tech@, 23 Sep 2026)
    expect(s.find(m => m.email === 'tech@mdmmarketing.com.au')).toMatchObject({ last_scan_at: '2026-09-22T10:28:00.000Z', last_status: 'success', last_read_at: null, today: { read: 0 } })
  })
})

describe('what was read', () => {
  it('the last messages, newest first, each with why it was kept or skipped', () => {
    const r = recentReads(rows, 2)
    expect(r.map(x => x.id)).toEqual(['a', 'b'])
    expect(r[0]).toMatchObject({ words: 'Skipped', why: 'no-reply sender', at: '2026-09-22T10:24:37.000Z' })
    expect(r[1]).toMatchObject({ words: 'Made a lead', lead_id: 'l1' })
    expect(recentReads(rows)[2]).toMatchObject({ subject: '(no subject)', words: 'Could not read', why: null })
    expect(INGEST_STATUS_WORDS.not_a_lead).toBe('Read — not a lead')
  })
  it('the agent’s last pass, and the findings with where each landed', () => {
    expect(agentSummary([{ agent_checked_at: '2026-09-22T09:00:00.000Z' }, { agent_checked_at: null }, { agent_checked_at: '2026-09-22T10:00:00.000Z' }])).toEqual({ last_pass_at: '2026-09-22T10:00:00.000Z', prospects_checked: 2, prospects_total: 3 })
    const f = findingsList([
      { id: 'e1', prospect_id: 'p1', kind: 'call_booked', at: '2026-09-22T09:00:00.000Z', source: 'agent', detail: 'Tue 3 pm?', confidence: 0.7, confirmed: false, dismissed_at: null },
      { id: 'e2', prospect_id: 'p1', kind: 'reply', at: '2026-09-22T09:30:00.000Z', source: 'scanner', detail: 'ok', confirmed: true, dismissed_at: null },
      { id: 'e3', prospect_id: 'p1', kind: 'note', at: '2026-09-22T09:40:00.000Z', source: 'person', detail: 'by hand' },
      { id: 'e4', prospect_id: 'p9', kind: 'reply', at: '2026-09-22T09:50:00.000Z', source: 'agent', detail: 'gone prospect' },
    ], [{ id: 'p1', business: 'Crestline' }])
    expect(f.map(x => x.id)).toEqual(['e2', 'e1'])
    expect(f[1]).toMatchObject({ business: 'Crestline', label: 'Booked the discovery call', confidence: 0.7, state: 'unsure', source: 'agent' })
    expect(f[0].state).toBe('recorded')
  })
  it('the route only reads; the view is the sixth acquisition view, last in the rail', () => {
    const route = readFileSync('app/api/leads/acquisition/scanning/route.ts', 'utf8')
    expect(route).toContain("await requireRole('scheduler')")
    expect(route).not.toMatch(/\.(insert|update|remove|claim)\(/)
    expect(readFileSync('app/dashboard/leads/acquisition/Acquisition.tsx', 'utf8')).toContain("{ key: 'scanning', label: 'Scanning', href: '/dashboard/leads/acquisition/scanning' }")
    expect(readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')).toContain("{ href: '/dashboard/leads/acquisition/scanning',  label: 'Scanning',  icon: Radar }")
  })
})
