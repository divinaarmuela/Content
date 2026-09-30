import { describe, expect, it } from 'vitest'
import { filterConversations, lastInboundAt, mergeConversations, nextCursor, replyWindow } from '../app/lib/inbox-core'

// the owner, 30 Sep 2026: "explain the 24 hour and 7 day" — the window runs from the LEAD'S last message
const NOW = Date.parse('2026-09-30T12:00:00Z')
const h = (n: number) => new Date(NOW - n * 3600_000).toISOString()

describe('Meta’s reply window', () => {
  it('within 24 hours of their last message: any reply, and how long is left', () => {
    const w = replyWindow([{ direction: 'incoming', createdTime: h(6) }, { isFromMe: true, createdTime: h(1) }], NOW)
    expect(w).toMatchObject({ state: 'open', tag: null })
    expect(w.words).toBe('Reply window: 18h left')
  })
  it('our own later messages never reset it', () => {
    const w = replyWindow([{ direction: 'incoming', createdTime: h(30) }, { isFromMe: true, createdTime: h(1) }], NOW)
    expect(w.state).toBe('human')
  })
  it('24 hours to 7 days: a person’s reply only, tagged HUMAN_AGENT, days left', () => {
    const w = replyWindow([{ direction: 'incoming', createdTime: h(30) }], NOW)
    expect(w).toMatchObject({ state: 'human', tag: 'HUMAN_AGENT' })
    expect(w.words).toMatch(/^Team reply only — 6 days left/)
  })
  it('after 7 days, or when they never wrote: closed', () => {
    expect(replyWindow([{ direction: 'incoming', createdTime: h(24 * 8) }], NOW).state).toBe('closed')
    expect(replyWindow([{ isFromMe: true, createdTime: h(1) }], NOW).state).toBe('closed')
    expect(lastInboundAt([{ isFromMe: true, createdTime: h(1) }])).toBeNull()
  })
})

describe('the conversation list', () => {
  it('merges every page of every account, newest first, one row each', () => {
    const merged = mergeConversations([
      { data: [{ id: 'a', accountId: 'j', updatedTime: h(5) }, { id: 'b', accountId: 'j', updatedTime: h(1) }] },
      { data: [{ id: 'a', accountId: 'j', updatedTime: h(5) }, { id: 'c', accountId: 'x', updatedTime: h(3) }] },
    ])
    expect(merged.map(c => c.id)).toEqual(['b', 'c', 'a'])
  })
  it('follows the provider’s next page only while it says there is one (Jordan showed 1 of 5)', () => {
    expect(nextCursor({ pagination: { hasMore: true, nextCursor: 'abc' } })).toBe('abc')
    expect(nextCursor({ pagination: { hasMore: false, nextCursor: 'abc' } })).toBeNull()
    expect(nextCursor({})).toBeNull()
  })
  it('filters: unread, from automations (by name), and search', () => {
    const list = [
      { id: '1', participantName: 'yusuf.munshi.52035', participantUsername: '4314278915456570', unreadCount: 0 },
      { id: '2', participantName: 'NURIA JEWELL', participantUsername: 'nuria_jewell', unreadCount: 2 },
    ]
    expect(filterConversations(list, 'unread', '', new Set()).map(c => c.id)).toEqual(['2'])
    expect(filterConversations(list, 'automation', '', new Set(['yusuf.munshi.52035'])).map(c => c.id)).toEqual(['1'])
    expect(filterConversations(list, 'all', '@nuria', new Set()).map(c => c.id)).toEqual(['2'])
  })
})
