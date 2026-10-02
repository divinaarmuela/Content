import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/* ── the one page: /portal/[token]/home (docs/ONE_PORTAL_SPEC.md §3) ── */

vi.mock('@/lib/db', () => ({ table: () => ({ get: async () => null, list: async () => [] }) }))
const { waitsOnClient, workShown } = await import('../app/lib/one-portal-page')

const card = (over: Record<string, unknown>) => ({
  kind: 'work', id: 'x', title: 'T', column: 'making', status: 'draft_uploaded', editing: false,
  actions: { approve: false, askForChange: false, comment: false }, ...over,
}) as never

describe('which pieces the client sees in Editing / Designing', () => {
  it('never one still being made or at the quality check', () => {
    expect(workShown(card({ column: 'making' }))).toBe(false)
    expect(workShown(card({ column: 'checking' }))).toBe(false)
  })
  it('theirs to review, approved, posted — and an edit that reached them, the whole way', () => {
    for (const column of ['your_review', 'approved', 'posted']) expect(workShown(card({ column }))).toBe(true)
    expect(workShown(card({ column: 'checking', editing: true }))).toBe(true)
    expect(workShown(card({ kind: 'shoot', column: 'your_review' }))).toBe(false)
  })
  it('waiting on them: an Approve button, or an edit with the client', () => {
    expect(waitsOnClient(card({ actions: { approve: true } }))).toBe(true)
    expect(waitsOnClient(card({ status: 'client_review' }))).toBe(true)
    expect(waitsOnClient(card({ status: 'approved_for_scheduling' }))).toBe(false)
  })
})

describe('the page', () => {
  const page = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
  const loader = readFileSync('app/lib/one-portal-page.ts', 'utf8')
  it('answers 404 for a link not on the one portal — today\'s portal is untouched', () => {
    expect(loader).toMatch(/if \(!client \|\| !onePortal\(client\)\) return null/)
    expect(page).toMatch(/if \(!page\) notFound\(\)/)
  })
  it('keeps a person\'s link to their own work (today\'s scoped loader)', () => {
    expect(loader).toMatch(/getPortalData\(client\.id, owner\.scope\)/)
  })
  it('opens a piece inside the page with today\'s review, and only a piece in that tab', () => {
    expect(page).toMatch(/\.find\(c => c\.id === id\) \?\? null\s*if \(!card\) notFound\(\)/)
    expect(page).toContain('<EditingReview data={review} />')
  })
  it('the tabs are links, so every email can open one', () => {
    expect(readFileSync('app/components/portal/OnePortalTabs.tsx', 'utf8')).toContain('href={onePortalPath(token, t.key)}')
  })
})
