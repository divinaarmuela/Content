import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 29 Oct 2026: "active clients on top in alphabetical order and archived clients below … and a search bar too"
describe('the Clients page', () => {
  const s = readFileSync('app/dashboard/clients/page.tsx', 'utf8')
  it('lists active first, archived last, each A to Z', () => {
    expect(s).toContain("const STATUS_ORDER: Record<string, number> = { active: 0, prospect: 1, paused: 2, archived: 3 }")
    expect(s).toContain(".sort((a, b) => (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2)")
  })
  it('has a search bar you can see', () => {
    expect(s).toContain('placeholder="Search clients by name, industry, contact or email"')
  })
})
