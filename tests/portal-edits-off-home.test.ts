import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { portalSections, sectionCounts } from '../app/lib/portal-core'

/** AN EDIT IS REVIEWED ON ITS OWN LINK (the owner, 22 Sep 2026: a Video edit card sat under
 *  "Needs your review" on Capila's portal home — "that is for the team"). */
describe('the portal home asks for nothing an editing link already asks for', () => {
  const post = { id: 'p', column: 'your_review' as const, actions: { approve: true } as never }
  const edit = { id: 'e', column: 'your_review' as const, actions: { approve: true } as never, editing: true }
  const plan = { id: 's', column: 'your_review' as const, actions: { approve: true } as never, editing: false }
  it('a post and a plan are asked for; an edit is not', () => {
    expect(portalSections([post, edit, plan])[0].cards.map(c => c.id)).toEqual(['p', 's'])
    expect(sectionCounts([post, edit, plan]).review).toBe(2)
  })
  it('the card knows it is an edit from the same rule the editing link uses', () => {
    expect(readFileSync('app/lib/portal-data.ts', 'utf8')).toContain('editing: portalHasWork(i as never),')
  })
})
