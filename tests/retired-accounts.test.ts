import { describe, expect, it } from 'vitest'
import { retiredMatch, type RetiredAccount } from '../app/lib/retired-accounts-core'

// 30 Sep 2026: Justin's Instagram was disconnected and reconnected; the reconnect made a new row and his booked post
// said "a channel is not connected". A disconnected channel now comes back as itself.

const r = (over: Partial<RetiredAccount>): RetiredAccount => ({
  id: 'old-row', client_id: 'justin', platform: 'instagram', provider_account_id: 'z-ig', username: 'justin_engelke',
  row: {}, retired_at: '2026-09-30T05:20:00Z', ...over,
})

describe('retiredMatch', () => {
  it('the same provider account comes back as its old row', () => {
    expect(retiredMatch([r({})], { clientId: 'justin', platform: 'instagram', providerAccountId: 'z-ig', username: 'justin_engelke' })?.id).toBe('old-row')
  })
  it('a new provider id with the same handle on the same network is still that account', () => {
    expect(retiredMatch([r({})], { clientId: 'justin', platform: 'instagram', providerAccountId: 'z-new', username: '@Justin_Engelke' })?.id).toBe('old-row')
  })
  it('never another client’s, or another network’s, or another handle', () => {
    expect(retiredMatch([r({})], { clientId: 'jordan', platform: 'instagram', providerAccountId: 'z-ig', username: 'justin_engelke' })).toBeNull()
    expect(retiredMatch([r({})], { clientId: 'justin', platform: 'tiktok', providerAccountId: 'z-ig', username: 'justin_engelke' })).toBeNull()
    expect(retiredMatch([r({})], { clientId: 'justin', platform: 'instagram', providerAccountId: 'z-other', username: 'someone_else' })).toBeNull()
  })
  it('the same provider id wins over a handle match, and the latest disconnect wins among repeats', () => {
    const list = [
      r({ id: 'by-handle', provider_account_id: 'z-x', retired_at: '2026-09-30T06:00:00Z' }),
      r({ id: 'by-id-old', retired_at: '2026-09-01T00:00:00Z' }),
      r({ id: 'by-id-new', retired_at: '2026-09-29T00:00:00Z' }),
    ]
    expect(retiredMatch(list, { clientId: 'justin', platform: 'instagram', providerAccountId: 'z-ig', username: 'justin_engelke' })?.id).toBe('by-id-new')
  })
})
