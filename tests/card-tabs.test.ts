import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { tabPanel } from '../app/dashboard/board/CardTabs'

describe('the card in tabs (21 Sep 2026)', () => {
  it('a closed panel is hidden but still there; an open one lays its sections out as before', () => {
    expect(tabPanel(true)).toBe('contents')
    expect(tabPanel(false)).toBe('hidden')
  })

  it('the editor’s and designer’s card: brief, your work, comments, brand, what happened', () => {
    const src = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(src).toContain("const ED_TABS = ['brief', 'work', 'comments', 'brand', 'history'] as const")
    for (const k of ['brief', 'work', 'comments', 'history']) expect(src).toContain(`className={tabPanel(tab === '${k}')}`)
    // the comment box stays mounted behind its tab, so a half-written note survives a look at the brief
    expect(src.indexOf("className={tabPanel(tab === 'comments')}")).toBeLessThan(src.indexOf('<CardSaid'))
    // the brand is fetched only when its tab is opened
    expect(src).toContain("{tab === 'brand' && (")
  })

  it('the post approval card: the decision stays above the tabs', () => {
    const src = readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')
    expect(src).toContain("const PA_TABS = ['post', 'comments', 'brand', 'history'] as const")
    expect(src.indexOf('── 2. the decision ──')).toBeLessThan(src.indexOf('<CardTabs'))
    for (const k of ['post', 'comments', 'history']) expect(src).toContain(`className={tabPanel(tab === '${k}')}`)
  })
})
