import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * ONE LINK, ONE PAGE (the owner, 28 Sep 2026: "I just want one easy portal — the client has received two different
 * links"; "the layout is horrible, one scroll down if there are many assets"; "the post approval card has board and
 * brief plan info, which is not right").
 */
describe('one review page for a client', () => {
  it('the approval link and the portal both open the same review page', () => {
    expect(readFileSync('app/portal/[token]/approve/[id]/page.tsx', 'utf8')).toContain('<PostReview ')
    const item = readFileSync('app/portal/[token]/item/[id]/page.tsx', 'utf8')
    expect(item).toContain('if (approval && approval.slides.length > 0) redirect(`/portal/${raw}/approve/${id}`)')
  })
  it('the portal card is a cover and one button — no slide stack, no shoot plan', () => {
    const board = readFileSync('app/components/portal/PortalBoard.tsx', 'utf8')
    expect(board).toContain("const reviewHref = token && card.kind === 'work' && assets.length > 0")
    expect(board).toContain("{canApprove || canAsk ? 'Review and approve' : 'Open'}")
    expect(board).toContain('{!reviewHref && assets.length > 0 && (')
    expect(board).toContain('{!reviewHref && card.shoot?.shared &&')
    expect(board).toContain('{!reviewHref && (canApprove || canAsk) && (')
  })
  it('the review page: one slide at a time, the notes for that slide beside it, the answer in view', () => {
    const r = readFileSync('app/components/portal/PostReview.tsx', 'utf8')
    expect(r).toContain('onIndexChange={setIndex}')
    expect(r).toContain('const onThis = notes.filter(n => n.index === index)')
    expect(r).toContain('lg:sticky')
    expect(r).toContain("fetch('/api/portal/comment'")
    expect(r).toContain('<ApprovePanel ')
  })
})
