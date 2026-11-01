import { describe, it, expect } from 'vitest'
import { monthState, settlesOn, melbourneDay } from '../app/lib/client-report-core'

// 2 Nov 2026, the owner: "can we specify this in the report dashboard" (how fresh Zernio's numbers are), and Jordan
// Wilson's November-so-far read "−96% views vs last month" — one day against a whole month.

describe('how settled a month’s figures are', () => {
  it('a month settles two days after its last day', () => {
    expect(settlesOn('2026-10')).toBe('2026-11-02')
    expect(settlesOn('2026-12')).toBe('2027-01-02')
    expect(settlesOn('2026-02')).toBe('2026-03-02')
  })
  it('running while the month lasts, settling for two days, then final', () => {
    expect(monthState('2026-11', '2026-11-02').kind).toBe('running')
    expect(monthState('2026-10', '2026-10-31').kind).toBe('running')
    expect(monthState('2026-10', '2026-11-01').kind).toBe('settling')
    expect(monthState('2026-10', '2026-11-02').kind).toBe('final')
  })
  it('a final month read before it settled says so, so it is read again', () => {
    expect(monthState('2026-10', '2026-11-05', '2026-10-31T23:00:00Z')).toEqual({ kind: 'final', settlesOn: '2026-11-02', readEarly: true })
    expect(monthState('2026-10', '2026-11-05', '2026-11-03T01:00:00Z')).toEqual({ kind: 'final', settlesOn: '2026-11-02', readEarly: false })
  })
  it('days are Melbourne days', () => {
    expect(melbourneDay(new Date('2026-11-01T14:00:00Z'))).toBe('2026-11-02')
  })
})

import { reportHtml, reportPrompt } from '../app/lib/client-report-core'

// 2 Nov 2026, the owner: "could it please provide hyperlinks in the pdf or the summary … so its easy to click"
describe('links to the posts in the written report', () => {
  it('[words](https://…) is a link that opens in a new tab', () => {
    expect(reportHtml('See [the 3 Oct reel](https://www.instagram.com/reel/abc/) for more'))
      .toContain('<a href="https://www.instagram.com/reel/abc/" target="_blank" rel="noreferrer noopener">the 3 Oct reel</a>')
  })
  it('only http(s): a script address stays plain text', () => {
    const html = reportHtml('[bad](javascript:alert(1)) and [x](https://a.com/"onmouseover=alert(1))')
    expect(html).not.toContain('href="javascript')
    expect(html).not.toContain('"onmouseover')
  })
  it('the AI is told to link posts with their own address only', () => {
    const { system } = reportPrompt({ data: { platforms: [], month: '2026-10' } as never, objective: '', notes: '', shootConcepts: [], previousReport: null })
    expect(system).toContain('link it in Markdown')
    expect(system).toContain('Never write a link that is not in the data')
  })
})
