import { describe, expect, it } from 'vitest'
import { AUTO_PREFIX, readAutomationTouches, withAutomationTouches } from '../app/lib/people-crm-core'

// the owner, 29–30 Sep 2026: "tracking data in the followers page … which trigger, clicked" · "there is no CRM part
// for the automation data". The shapes below are Zernio's, copied from the 100M test automation's live log.
const ACCOUNT = '6aa8a054726ebfe037ee7def'
const LIST = { automations: [
  { id: 'a1', accountId: ACCOUNT, postTitle: 'E2E Reel', keywords: ['LINK'] },
  { id: 'other', accountId: 'someone-else', postTitle: 'Not ours', keywords: ['X'] },
] }
const LOGS = { a1: { logs: [
  { commenterName: 'crestlineconsultants', commentText: 'LINK', status: 'sent', error: null, clickedAt: '2026-09-29T08:53:24.502Z', clickCount: 2, createdAt: '2026-09-29T08:50:47.328Z' },
  { commenterName: 'lxuuryybuilds', commentText: 'Link', status: 'skipped', error: 'Already sent DM to this commenter', clickedAt: null, clickCount: 0, createdAt: '2026-09-29T08:49:48.404Z' },
  { commenterName: 'yusuf.munshi.52035', commentText: 'MDTEST7421', status: 'failed', error: 'Permission denied.', clickedAt: null, clickCount: 0, createdAt: '2026-09-29T12:07:33.218Z' },
] }, other: { logs: [{ commenterName: 'nope', commentText: 'X', status: 'sent', createdAt: '2026-09-29T01:00:00Z' }] } }

describe('automation touches, per person (the Inbox’s "About this person")', () => {
  const touches = readAutomationTouches(LIST, LOGS, new Set([ACCOUNT]))
  it('reads only this client’s automations, one touch per logged comment', () => {
    expect(touches.map(t => t.username)).toEqual(['crestlineconsultants', 'lxuuryybuilds', 'yusuf.munshi.52035'])
    expect(touches[0]).toMatchObject({ outcome: 'sent', clicks: 2, post: 'E2E Reel', keyword: 'LINK' })
  })
  const rows = withAutomationTouches([], touches)
  const crest = rows.find(r => r.key === 'crestlineconsultants')!
  it('one row per commenter: the comment, the DM and the clicks', () => {
    expect(crest.auto_dms).toBe(1)
    expect(crest.auto_clicks).toBe(2)
    expect(crest.timeline.map(e => e.what)).toEqual([
      `${AUTO_PREFIX}clicked the button ×2`, `${AUTO_PREFIX}DM sent`, `${AUTO_PREFIX}commented “LINK”`,
    ])
    expect(crest.first_seen).toBe('2026-09-29')
    expect(crest.last_active).toBe('2026-09-29')
    expect(crest.timeline.find(e => e.what === `${AUTO_PREFIX}DM sent`)?.link).toBe('View DM')
  })
  it('a failure says why; a skip is not a DM', () => {
    const yusuf = rows.find(r => r.key === 'yusuf.munshi.52035')!
    expect(yusuf.timeline.find(e => e.what === `${AUTO_PREFIX}DM failed`)?.detail).toBe('Permission denied.')
    expect(yusuf.auto_dms).toBe(0)
    expect(rows.find(r => r.key === 'lxuuryybuilds')!.auto_dms).toBe(0)
  })
  it('every line is marked as the automation’s; nothing claims "read" per person', () => {
    expect(rows.filter(r => r.timeline.some(e => e.what.startsWith(AUTO_PREFIX))).map(r => r.key).sort()).toEqual(['crestlineconsultants', 'lxuuryybuilds', 'yusuf.munshi.52035'])
    expect(JSON.stringify(rows)).not.toMatch(/read|delivered/i)
  })
})

describe('whether they read the automation DM (the DM itself says so)', () => {
  it('reads the automation’s own message after their comment; unread or someone else’s message is not "read"', async () => {
    const { readAtFromThread } = await import('../app/lib/people-crm-core')
    const thread = { messages: [
      { message: 'Hey!', direction: 'outgoing', createdAt: '2026-09-30T02:27:24.871Z', deliveryStatus: 'read', readAt: '2026-09-30T02:27:24.872Z', sentVia: 'comment_automation' },
    ] }
    expect(readAtFromThread(thread, '2026-09-30T02:27:20.000Z')).toBe('2026-09-30T02:27:24.872Z')
    expect(readAtFromThread({ messages: [{ ...thread.messages[0], deliveryStatus: 'delivered' }] }, '2026-09-30T02:27:20.000Z')).toBeNull()
    expect(readAtFromThread({ messages: [{ ...thread.messages[0], sentVia: undefined }] }, '2026-09-30T02:27:20.000Z')).toBeNull()
  })
})

describe('a DM counts only when they wrote (30 Sep 2026: the automation’s own DM made people "DMed")', () => {
  it('the conversation list notes only threads with a message of theirs unread', async () => {
    const { touchesFromConversations, touchFromThread } = await import('../app/lib/inbox-people-core')
    const got = touchesFromConversations({ data: [
      { id: 'a', participantUsername: 'yusuf.munshi.52035', unreadCount: 0 },
      { id: 'b', participantUsername: 'nuria_jewell', unreadCount: 2 },
    ] })
    expect(got.map(t => t.username)).toEqual(['nuria_jewell'])
    expect(touchFromThread({ id: 'a', participantUsername: 'yusuf.munshi.52035' }, null)).toEqual([])
    expect(touchFromThread({ id: 'a', participantUsername: 'yusuf.munshi.52035' }, '2026-09-30T02:00:00Z').map(t => t.username)).toEqual(['yusuf.munshi.52035'])
  })
})
