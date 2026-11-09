import { describe, expect, it } from 'vitest'
import {
  canReplyNow, cleanText, isGraphId, isThreadId, parseIgComments, parseIgPosts, parsePageComments, parsePagePosts, parseThreads, withProfile,
} from '../app/lib/md-app-inbox-core'

describe('MD App Inbox — reading Meta (9 Nov 2026)', () => {
  it('Instagram comments: oldest first, own replies marked, hidden kept', () => {
    const out = parseIgComments({ data: [
      { id: '2', text: 'second', username: 'sam', timestamp: '2026-11-09T02:00:00+0000', hidden: true },
      { id: '1', text: 'first', username: 'ana', timestamp: '2026-11-09T01:00:00+0000',
        replies: { data: [{ id: '3', text: 'thanks!', username: 'testbusinessaccount2026', timestamp: '2026-11-09T01:05:00+0000' }] } },
    ] }, 'testbusinessaccount2026')
    expect(out.map(c => c.id)).toEqual(['1', '2'])
    expect(out[1].hidden).toBe(true)
    expect(out[0].replies[0].mine).toBe(true)
    expect(out[0].mine).toBe(false)
  })

  it('Page comments carry the commenter name and picture; the Page itself is mine', () => {
    const out = parsePageComments({ data: [
      { id: 'c1', message: 'hi', created_time: '2026-11-09T01:00:00+0000', from: { id: '77', name: 'Ana', picture: { data: { url: 'https://x/p.jpg' } } },
        comments: { data: [{ id: 'c2', message: 'hello', from: { id: 'P1', name: 'MD Media Test' } }] } },
    ] }, 'P1')
    expect(out[0]).toMatchObject({ author: 'Ana', picture: 'https://x/p.jpg', mine: false })
    expect(out[0].replies[0].mine).toBe(true)
  })

  it('posts from both platforms', () => {
    expect(parseIgPosts({ data: [{ id: '9', caption: 'c', comments_count: 3, media_type: 'IMAGE', media_url: 'https://m' }] })[0])
      .toMatchObject({ id: '9', comments: 3, thumb: 'https://m' })
    expect(parsePagePosts({ data: [{ id: 'P_1', message: 'm', comments: { summary: { total_count: 2 } } }] })[0].comments).toBe(2)
  })

  it('threads: the other person, newest thread first, messages oldest first, profile filled in', () => {
    const t = parseThreads({ data: [
      { id: 't1', updated_time: '2026-11-08T00:00:00+0000', participants: { data: [{ id: 'ME' }, { id: 'U1', username: 'ana' }] },
        messages: { data: [
          { id: 'm2', message: 'reply', from: { id: 'ME' }, created_time: '2026-11-08T00:01:00+0000' },
          { id: 'm1', message: 'hi', from: { id: 'U1' }, created_time: '2026-11-08T00:00:00+0000' },
        ] } },
      { id: 't2', updated_time: '2026-11-09T00:00:00+0000', participants: { data: [{ id: 'U2', name: 'Bo' }, { id: 'ME' }] } },
    ] }, 'ME')
    expect(t.map(x => x.id)).toEqual(['t2', 't1'])
    expect(t[1].withName).toBe('ana')
    expect(t[1].messages.map(m => m.fromMe)).toEqual([false, true])
    expect(withProfile(t[1], { name: 'Ana Lee', profile_pic: 'https://p' })).toMatchObject({ withName: 'Ana Lee', picture: 'https://p' })
  })

  it('replies are allowed only inside 24 hours of the person\'s last message', () => {
    const [t] = parseThreads({ data: [{ id: 't', participants: { data: [{ id: 'ME' }, { id: 'U' }] },
      messages: { data: [{ id: 'm', message: 'hi', from: { id: 'U' }, created_time: '2026-11-09T00:00:00Z' }] } }] }, 'ME')
    expect(canReplyNow(t, Date.parse('2026-11-09T23:00:00Z'))).toBe(true)
    expect(canReplyNow(t, Date.parse('2026-11-10T01:00:00Z'))).toBe(false)
  })

  it('cleans what a person types and refuses odd ids', () => {
    expect(cleanText('  hi ')).toBe('hi')
    expect(cleanText('   ')).toBeNull()
    expect(cleanText('x'.repeat(1001))).toBeNull()
    expect(isGraphId('1789_42')).toBe(true)
    expect(isGraphId('../me')).toBe(false)
    expect(isThreadId('aWdfZAG06')).toBe(true)
    expect(isThreadId('a/b')).toBe(false)
  })
})
