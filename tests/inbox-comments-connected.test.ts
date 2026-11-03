import { describe, expect, it } from 'vitest'
import { onlyConnected } from '../app/api/social/inbox/route'

/**
 * A DISCONNECTED ACCOUNT'S COMMENTS ARE GONE (the owner, 14 Sep 2026: "in
 * the comments tab akmal.ashwin is still showing"). The comments inbox now
 * shows only accounts still connected, like the DM tab.
 */
const c = (accountId: string) => ({ id: `${accountId}-p`, accountId })

describe('onlyConnected (comments inbox)', () => {
  const connectedIds = new Set(['6aa7a0f6', '6aa7e25a'])
  it('drops comments from a disconnected account, keeps the connected ones', () => {
    const rows = [c('6aa7a0f6'), c('6a6dd609'), c('6aa7e25a')]
    expect(onlyConnected(rows, connectedIds).map(r => r.accountId)).toEqual(['6aa7a0f6', '6aa7e25a'])
  })
  it('keeps a comment with no account id (nothing to judge)', () => {
    const rows = [{ id: 'x' } as { accountId?: string }, c('6a6dd609')]
    expect(onlyConnected(rows, connectedIds).map(r => r.accountId)).toEqual([undefined])
  })
})

describe('only posts with comments, read a few accounts at a time (3 Nov 2026)', async () => {
  const { withComments, inBatches } = await import('../app/api/social/inbox/route')
  it('drops the posts nobody commented on, keeps ones with no count', () => {
    const rows = [{ id: 'a', commentCount: 0 }, { id: 'b', commentCount: 5 }, { id: 'c' }, { id: 'd', commentCount: 1 }]
    expect(withComments(rows).map(r => r.id)).toEqual(['b', 'c', 'd'])
  })
  it('never has more than the batch size in flight, and keeps the order', async () => {
    let live = 0, most = 0
    const out = await inBatches([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async n => {
      live++; most = Math.max(most, live); await new Promise(r => setTimeout(r, 5)); live--; return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90])
    expect(most).toBe(4)
  })
})
