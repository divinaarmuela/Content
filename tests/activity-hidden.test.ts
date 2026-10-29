import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 29 Oct 2026, the owner: "remove yusuf from asana activity" — both Yusufs, off the People view and the Calendar
describe('a person taken off the Asana activity page', () => {
  it('has no line on People or on the Calendar', () => {
    expect(readFileSync('app/api/team/activity/route.ts', 'utf8')).toContain("where: r => r.role !== 'client' && r.activity_hidden !== true")
    expect(readFileSync('app/api/team/activity/workload/route.ts', 'utf8')).toContain("where: r => r.role !== 'client' && r.activity_hidden !== true")
  })
})
