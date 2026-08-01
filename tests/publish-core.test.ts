import { describe, it, expect } from 'vitest'
import {
  validatePost, buildPostBody, classifyResponse, mediaTypeFor, isPlatform,
} from '../app/lib/publish-core'

const img = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: `https://x/${i}.jpg`, type: 'image' as const }))
const vid = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: `https://x/${i}.mp4`, type: 'video' as const }))

describe('validatePost', () => {
  it('accepts an ordinary Instagram carousel', () => {
    expect(validatePost({ caption: 'hello', media: img(3), platforms: ['instagram'] })).toEqual([])
  })

  it('rejects a caption longer than the platform allows, naming both numbers', () => {
    const [issue] = validatePost({ caption: 'x'.repeat(281), media: [], platforms: ['twitter'] })
    expect(issue.problem).toMatch(/281 characters/)
    expect(issue.problem).toMatch(/280/)
  })

  it('rejects mixing images and video where the platform forbids it', () => {
    const issues = validatePost({ caption: 'a', media: [...img(2), ...vid(1)], platforms: ['instagram'] })
    expect(issues.some(i => /cannot mix/.test(i.problem))).toBe(true)
  })

  it('enforces per-platform image counts', () => {
    expect(validatePost({ caption: 'a', media: img(5), platforms: ['twitter'] })[0].problem)
      .toMatch(/5 images; twitter allows 4/)
    // the same media is fine on TikTok
    expect(validatePost({ caption: 'a', media: img(5), platforms: ['tiktok'] })).toEqual([])
  })

  it('requires media where the platform demands it', () => {
    expect(validatePost({ caption: 'a', media: [], platforms: ['instagram'] })[0].problem)
      .toMatch(/requires at least one/)
    // but not where it does not
    expect(validatePost({ caption: 'a', media: [], platforms: ['twitter'] })).toEqual([])
  })

  it('rejects documents on platforms that do not take them', () => {
    const issues = validatePost({
      caption: 'a', media: [{ url: 'https://x/a.pdf', type: 'document' }], platforms: ['instagram'],
    })
    expect(issues.some(i => /does not accept documents/.test(i.problem))).toBe(true)
  })

  it('reports every platform that fails, not just the first', () => {
    const issues = validatePost({ caption: 'x'.repeat(600), media: img(6), platforms: ['twitter', 'bluesky'] })
    expect(new Set(issues.map(i => i.platform))).toEqual(new Set(['twitter', 'bluesky']))
  })

  it('treats an empty platform list as an error rather than a silent no-op', () => {
    expect(validatePost({ caption: 'a', media: [], platforms: [] })).toHaveLength(1)
  })
})

describe('buildPostBody', () => {
  const targets = [{ platform: 'instagram' as const, accountId: 'acc_1' }]

  it('schedules with an explicit timezone', () => {
    const body = buildPostBody({
      caption: 'hi', media: img(1), targets, scheduledFor: '2026-08-02T09:00:00',
    })
    expect(body.scheduledFor).toBe('2026-08-02T09:00:00')
    expect(body.timezone).toBe('Australia/Melbourne')
    expect(body.publishNow).toBeUndefined()
  })

  it('publishes immediately when there is no scheduled time', () => {
    const body = buildPostBody({ caption: 'hi', media: img(1), targets, scheduledFor: null })
    expect(body.publishNow).toBe(true)
    expect(body.scheduledFor).toBeUndefined()
  })

  it('omits mediaItems entirely when there is no media', () => {
    expect(buildPostBody({ caption: 'hi', media: [], targets }).mediaItems).toBeUndefined()
  })
})

describe('classifyResponse', () => {
  it('reports a normal creation as published', () => {
    expect(classifyResponse(200, { post: { _id: 'p1' } }))
      .toEqual({ kind: 'published', postId: 'p1', replayed: false })
  })

  it('recognises our own replayed request', () => {
    const out = classifyResponse(200, { existingPost: { _id: 'p1' } })
    expect(out).toEqual({ kind: 'published', postId: 'p1', replayed: true })
  })

  it('treats 409 content-hash as a duplicate, never as a failure', () => {
    // the post already exists on the client's account — retrying would be wrong
    expect(classifyResponse(409, { existingPost: { _id: 'p9' } }))
      .toEqual({ kind: 'duplicate', postId: 'p9' })
  })

  it('marks 429 and 5xx retryable', () => {
    expect(classifyResponse(429, {}).kind).toBe('retryable')
    expect(classifyResponse(503, {}).kind).toBe('retryable')
  })

  it('marks 4xx permanent so a bad payload is not retried forever', () => {
    expect(classifyResponse(400, { error: 'bad caption' }))
      .toEqual({ kind: 'permanent', message: 'bad caption' })
    expect(classifyResponse(401, {}).kind).toBe('permanent')
  })

  it('does not claim success when the provider returns 2xx with no post id', () => {
    expect(classifyResponse(201, {}).kind).toBe('retryable')
  })
})

describe('mediaTypeFor / isPlatform', () => {
  it('maps content types', () => {
    expect(mediaTypeFor('image/jpeg')).toBe('image')
    expect(mediaTypeFor('video/mp4')).toBe('video')
    expect(mediaTypeFor('application/pdf')).toBe('document')
    expect(mediaTypeFor('text/csv')).toBeNull()
  })

  it('guards unknown platforms', () => {
    expect(isPlatform('instagram')).toBe(true)
    expect(isPlatform('myspace')).toBe(false)
  })
})
