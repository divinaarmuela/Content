import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkTransitionAs } from '../app/lib/workflow-core'

/* ── a super admin may skip the quality check on a card (the owner, 2 Oct 2026) ── */

describe('skip quality check', () => {
  const src = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
  it('is the two moves a super admin may already make — into the check, then passed; nobody else may pass', () => {
    expect(checkTransitionAs(['super_admin'], 'draft_uploaded', 'quality_check').ok).toBe(true)
    expect(checkTransitionAs(['super_admin'], 'quality_check', 'client_review').ok).toBe(true)
    expect(checkTransitionAs(['account_manager'], 'quality_check', 'client_review').ok).toBe(false)
    expect(checkTransitionAs(['editor'], 'quality_check', 'client_review').ok).toBe(false)
  })
  it('only a super admin sees it, and never while Drive files are still copying', () => {
    expect(src).toContain("const isSuper = me?.role === 'super_admin'")
    expect(src).toContain('{isSuper && (')
    expect(src).toContain('disabled={busy || !workIn || driveCopying} onClick={() => void skipCheck()}')
  })
  it('the history says who skipped it', () => {
    expect(src).toContain("note: `Quality check skipped by ${me?.name ?? 'a super admin'}.`")
  })
})
