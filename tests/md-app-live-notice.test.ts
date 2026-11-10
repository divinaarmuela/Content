import { describe, it, expect } from 'vitest'
import { liveNotice } from '@/app/lib/md-app-core'

describe('live notices', () => {
  it('a new Facebook comment names the commenter', () => {
    expect(liveNotice({ object: 'page', field: 'feed', payload: { item: 'comment', verb: 'add', from: { name: 'Akmal Ashwin' } } }))
      .toEqual({ label: 'New Facebook comment from Akmal Ashwin', area: 'comments', platform: 'facebook' })
  })
  it('Instagram comments and messages, leads', () => {
    expect(liveNotice({ object: 'instagram', field: 'comments', payload: { from: { username: 'crab' } } })!.label).toBe('New Instagram comment from crab')
    expect(liveNotice({ object: 'page', field: 'messages', payload: { message: { text: 'hi' } } })!.area).toBe('messages')
    expect(liveNotice({ object: 'page', field: 'leadgen', payload: {} })!.area).toBe('leads')
  })
  it('ignores edits, likes, echoes and read receipts', () => {
    expect(liveNotice({ object: 'page', field: 'feed', payload: { item: 'reaction', verb: 'add' } })).toBeNull()
    expect(liveNotice({ object: 'page', field: 'messages', payload: { message: { is_echo: true } } })).toBeNull()
    expect(liveNotice({ object: 'page', field: 'messages', payload: { read: { watermark: 1 } } })).toBeNull()
  })
})
