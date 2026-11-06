import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  UNSENT_WORDS, annotateComments, clientsToRecheck, correctFromThread, filterByReply, foldInboxEvent, freshnessWords,
  fromLivePage, replyCounts, replyLabel, replyLogRow, replyState, threadLayout, whoSent, withoutUnsent,
  type CopyRow, type InboxEvent, type ZComment,
} from '../app/lib/inbox-copy-core'
import { dayLabel, isMine, messageAt, type InboxMessage } from '../app/lib/inbox-core'
import { keepUnchanged } from '../lib/db-client'
import { parseZernioEvent } from '../app/lib/zernio-webhook-core'

const ev = (over: Partial<InboxEvent>): InboxEvent => ({ detail: 'message.received', accountId: 'acc1', conversationId: 'c1', ...over })
const row = (over: Partial<CopyRow['data']> = {}, last: string | null = 'm1'): CopyRow => ({
  data: { id: 'c1', accountId: 'acc1', lastMessage: 'hello', updatedTime: '2026-11-06T01:00:00Z', unreadCount: 0, ...over },
  last_message_id: last, unsent_ids: [],
})

describe('webhook events folded into the conversation copy', () => {
  it('a received message becomes the preview, moves the time and counts as unread', () => {
    const out = foldInboxEvent(row(), ev({ messageId: 'm2', text: 'is it open sunday?', at: '2026-11-06T02:00:00Z', incoming: true }))!
    expect(out.data.lastMessage).toBe('is it open sunday?')
    expect(out.data.updatedTime).toBe('2026-11-06T02:00:00Z')
    expect(out.data.unreadCount).toBe(1)
    expect(out.last_message_id).toBe('m2')
  })
  it('the same delivery twice counts once', () => {
    const e = ev({ messageId: 'm2', text: 'hi', at: '2026-11-06T02:00:00Z' })
    const once = foldInboxEvent(row(), e)!
    expect(foldInboxEvent(once, e)!.data.unreadCount).toBe(1)
  })
  it('our own sent message is the preview but never unread', () => {
    const out = foldInboxEvent(row(), ev({ detail: 'message.sent', messageId: 'm2', text: 'Yes!', at: '2026-11-06T02:00:00Z', incoming: false }))!
    expect(out.data.lastMessage).toBe('Yes!')
    expect(out.data.unreadCount).toBe(0)
  })
  it('an older message arriving late does not replace a newer preview', () => {
    const out = foldInboxEvent(row(), ev({ messageId: 'm0', text: 'old', at: '2026-11-05T00:00:00Z' }))!
    expect(out.data.lastMessage).toBe('hello')
  })
  it('an edit of the last message changes the preview; an edit of an older one changes nothing', () => {
    expect(foldInboxEvent(row(), ev({ detail: 'message.edited', messageId: 'm1', text: 'hello!!' }))!.data.lastMessage).toBe('hello!!')
    expect(foldInboxEvent(row(), ev({ detail: 'message.edited', messageId: 'm0', text: 'x' }))).toBeNull()
  })
  it('a new conversation is created from its first message', () => {
    const out = foldInboxEvent(null, ev({ messageId: 'm1', text: 'hey', at: '2026-11-06T02:00:00Z', participantUsername: 'sam', platform: 'instagram' }))!
    expect(out.data).toMatchObject({ id: 'c1', accountId: 'acc1', participantUsername: 'sam', platform: 'instagram', lastMessage: 'hey', unreadCount: 1 })
  })
  it('read / delivered receipts change nothing shown', () => {
    expect(foldInboxEvent(row(), ev({ detail: 'message.read' }))).toBeNull()
  })
})

describe('UNSENT: never shown with its old words', () => {
  it('an unsent last message: the preview says so, and the old text is not kept anywhere', () => {
    const out = foldInboxEvent(row({ unreadCount: 1 }), ev({ detail: 'message.deleted', messageId: 'm1', text: 'SECRET old words' }))!
    expect(out.data.lastMessage).toBe(UNSENT_WORDS)
    expect(JSON.stringify(out)).not.toContain('SECRET')
    expect(out.unsent_ids).toEqual(['m1'])
    expect(out.data.unreadCount).toBe(0)
  })
  it('an unsent older message leaves the preview, but is remembered', () => {
    const out = foldInboxEvent(row(), ev({ detail: 'message.deleted', messageId: 'm0' }))!
    expect(out.data.lastMessage).toBe('hello')
    expect(out.unsent_ids).toEqual(['m0'])
  })
  it('the live thread drops every unsent message by id, whatever Zernio still returns', () => {
    const msgs: InboxMessage[] = [{ id: 'm0', text: 'a' }, { id: 'm1', text: 'gone' }, { id: 'm2', text: 'b' }]
    expect(withoutUnsent(msgs, ['m1']).map(m => m.id)).toEqual(['m0', 'm2'])
  })
  it('a redelivered message.received for an unsent id does not bring it back', () => {
    const r = { ...row(), unsent_ids: ['m9'] }
    expect(foldInboxEvent(r, ev({ messageId: 'm9', text: 'back?', at: '2026-11-07T00:00:00Z' }))).toBeNull()
  })
  it("Zernio's live page does not undo our unsent preview when nothing newer arrived", () => {
    const had: CopyRow = { ...row({ lastMessage: UNSENT_WORDS }), unsent_ids: ['m1'] }
    const live = fromLivePage({ id: 'c1', lastMessage: 'SECRET', updatedTime: '2026-11-06T01:00:00Z' }, had)
    expect(live.data.lastMessage).toBe(UNSENT_WORDS)
    expect(live.unsent_ids).toEqual(['m1'])
    const newer = fromLivePage({ id: 'c1', lastMessage: 'new one', updatedTime: '2026-11-06T03:00:00Z' }, had)
    expect(newer.data.lastMessage).toBe('new one')
  })
  it('the webhook parser never carries the text of a message.deleted', () => {
    const parsed = parseZernioEvent({
      id: 'evt1', event: 'message.deleted', deletedAt: '2026-11-06T02:00:00Z',
      message: { id: 'm1', conversationId: 'c1', direction: 'incoming', text: 'SECRET' },
      conversation: { id: 'c1' }, account: { accountId: 'acc1', platform: 'instagram' },
    } as never) as { action: Record<string, unknown> }
    expect(parsed.action.kind).toBe('inbox')
    expect(parsed.action.messageId).toBe('m1')
    expect(parsed.action.text).toBeUndefined()
  })
})

describe('opening one conversation corrects the copy', () => {
  it('the preview becomes the newest message still there, and opening clears unread', () => {
    const out = correctFromThread(row({ lastMessage: 'stale', unreadCount: 3 }), [
      { id: 'a', text: 'first', createdTime: '2026-11-06T00:00:00Z' },
      { id: 'b', text: 'latest', createdTime: '2026-11-06T04:00:00Z' },
    ], true)
    expect(out.data).toMatchObject({ lastMessage: 'latest', updatedTime: '2026-11-06T04:00:00Z', unreadCount: 0 })
    expect(out.last_message_id).toBe('b')
  })
})

describe('Replied / Needs a reply on comments', () => {
  // the shape Zernio returned live on 6 Nov 2026 (GET /inbox/comments/{postId}): from.isOwner, replies[]
  const c = (id: string, over: Partial<ZComment> = {}): ZComment => ({
    id, message: 'love it', createdTime: '2026-11-06T01:00:00+0000', from: { id: 'u1', username: 'fan', isOwner: false }, replies: [], ...over,
  })
  const ownerReply: ZComment = { id: 'r1', message: 'thank you!', createdTime: '2026-11-06T02:00:00+0000', from: { username: 'luxe', isOwner: true } }

  it('a comment with no reply from the account needs a reply', () => {
    expect(replyState(c('1'), []).state).toBe('needs')
  })
  it('a reply made on Instagram (the account itself is the author) counts, with no name', () => {
    const s = replyState(c('1', { replies: [ownerReply] }), [])
    expect(s).toMatchObject({ state: 'replied', by: null, outside: true })
    expect(replyLabel(s, 'instagram', Date.parse('2026-11-06T05:00:00Z'))).toBe('Replied on Instagram · 3h ago')
  })
  it('another person replying does not count as the team replying', () => {
    expect(replyState(c('1', { replies: [{ id: 'r2', from: { username: 'friend', isOwner: false } }] }), []).state).toBe('needs')
  })
  it('a reply sent from the app names who on the team sent it, even once Zernio shows it too', () => {
    const s = replyState(c('1', { replies: [ownerReply] }), [{ target_id: '1', kind: 'comment', by_name: 'Sam', at: '2026-11-06T01:59:50Z' }])
    expect(s).toMatchObject({ state: 'replied', by: 'Sam' })
    expect(replyLabel(s, 'instagram', Date.parse('2026-11-06T02:30:00Z'))).toBe('Replied by Sam · 30 min ago')
  })
  it("a private reply (DM) is not a public reply — the comment still needs one", () => {
    expect(replyState(c('1'), [{ target_id: '1', kind: 'private_reply', by_name: 'Sam', at: '2026-11-06T02:00:00Z' }]).state).toBe('needs')
  })
  it("the account's own comment is not waiting for anyone and is not counted", () => {
    const list = annotateComments([c('1'), c('2', { replies: [ownerReply] }), c('3', { from: { isOwner: true } })], [])
    expect(list.map(x => x.reply.state)).toEqual(['needs', 'replied', 'own'])
    expect(replyCounts(list)).toEqual({ needs_reply: 1, replied: 1 })
    expect(filterByReply(list, 'needs').map(x => x.id)).toEqual(['1'])
    expect(filterByReply(list, 'replied').map(x => x.id)).toEqual(['2'])
    expect(filterByReply(list, 'all')).toHaveLength(3)
  })
})

describe('the reply log', () => {
  it('records who, when, where, which comment or conversation, and the words', () => {
    const r = replyLogRow(
      { kind: 'comment', teamUserId: 'tu1', byName: 'Sam', targetId: 'cm1', postId: 'p1', accountId: 'acc1', text: 'Thanks!' },
      { platform: 'instagram', client_id: 'cl1' }, '2026-11-06T02:00:00Z',
    )
    expect(r).toEqual({
      kind: 'comment', team_user_id: 'tu1', by_name: 'Sam', at: '2026-11-06T02:00:00Z', platform: 'instagram',
      client_id: 'cl1', account_id: 'acc1', target_id: 'cm1', post_id: 'p1', text: 'Thanks!',
    })
  })
  it('names the sender of a DM sent from the app; a message sent elsewhere has no name', () => {
    const log = [{ kind: 'dm', target_id: 'c1', text: 'See you then', at: '2026-11-06T02:00:05Z', by_name: 'Sam' }]
    expect(whoSent({ text: 'See you then', createdTime: '2026-11-06T02:00:00Z', direction: 'outgoing' }, 'c1', log)).toBe('Sam')
    expect(whoSent({ text: 'See you then', createdTime: '2026-11-07T02:00:00Z' }, 'c1', log)).toBeNull()
    expect(whoSent({ text: 'different', createdTime: '2026-11-06T02:00:00Z' }, 'c1', log)).toBeNull()
    expect(whoSent({ text: 'See you then', createdTime: '2026-11-06T02:00:00Z' }, 'c2', log)).toBeNull()
  })
  it('replies are logged by the routes only after Zernio accepted them', () => {
    const comments = readFileSync('app/api/social/comments/route.ts', 'utf8')
    expect(comments.indexOf('replyToComment(postId, commentId, message)')).toBeLessThan(comments.indexOf("logReply({ kind: 'comment'"))
    const messages = readFileSync('app/api/social/messages/route.ts', 'utf8')
    expect(messages.indexOf('sendConversationMessage(conversationId')).toBeLessThan(messages.indexOf("logReply({ kind: 'dm'"))
  })
})

describe('freshness and the re-check', () => {
  const now = Date.parse('2026-11-06T10:00:00Z')
  it('says how old the copy is in plain words', () => {
    expect(freshnessWords('2026-11-06T09:59:30Z', false, now)).toBe('Updated just now')
    expect(freshnessWords('2026-11-06T09:56:00Z', false, now)).toBe('Updated 4 min ago')
    expect(freshnessWords('2026-11-06T08:00:00Z', false, now)).toBe('Updated 2 hours ago')
    expect(freshnessWords(null, true, now)).toBe('Checking for anything new…')
  })
  it('re-checks only clients viewed in the last 3 hours and not just checked', () => {
    expect(clientsToRecheck([
      { id: 'recent', viewed_at: '2026-11-06T09:30:00Z', checked_at: '2026-11-06T09:40:00Z' },
      { id: 'just-checked', viewed_at: '2026-11-06T09:30:00Z', checked_at: '2026-11-06T09:57:00Z' },
      { id: 'old', viewed_at: '2026-11-06T05:00:00Z', checked_at: null },
      { id: 'never', viewed_at: null, checked_at: null },
    ], now)).toEqual(['recent'])
  })
})

describe('the page draws less (measured)', () => {
  it('a refreshed list with one changed conversation hands back 1 new object out of 300 — 299 rows skip their redraw', () => {
    const cache = new Map()
    const make = (changed: number) => Array.from({ length: 300 }, (_, i) => ({ id: `k${i}`, lastMessage: i === changed ? 'new!' : `m${i}`, unreadCount: 0 }))
    const first = keepUnchanged(make(-1), cache)
    const second = keepUnchanged(make(7), cache)
    const redrawn = second.filter((r, i) => r !== first[i]).length
    expect(redrawn).toBe(1)
  })
  it('the chat layout is one pass and agrees with the old per-message scan', () => {
    const msgs: InboxMessage[] = Array.from({ length: 400 }, (_, i) => ({
      id: `m${i}`, text: 't', direction: i % 3 ? 'incoming' : 'outgoing',
      createdTime: new Date(Date.parse('2026-11-01T00:00:00Z') + i * 3600_000).toISOString(),
    }))
    const now = Date.parse('2026-11-20T00:00:00Z')
    const fast = threadLayout(msgs, {}, now)
    msgs.forEach((m, i) => {
      const prev = i > 0 ? msgs[i - 1] : null
      const newDay = !prev || dayLabel(messageAt(prev), now) !== dayLabel(messageAt(m), now)
      expect(fast[i].day !== null).toBe(newDay)
      expect(fast[i].sameSideAsPrev).toBe(!!prev && !newDay && isMine(prev) === isMine(m))
      expect(fast[i].lastOfMine).toBe(isMine(m) && !msgs.slice(i + 1).some(isMine))
    })
  })
  it('typing redraws only the box: no draft state lives on the page any more', () => {
    const page = readFileSync('app/dashboard/social/inbox/page.tsx', 'utf8')
    for (const draft of ['msgDraft', 'setDraft', 'setDmDraft', 'setDmLink']) expect(page).not.toContain(draft)
    const parts = readFileSync('app/dashboard/social/inbox/InboxParts.tsx', 'utf8')
    for (const name of ['ConvoRow', 'Bubble', 'CommentRow', 'DmComposer']) expect(parts).toContain(`export const ${name} = memo(`)
  })
})
