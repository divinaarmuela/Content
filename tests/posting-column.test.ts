import { describe, expect, it } from 'vitest'
import { groupByLane, pageLanes, postingColumn } from '../app/lib/board-view-core'

/**
 * THE POST'S APPROVAL, NOT THE EDIT'S, PLACES A CARD ON THE POSTING PAGES (the owner, 28 Sep 2026: "why are all
 * posts Ready to post when they're not client approved … post approval and editing are independent, same with
 * designers"). Tonight's cards: Jordan 3 and 4 waiting on Jordan, Jordan 11 waiting on the team, Justin 3 changes.
 */
const card = (id: string, posting: string | undefined, clientRequired = false) =>
  ({ id, status: 'approved_for_scheduling' as const, posting_approval_state: posting, posting_client_required: clientRequired })

describe('Post approval board', () => {
  const lanes = pageLanes('scheduler')
  const where = (c: ReturnType<typeof card>) => groupByLane(lanes, [c]).find(g => g.cards.length)!.lane.key
  it('waiting on the client is With client, not Ready to post', () => {
    expect(where(card('jordan-4', 'pending', true))).toBe('with_client')
  })
  it('waiting on the team is Quality check', () => {
    expect(where(card('jordan-11', 'pending', false))).toBe('quality_check')
  })
  it('the client asked for a change: back in Draft', () => {
    expect(where(card('justin-3', 'changes', true))).toBe('draft')
  })
  it("only the POST approved is Ready to post; an approved edit with no post approval yet is the scheduler's Draft", () => {
    expect(where(card('a', 'approved'))).toBe('ready_to_post')
    expect(where(card('b', undefined))).toBe('draft')
  })
  it('the editor\'s and designer\'s boards keep the edit\'s own stage', () => {
    const editor = groupByLane(pageLanes('editor'), [card('jordan-4', 'pending', true)]).find(g => g.cards.length)!.lane.key
    expect(editor).not.toBe('with_client')
    expect(postingColumn(card('x', 'pending', true), 'posted')).toBe('posted')
  })
})
