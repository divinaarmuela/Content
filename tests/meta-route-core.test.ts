import { describe, expect, it } from 'vitest'
import {
  META_DISPATCH_LEAD_MS, dueForDispatch, extOf, instagramRoute, mediaProblem, metaFailure, metaHold,
  metaRequestFor, readMetaJobState, routeMark, unsupportedOptions,
} from '../app/lib/meta-route-core'

/**
 * Which road a post's Instagram takes — Zernio, or the agency's own Meta app
 * (1 Oct 2026, branch meta-publish). Pure; the publish path itself is in
 * tests/meta-publish.test.ts.
 */

const JPG = { url: 'https://media.example.com/a/b/photo.jpg', type: 'image' as const }
const PNG = { url: 'https://media.example.com/a/b/photo.png', type: 'image' as const }
const MP4 = { url: 'https://media.example.com/a/b/clip.mp4', type: 'video' as const }
const MOV = { url: 'https://media.example.com/a/b/clip.MOV', type: 'video' as const }
const ACCT = { id: '17841425316746644', username: 'testbusinessaccount2026', status: 'active' }

const base = {
  clientViaMeta: true, metaAccounts: [ACCT], channelUsername: '@TestBusinessAccount2026', options: null, media: [JPG],
}

describe('instagramRoute — the rule', () => {
  it('goes through Meta with the switch on, an active connection for the same account, and JPEG/MP4 files', () => {
    expect(instagramRoute(base)).toEqual({ via: 'meta', igUserId: '17841425316746644', username: 'testbusinessaccount2026' })
    expect(instagramRoute({ ...base, media: [MP4] }).via).toBe('meta')
    expect(instagramRoute({ ...base, media: [MOV, JPG] }).via).toBe('meta')
  })

  it('switch off (the default, every other client): Zernio, with nothing to say', () => {
    expect(instagramRoute({ ...base, clientViaMeta: false })).toEqual({ via: 'zernio', reason: null })
    expect(instagramRoute({ ...base, clientViaMeta: null })).toEqual({ via: 'zernio', reason: null })
    expect(instagramRoute({ ...base, clientViaMeta: undefined })).toEqual({ via: 'zernio', reason: null })
  })

  it('no active connection, or a different account: Zernio, and says why', () => {
    expect(instagramRoute({ ...base, metaAccounts: [] })).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/No Instagram account is connected directly/) })
    expect(instagramRoute({ ...base, metaAccounts: [{ ...ACCT, status: 'expired' }] })).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/needs reconnecting/) })
    expect(instagramRoute({ ...base, channelUsername: 'someoneelse' })).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/@someoneelse is not the Instagram account connected directly/) })
    expect(instagramRoute({ ...base, channelUsername: null })).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/no username/) })
  })

  it('options this road does not send yet keep the post on Zernio, named', () => {
    const r = instagramRoute({ ...base, options: { collaborators: ['a'], locationId: '123' } })
    expect(r).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/collaborators, a location/) })
    // defaults are not requests
    expect(instagramRoute({ ...base, options: { commentsEnabled: true, isAiGenerated: false, muteAudio: false } }).via).toBe('meta')
    // what it does send
    expect(instagramRoute({ ...base, media: [MP4], options: { kind: 'reel', shareToFeed: false, firstComment: '#tags', caption: 'own', thumbnailUrl: 'https://media.example.com/c.jpg' } }).via).toBe('meta')
  })

  it('a PNG (Zernio converts it; Instagram\'s own API does not) stays on Zernio', () => {
    expect(instagramRoute({ ...base, media: [JPG, PNG] })).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/JPEG pictures only, and file 2 is PNG/) })
    expect(instagramRoute({ ...base, media: [{ url: 'https://x/v.webm', type: 'video' }] })).toMatchObject({ reason: expect.stringMatching(/MP4 or MOV video only/) })
    expect(instagramRoute({ ...base, media: [MP4], options: { thumbnailUrl: 'https://x/cover.png' } })).toMatchObject({ reason: expect.stringMatching(/JPEG cover/) })
  })
})

describe('helpers', () => {
  it('extOf reads the path, not the query', () => {
    expect(extOf('https://x/a/b.JPG?sig=1.png')).toBe('jpg')
    expect(extOf('https://x/a/noext')).toBe('')
  })
  it('a file with no extension is let through (the job checks its Content-Type)', () => {
    expect(mediaProblem([{ url: 'https://x/a/blob', type: 'image' }])).toBeNull()
  })
  it('unsupportedOptions is empty for nothing', () => {
    expect(unsupportedOptions(null)).toEqual([])
    expect(unsupportedOptions({ trialGraduation: 'MANUAL' } as never)).toEqual(['a Trial Reel'])
  })
  it('routeMark: the channel line', () => {
    expect(routeMark({ via: 'meta', igUserId: '1', username: 'x' })).toBe('Instagram · direct (Meta)')
    expect(routeMark({ via: 'zernio', reason: null })).toBeNull()
    expect(routeMark({ via: 'zernio', reason: 'why' })).toBe('Instagram · Zernio — why')
  })
  it('readMetaJobState needs the account', () => {
    expect(readMetaJobState(null)).toBeNull()
    expect(readMetaJobState({ creation_id: 'c' })).toBeNull()
    expect(readMetaJobState({ ig_user_id: '1', creation_id: 'c' })).toMatchObject({ ig_user_id: '1', creation_id: 'c', media_id: null })
  })
})

describe('metaRequestFor — what Meta is asked for', () => {
  it('one picture → IMAGE with the caption; the channel\'s own caption wins', () => {
    expect(metaRequestFor({ caption: 'shared', media: [JPG] })).toEqual({ ok: true, req: { kind: 'IMAGE', imageUrl: JPG.url, caption: 'shared' }, firstComment: null })
    expect(metaRequestFor({ caption: 'shared', media: [JPG], options: { caption: 'mine' } })).toMatchObject({ req: { caption: 'mine' } })
  })
  it('one video → REELS, share-to-feed off only when chosen, the cover', () => {
    expect(metaRequestFor({ caption: 'c', media: [MP4], options: { shareToFeed: false, thumbnailUrl: 'https://x/c.jpg' } }))
      .toEqual({ ok: true, req: { kind: 'REELS', videoUrl: MP4.url, caption: 'c', coverUrl: 'https://x/c.jpg', shareToFeed: false }, firstComment: null })
    expect(metaRequestFor({ caption: 'c', media: [MP4], options: { shareToFeed: true } })).toMatchObject({ req: { kind: 'REELS' } })
    expect((metaRequestFor({ caption: 'c', media: [MP4], options: { shareToFeed: true } }) as { req: Record<string, unknown> }).req.shareToFeed).toBeUndefined()
  })
  it('several files → CAROUSEL in the post\'s order', () => {
    const r = metaRequestFor({ caption: 'c', media: [MP4, JPG, MOV] })
    expect(r).toEqual({ ok: true, firstComment: null, req: { kind: 'CAROUSEL', caption: 'c', items: [
      { type: 'video', url: MP4.url }, { type: 'image', url: JPG.url }, { type: 'video', url: MOV.url },
    ] } })
  })
  it('a Story is one file and carries no caption', () => {
    expect(metaRequestFor({ caption: 'c', media: [JPG], options: { kind: 'story' } })).toEqual({ ok: true, req: { kind: 'STORIES', media: { type: 'image', url: JPG.url } }, firstComment: null })
    expect(metaRequestFor({ caption: 'c', media: [JPG, JPG], options: { kind: 'story' } })).toEqual({ ok: false, reason: 'A Story is one picture or one video' })
  })
  it('the first comment travels', () => {
    expect(metaRequestFor({ caption: 'c', media: [JPG], options: { firstComment: '  #one #two ' } })).toMatchObject({ firstComment: '#one #two' })
  })
  it('refuses what Instagram would refuse', () => {
    expect(metaRequestFor({ caption: 'c', media: [JPG], options: { kind: 'reel' } })).toEqual({ ok: false, reason: 'A Reel needs a video' })
    expect(metaRequestFor({ caption: 'x'.repeat(2201), media: [JPG] })).toMatchObject({ ok: false, reason: expect.stringMatching(/2,200/) })
    expect(metaRequestFor({ caption: 'c', media: Array.from({ length: 11 }, () => JPG) })).toMatchObject({ ok: false })
    expect(metaRequestFor({ caption: 'c', media: [] })).toMatchObject({ ok: false })
  })
})

describe('holding a Meta job until its time', () => {
  const now = Date.parse('2026-10-01T10:00:00.000Z')
  const at = (min: number) => new Date(now + min * 60_000).toISOString()
  it('a Meta job ahead of its time is held; due or past is not; a Zernio job never is', () => {
    expect(metaHold({ provider: 'meta_ig', scheduled_for: at(30) }, now)).toEqual({ held: true, until: at(30) })
    expect(metaHold({ provider: 'meta_ig', scheduled_for: at(0) }, now)).toEqual({ held: false })
    expect(metaHold({ provider: 'meta_ig', scheduled_for: at(-5) }, now)).toEqual({ held: false })
    expect(metaHold({ provider: 'meta_ig', scheduled_for: null }, now)).toEqual({ held: false })
    expect(metaHold({ provider: null, scheduled_for: at(30) }, now)).toEqual({ held: false })
  })
  it('the dispatcher hands a Meta job over only within the lead; every Zernio job at once', () => {
    expect(dueForDispatch({ provider: 'meta_ig', scheduled_for: at(60) }, now)).toBe(false)
    expect(dueForDispatch({ provider: 'meta_ig', scheduled_for: new Date(now + META_DISPATCH_LEAD_MS).toISOString() }, now)).toBe(true)
    expect(dueForDispatch({ provider: null, scheduled_for: at(60 * 24) }, now)).toBe(true)
  })
})

describe('metaFailure — Meta\'s refusals in words', () => {
  it('an expired token says reconnect, and is not retried', () => {
    const f = metaFailure({ message: 'Error validating access token (code 190)', status: 400, detail: { code: 190, subcode: 463, transient: false, userMessage: null } })
    expect(f.retry).toBe(false)
    expect(f.words).toMatch(/^Instagram \(direct, Meta\): the connection has expired.*reconnect/)
  })
  it('a known subcode becomes a sentence; otherwise Meta\'s own words', () => {
    expect(metaFailure({ message: 'Invalid parameter (code 9004/2207052)', status: 400, detail: { code: 9004, subcode: 2207052, transient: false, userMessage: null } }))
      .toEqual({ retry: false, words: 'Instagram (direct, Meta): Instagram could not fetch the file from its link' })
    expect(metaFailure({ message: 'raw', status: 400, detail: { code: 100, subcode: null, transient: false, userMessage: 'The aspect ratio is not supported.' } }).words)
      .toBe('Instagram (direct, Meta): The aspect ratio is not supported.')
  })
  it('the network, a 5xx, a rate limit, is_transient and "still processing" are retried', () => {
    expect(metaFailure({ message: 'Could not reach Instagram (https://graph.instagram.com/v23.0/1/media)' }).retry).toBe(true)
    expect(metaFailure({ message: 'x', status: 503 }).retry).toBe(true)
    expect(metaFailure({ message: 'x', status: 400, detail: { code: 4, subcode: null, transient: false, userMessage: null } }).retry).toBe(true)
    expect(metaFailure({ message: 'x', status: 400, detail: { code: 2, subcode: null, transient: true, userMessage: null } }).retry).toBe(true)
    expect(metaFailure({ message: 'Instagram is still processing the media — try publishing again shortly' }).retry).toBe(true)
  })
  it('our own refusals with no status are not retried', () => {
    expect(metaFailure({ message: 'That Instagram account is not connected directly' }).retry).toBe(false)
    expect(metaFailure({ message: "Instagram's publishing limit is reached (25 of 25 in 24 hours)", status: undefined }).retry).toBe(false)
  })
})
