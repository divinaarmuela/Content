import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { itemPath } from '../app/lib/workflow-core'

/* ── "nothing goes in the Production page" (8 Sep 2026) ─────────────────── */

describe('itemPath — where a link to a piece lands', () => {
  it('a post uploaded for approval opens on the Post approval board', () => {
    expect(itemPath({ id: 'x', adhoc_post: true })).toBe('/dashboard/scheduler')
  })
  it('production work keeps its card page', () => {
    expect(itemPath({ id: 'x' })).toBe('/dashboard/production/x')
    expect(itemPath({ id: 'x', adhoc_post: false })).toBe('/dashboard/production/x')
  })
  it('no email in the workflow or the portal hard-codes the Production card page any more', () => {
    for (const f of ['app/lib/workflow.ts', 'app/api/portal/act/route.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/dashboard\/production\/\$\{item(Id|\.id)\}/)
    }
  })
})

describe('the Production card page sends an uploaded post to the Post approval board', () => {
  it('redirects on the server before the card is drawn', () => {
    const src = readFileSync(join(process.cwd(), 'app/dashboard/production/[id]/page.tsx'), 'utf8')
    expect(src).toMatch(/adhoc_post === true\) redirect\(itemPath/)
    expect(src).not.toMatch(/'use client'/)
  })
  it('the approval and portal-comment mails use the rule too', () => {
    for (const f of ['app/lib/posting-approval.ts', 'app/api/portal/comment/route.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/dashboard\/production\/\$\{item\.id\}/)
      expect(src, f).toMatch(/itemPath\(item\)/)
    }
  })
})
