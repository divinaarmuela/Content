import { describe, expect, it } from 'vitest'
import { heroCounts, portalColumnForPost, portalSections, postingCardFace } from '../app/lib/portal-core'

/**
 * THE POST'S APPROVAL IS ITS OWN (the owner, 28 Sep 2026: "why is it under Approved and Scheduled … why does it say
 * Approved with green … this is a post approval, not editing — those are independent, same with designers").
 * Jordan's posts 3, 4 and 11 had their edits approved and their posts waiting on him.
 */
describe('a post waiting on its approval is not Approved on the portal', () => {
  it('waiting on the client: Your review, amber, "Waiting on your approval"', () => {
    expect(portalColumnForPost('approved_for_scheduling', { state: 'pending', clientRequired: true })).toBe('your_review')
    expect(postingCardFace('approved_for_scheduling', { state: 'pending', clientRequired: true })).toEqual({ tone: 'amber', line: 'Waiting on your approval' })
  })
  it('waiting on the team, or being changed after their notes: being checked, not shown as approved', () => {
    expect(portalColumnForPost('approved_for_scheduling', { state: 'pending', clientRequired: false })).toBe('checking')
    expect(portalColumnForPost('approved_for_scheduling', { state: 'changes', clientRequired: true })).toBe('checking')
    expect(postingCardFace('approved_for_scheduling', { state: 'changes' })?.line).toBe('We’re making your changes')
  })
  it('only a yes — or a post that never needed one — is Approved; a published post stays Published', () => {
    expect(portalColumnForPost('approved_for_scheduling', { state: 'approved' })).toBe('approved')
    // an approved EDIT is not an approved POST: shown as Approved only when the client said yes to it themselves
    expect(portalColumnForPost('approved_for_scheduling', { clientSaw: true })).toBe('approved')
    expect(portalColumnForPost('approved_for_scheduling', {})).toBe('checking')
    expect(portalColumnForPost('approved_for_scheduling', { state: 'draft', clientSaw: true })).toBe('checking')
    expect(postingCardFace('approved_for_scheduling', { state: 'approved' })).toBeNull()
    expect(portalColumnForPost('published', { state: 'pending', clientRequired: true })).toBe('posted')
  })
  it('the header no longer counts a waiting post as Approved & scheduled', () => {
    const none = { approve: false, askForChange: false, comment: true } as never
    const cards = ['3', '4'].map(id => ({ kind: 'work' as const, id, column: portalColumnForPost('approved_for_scheduling', { state: 'pending', clientRequired: true }), actions: none }))
    expect(portalSections(cards).find(s => s.key === 'approved')!.cards).toHaveLength(0)
    expect(heroCounts(cards, [{ id: '3' }, { id: '4' }])).toMatchObject({ review: 2, approved: 0 })
  })
})
