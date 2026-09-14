import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { itemPath } from '../app/lib/workflow-core'

/* ── "nothing goes in the Production page" (8 Sep 2026) ─────────────────── */

describe('itemPath — the reader’s own board, with the card open (14 Sep 2026)', () => {
  // the owner: "editor is the Editor's page, Post approval is the scheduler's
  // page — why are they using the same?"
  it('a post uploaded for approval opens on the Post approval board, for everyone', () => {
    expect(itemPath({ id: 'x', adhoc_post: true })).toBe('/dashboard/scheduler?card=x')
    expect(itemPath({ id: 'x', adhoc_post: true, status: 'draft_uploaded' }, 'account_manager')).toBe('/dashboard/scheduler?card=x')
  })
  it('an editor always lands on the Editor page, a scheduler always on Post approval', () => {
    expect(itemPath({ id: 'x', status: 'quality_check' }, 'editor')).toBe('/dashboard/editor?card=x')
    expect(itemPath({ id: 'x', status: 'approved_for_scheduling' }, 'editor')).toBe('/dashboard/editor?card=x')
    expect(itemPath({ id: 'x', status: 'quality_check' }, 'scheduler')).toBe('/dashboard/scheduler?card=x')
  })
  it('everyone else: the Editor page while the piece is being made, Post approval once approved', () => {
    for (const role of ['quality_checker', 'account_manager', 'super_admin', 'general', null]) {
      expect(itemPath({ id: 'x', status: 'quality_check' }, role), String(role)).toBe('/dashboard/editor?card=x')
      expect(itemPath({ id: 'x', status: 'revision_required' }, role), String(role)).toBe('/dashboard/editor?card=x')
      expect(itemPath({ id: 'x', status: 'approved_for_scheduling' }, role), String(role)).toBe('/dashboard/scheduler?card=x')
      expect(itemPath({ id: 'x', status: 'published' }, role), String(role)).toBe('/dashboard/scheduler?card=x')
    }
  })
  it('nothing links to the old full card page any more', () => {
    expect(itemPath({ id: 'x' })).not.toContain('/dashboard/production/')
    for (const f of [
      'app/lib/workflow.ts', 'app/lib/due-reminders.ts', 'app/lib/editor-sop-notify.ts', 'app/lib/booked-notify.ts',
      'app/lib/posting-approval.ts', 'app/lib/notification-words.ts',
      'app/api/production/items/[id]/send-back/route.ts', 'app/api/production/items/[id]/flag/route.ts',
      'app/api/portal/act/route.ts', 'app/api/portal/comment/route.ts',
    ]) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/dashboard\/production\/\$\{/)
    }
    // the fan-out links each reader to their own board, at the new status
    expect(readFileSync(join(process.cwd(), 'app/lib/workflow.ts'), 'utf8'))
      .toContain('itemPath({ ...item, status: to }, (person as { role?: string | null }).role)')
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
      expect(src, f).toMatch(/itemPath\(item[,)]/)
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
