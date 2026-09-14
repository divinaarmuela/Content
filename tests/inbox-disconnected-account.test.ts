import { describe, expect, it } from 'vitest'
import { sinceConnection } from '../app/api/social/messages/route'

/**
 * A DISCONNECTED ACCOUNT'S DMS ARE GONE (the owner, 14 Sep 2026:
 * "akmal.ashwin is disconnected, so its DMs shouldn't be there"). The
 * provider keeps streaming a once-connected account's threads; the inbox
 * shows only accounts still in social_accounts.
 */

const conv = (accountId: string, updatedTime?: string) => ({ id: `${accountId}-c`, accountId, updatedTime })

describe('sinceConnection', () => {
  const connectedIds = new Set(['live-1', 'live-2'])
  const connectedAt = new Map([['live-1', new Date('2026-09-01').getTime()]])

  it('drops conversations from an account that is no longer connected', () => {
    const raw = { data: [conv('live-1', '2026-09-10'), conv('akmal-gone', '2026-09-10')] }
    const out = sinceConnection(raw, connectedAt, connectedIds) as { data: { accountId: string }[] }
    expect(out.data.map(c => c.accountId)).toEqual(['live-1'])
  })

  it('keeps a connected account with no connect time, and still drops the disconnected one', () => {
    const raw = { data: [conv('live-2'), conv('akmal-gone')] }
    const out = sinceConnection(raw, connectedAt, connectedIds) as { data: { accountId: string }[] }
    expect(out.data.map(c => c.accountId)).toEqual(['live-2'])
  })

  it('still hides threads older than the connect time on a connected account', () => {
    const raw = { data: [conv('live-1', '2026-08-01'), conv('live-1', '2026-09-10')] }
    const out = sinceConnection(raw, connectedAt, connectedIds) as { data: { updatedTime: string }[] }
    expect(out.data.map(c => c.updatedTime)).toEqual(['2026-09-10'])
  })
})
