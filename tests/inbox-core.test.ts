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

describe('a number is never a person’s handle (30 Sep 2026: crestlineconsultants showed as @2655487891576698)', () => {
  it('the People notes take the name when the username is only Instagram’s number', async () => {
    const { touchesFromConversations } = await import('../app/lib/people-analytics-core')
    const got = touchesFromConversations({ data: [
      { id: '1', participantUsername: '2655487891576698', participantName: 'crestlineconsultants', updatedTime: '2026-09-29T08:50:00Z', unreadCount: 1 },
      { id: '2', participantUsername: 'nuria_jewell', participantName: 'NURIA JEWELL', unreadCount: 2 },
      { id: '3', participantUsername: '999', participantName: 'Some Person', unreadCount: 1 },
    ] })
    expect(got.map(t => t.username)).toEqual(['crestlineconsultants', 'nuria_jewell'])
  })
})

describe('the chat view (30 Sep 2026: "we need to fix chat ui"; attachments read "[Attachment]")', () => {
  it('attachments are drawn by kind; a story mention and a share say what they are', async () => {
    const { attachmentView, previewWords } = await import('../app/lib/inbox-core')
    expect(attachmentView({ type: 'image', url: 'https://x/a.jpg' })).toMatchObject({ kind: 'image', url: 'https://x/a.jpg' })
    expect(attachmentView({ type: 'video', originalType: 'ig_reel', url: 'u' }).words).toBe('Shared a Reel')
    // a shared Reel is a link to its page, never a player (Turnkey's, on Jordan's inbox)
    expect(attachmentView({ type: 'video', originalType: 'ig_reel', url: 'https://www.instagram.com/reel/Dd0woG9Bwu6/' })).toMatchObject({ kind: 'link', words: 'Shared a Reel' })
    expect(attachmentView({ type: 'share', originalType: 'story_mention', url: 'u' }).words).toBe('Mentioned the account in their story')
    expect(attachmentView({ type: 'audio', url: 'u' }).kind).toBe('audio')
    expect(previewWords('[Attachment]')).toBe('Sent an attachment')
    expect(previewWords('hi')).toBe('hi')
  })
  it('an automation’s DM is marked, with its button; our last message says Read', async () => {
    const { byAutomation, messageButtons, deliveryWords, dayLabel } = await import('../app/lib/inbox-core')
    const m = { sentVia: 'comment_automation', deliveryStatus: 'read', metadata: { metaInteractive: { buttons: [{ title: 'Book a call', url: 'https://x' }] } } }
    expect(byAutomation(m)).toBe(true)
    expect(messageButtons(m)).toEqual([{ title: 'Book a call', url: 'https://x' }])
    expect(deliveryWords(m)).toBe('Read')
    const now = Date.parse('2026-09-30T02:00:00Z')
    expect(dayLabel('2026-09-30T01:00:00Z', now)).toBe('Today')
    expect(dayLabel('2026-09-29T01:00:00Z', now)).toBe('Yesterday')
  })
})
