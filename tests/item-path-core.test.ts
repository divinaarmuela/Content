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
      // the client asked for changes: back on the Editor board, and its email opens it there (30 Sep 2026)
      expect(itemPath({ id: 'x', status: 'client_changes_requested' }, role), String(role)).toBe('/dashboard/editor?card=x')
      expect(itemPath({ id: 'x', status: 'approved_for_scheduling' }, role), String(role)).toBe('/dashboard/scheduler?card=x')
      expect(itemPath({ id: 'x', status: 'published' }, role), String(role)).toBe('/dashboard/scheduler?card=x')
    }
  })
  it('nothing links to the old full card page any more', () => {
    expect(itemPath({ id: 'x' })).not.toContain('/dashboard/production/')
    for (const f of [
      'app/lib/workflow.ts', 'app/lib/due-reminders.ts', 'app/lib/editor-sop-notify.ts', 'app/lib/booked-notify.ts',
      // app/lib/posting-approval.ts is gone (the posting rebuild, 29 Sep 2026)
      'app/lib/notification-words.ts',
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
    // the posting emails left with app/lib/posting-approval.ts (the posting rebuild, 29 Sep 2026)
    for (const f of ['app/api/portal/comment/route.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/dashboard\/production\/\$\{item\.id\}/)
      expect(src, f).toMatch(/itemPath\(item[,)]/)
    }
  })
})

describe('the Post approval board opens the card the address names', () => {
  it('reads ?item= once the posts have arrived: outlines the posts made from it, and never opens the edit (30 Sep 2026)', () => {
    const src = readFileSync(join(process.cwd(), 'app/dashboard/scheduler/page.tsx'), 'utf8')
    expect(src).toContain(".get('item')")
    expect(src).toMatch(/bp\.post\.source_item_id === itemId/)
    expect(src).not.toMatch(/sheet\.open/)
  })
})

describe('the plain drawer (9 Sep 2026)', () => {
  it('opens for every uploaded post, and for every card on the Editor page', () => {
    const sheet = readFileSync(join(process.cwd(), 'app/dashboard/board/CardSheet.tsx'), 'utf8')
    // an upload's file holder gets the plain drawer; a post opens the post window (29 Sep 2026)
    expect(sheet).toMatch(/: adhoc\s+\? <PostApprovalDetail/)
    expect(sheet).not.toMatch(/simple/)
    const editor = readFileSync(join(process.cwd(), 'app/dashboard/editor/page.tsx'), 'utf8')
    // the Editor page turns ?card= into the card's own page (15 Sep 2026)
    expect(editor).toContain('router.replace(`/dashboard/editor/${id}`)')
    const detail = readFileSync(join(process.cwd(), 'app/dashboard/board/PostApprovalDetail.tsx'), 'utf8')
    // no way out to the Production card page
    expect(detail).not.toMatch(/dashboard\/production\//)
    // production work writes ordinary versions; an uploaded post the Schedule page's way
    expect(detail).toMatch(/\/api\/production\/items\/\$\{item\.id\}\/versions/)
    expect(detail).toMatch(/\/api\/social\/schedule\/media/)
  })
})
