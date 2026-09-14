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
