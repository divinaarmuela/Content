import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the client’s reports on their portal (5 Nov 2026)', () => {
  const lib = readFileSync('app/lib/portal-reports.ts', 'utf8')
  it('shows only a month the team shared, with a written report', () => {
    expect(lib).toContain('!!(r as { shared_at?: string | null }).shared_at && !!r.body')
    expect(lib).toContain('!sharedAt || !r.body')
  })
  it('never hands the client the team’s notes, checks, versions or gaps', () => {
    const payload = lib.slice(lib.indexOf('return {', lib.indexOf('export async function sharedReport(')))
    for (const k of ['notes', 'objective', 'checks', 'history', 'gaps', 'byMdm']) expect(payload).not.toMatch(new RegExp(`\b${k}:`))
  })
  it('sharing needs a written report; taking it off clears it', () => {
    const api = readFileSync('app/api/reports/monthly/route.ts', 'utf8')
    expect(api).toContain("body.share === true && cur.body ? { shared_at: now, shared_by: user.id }")
    expect(api).toContain("body.share === false ? { shared_at: null, shared_by: null }")
  })
})
