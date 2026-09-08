import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { itemPath } from '../app/lib/workflow-core'

/* ── "nothing goes in the Production page" (8 Sep 2026) ─────────────────── */

describe('itemPath — where a link to a piece lands', () => {
  it('a post uploaded for approval opens on the Post approval board', () => {
    expect(itemPath({ id: 'x', adhoc_post: true })).toBe('/dashboard/scheduler?item=x')
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

describe('the Post approval board opens the card the address names', () => {
  it('reads ?item= once the cards have arrived', () => {
    const src = readFileSync(join(process.cwd(), 'app/dashboard/scheduler/page.tsx'), 'utf8')
    expect(src).toContain(".get('item')")
    expect(src).toMatch(/sheet\.open\(wanted\)/)
  })
})

describe('the plain drawer (9 Sep 2026)', () => {
  it('opens for every uploaded post, and for every card on the Editor page', () => {
    const sheet = readFileSync(join(process.cwd(), 'app/dashboard/board/CardSheet.tsx'), 'utf8')
    expect(sheet).toMatch(/adhoc \|\| simple/)
    const editor = readFileSync(join(process.cwd(), 'app/dashboard/editor/page.tsx'), 'utf8')
    expect(editor).toMatch(/<CardSheet [^>]*simple/)
    const detail = readFileSync(join(process.cwd(), 'app/dashboard/board/PostApprovalDetail.tsx'), 'utf8')
    // no way out to the Production card page
    expect(detail).not.toMatch(/dashboard\/production\//)
    // production work writes ordinary versions; an uploaded post the Schedule page's way
    expect(detail).toMatch(/\/api\/production\/items\/\$\{item\.id\}\/versions/)
    expect(detail).toMatch(/\/api\/social\/schedule\/media/)
  })
})
