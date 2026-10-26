import { describe, expect, it } from 'vitest'
import {
  REVIEW_CHECKS, allChecked, change, isMonthKey, mayDeleteReport, mayOpenReports, monthLabel, monthRange, previousMonth,
  recentMonths, reportHtml, reportId, reportPrompt, toBreakdown, type ReportData,
} from '@/app/lib/client-report-core'

// the owner, 26 Oct 2026: "we need to build a client reporting page" — the team's Monthly Client Reports Guide
describe('the month', () => {
  it('runs 1st to last day, and knows the month before', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(monthLabel('2026-10')).toBe('October 2026')
    expect(recentMonths(new Date('2026-10-26T00:00:00Z'), 3)).toEqual(['2026-10', '2026-09', '2026-08'])
    expect(isMonthKey('2026-13')).toBe(false)
    expect(reportId('c1', '2026-09')).toBe('c1_2026-09')
  })
})

describe('who', () => {
  it('super admins and account managers open it; only a super admin deletes', () => {
    expect(mayOpenReports('super_admin')).toBe(true)
    expect(mayOpenReports('account_manager')).toBe(true)
    for (const r of ['editor', 'scheduler', 'quality_checker', 'general', 'client']) expect(mayOpenReports(r)).toBe(false)
    expect(mayDeleteReport('super_admin')).toBe(true)
    expect(mayDeleteReport('account_manager')).toBe(false)
  })
})

describe('the figures', () => {
  it('shares, biggest first; a change in words', () => {
    expect(toBreakdown([{ dimension: 'F', value: 3 }, { dimension: 'M', value: 1 }], 5, s => ({ F: 'Women', M: 'Men' } as Record<string, string>)[s] ?? s))
      .toEqual([{ label: 'Women', value: 3, pct: 75 }, { label: 'Men', value: 1, pct: 25 }])
    expect(change(120, 100)).toEqual({ text: '+20%', up: true })
    expect(change(80, 100)).toEqual({ text: '−20%', up: false })
    expect(change(5, 0)).toEqual({ text: 'new', up: true })
    expect(change(null, 100)).toBeNull()
  })
})

describe('the written report', () => {
  it('is escaped — nothing written can become markup', () => {
    const html = reportHtml('## Summary\n\n**Views** rose <script>alert(1)</script>\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<h3>Summary</h3>')
    expect(html).toContain('<strong>Views</strong>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<ul>')
    expect(html).toContain('<td>1</td>')
  })
  it('is ready when every check of the guide is ticked', () => {
    expect(allChecked({})).toBe(false)
    expect(allChecked(Object.fromEntries(REVIEW_CHECKS.map(c => [c.key, true])))).toBe(true)
  })
  it('the prompt carries the guide\'s rules and the figures as read', () => {
    const data: ReportData = { clientId: 'c', clientName: 'Jordan Wilson', industry: 'Finance', month: '2026-09', fetchedAt: 'x', platforms: [], audience: null, gaps: [] }
    const { system, user } = reportPrompt({ data, objective: 'Growth', notes: 'push carousels', shootConcepts: ['Shoot 4 (2026-11-03): office day'], previousReport: null })
    expect(system).toMatch(/Never invent/)
    expect(system).toMatch(/Do not use dashes/)
    expect(user).toContain('Client: Jordan Wilson')
    expect(user).toContain('Time period: 2026-09-01 to 2026-09-30')
    expect(user).toContain('push carousels')
    expect(user).toContain('Shoot 4 (2026-11-03): office day')
    expect(user).toMatch(/Do not include ads/)
  })
})
