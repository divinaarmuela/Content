import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { composerReducer } from '../app/lib/schedule-compose-core'
import { changesSince } from '../app/dashboard/social/schedule/PostVersions'

// the owner, 2 Nov 2026, after Manal's two booked posts came off the schedule: captions lost, "Cancel post" misread
describe('a channel unticked and ticked again keeps its caption', () => {
  it('the caption is kept aside, not posted, and comes back', () => {
    const s0 = { itemId: 'i', slides: [], caption: '', channels: ['tt', 'ig'], scheduledFor: null, perChannel: { tt: { caption: 'TikTok words' }, ig: { caption: 'IG words' } }, dirty: false } as never
    const off = composerReducer(s0, { type: 'channel', id: 'tt', on: false } as never) as { perChannel: Record<string, unknown>; channels: string[] }
    expect(off.channels).toEqual(['ig'])
    expect(off.perChannel.tt).toBeUndefined()
    const back = composerReducer(off as never, { type: 'channel', id: 'tt', on: true } as never) as { perChannel: Record<string, { caption?: string }> }
    expect(back.perChannel.tt?.caption).toBe('TikTok words')
  })
})

describe('Cancel says what it does', () => {
  it('the whole post, not the edit', () => {
    const core = readFileSync('app/lib/post-window-core.ts', 'utf8')
    expect(core).toContain("go: 'Yes, cancel the post'")
    expect(core).toContain('To stop editing instead, just close this window')
  })
})

describe('versions', () => {
  it('says what changed since a version', () => {
    const v = { n: 1, slides: [{ url: 'a', type: 'video' }], caption: '', channels: ['tt', 'li'], per_channel: { tt: { caption: 'x' }, li: { caption: 'long' } }, scheduled_for: '2026-11-07T03:30:00.000Z' } as never
    const now = { slides: [{ url: 'a', type: 'video' }], caption: '', channels: ['tt'], per_channel: { tt: { caption: 'y' } }, scheduled_for: '2026-11-07T03:30:00.000Z' } as never
    expect(changesSince(v, now, ch => ch.toUpperCase())).toEqual(['LI taken off', 'caption changed on TT'])
  })
  it('a post taken off the schedule offers to book it back; versions are read from the saved copies', () => {
    const w = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(w).toContain('Book it back for {melb(wasBooked.at)}')
    expect(w).toContain("{ key: 'versions', label: 'Versions'")
    const r = readFileSync('app/api/posts/[id]/versions/route.ts', 'utf8')
    expect(r).toContain("table<PostVersion>('post_versions')")
  })
})
