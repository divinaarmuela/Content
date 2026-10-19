import { describe, expect, it } from 'vitest'
import { copyDuration, MEASURING_WAIT_MS } from '../app/lib/shrink-core'

/**
 * HOW LONG THE VIDEO RUNS (19 Oct 2026, Anthony Chimirri's LinkedIn post): a fresh upload still `processing` at
 * Cloudflare had no length, the copy was budgeted for LinkedIn's thirty minutes and refused outright — for a
 * 57-second clip whose own slide held the length.
 */
describe('copyDuration', () => {
  const now = Date.parse('2026-10-19T03:35:32Z')
  it("takes Cloudflare's number first", () => {
    expect(copyDuration({ preview: { duration_sec: 56.93, state: 'ready' }, slideSeconds: 10, now })).toEqual({ seconds: 56.93, measuring: false })
  })
  it("takes the slide's length while Cloudflare has none", () => {
    expect(copyDuration({ preview: { state: 'processing', created_at: '2026-10-19T03:32:43Z' }, slideSeconds: 56.93, now }))
      .toEqual({ seconds: 56.93, measuring: false })
  })
  it('waits while Cloudflare is still measuring and nothing else knows', () => {
    expect(copyDuration({ preview: { state: 'processing', created_at: '2026-10-19T03:32:43Z' }, slideSeconds: null, now }))
      .toEqual({ measuring: true })
  })
  it('stops waiting after an hour, so a stuck preview cannot hold a post for ever', () => {
    const late = Date.parse('2026-10-19T03:32:43Z') + MEASURING_WAIT_MS + 1
    expect(copyDuration({ preview: { state: 'processing', created_at: '2026-10-19T03:32:43Z' }, slideSeconds: null, now: late }))
      .toEqual({ measuring: false })
  })
  it('does not wait on a preview that errored, or when there is none', () => {
    expect(copyDuration({ preview: { state: 'error', created_at: '2026-10-19T03:32:43Z' }, slideSeconds: null, now }).measuring).toBe(false)
    expect(copyDuration({ preview: null, slideSeconds: null, now }).measuring).toBe(false)
  })
})

import { askCloudflareOnLookup, ASK_ON_LOOKUP_AFTER_MS } from '../app/lib/stream-core'

describe('a player asking Cloudflare itself', () => {
  const at = '2026-10-19T03:32:43.989Z'
  const now = Date.parse(at)
  it('asks about a row still processing after twenty seconds', () => {
    expect(askCloudflareOnLookup({ state: 'processing', stream_uid: 'u', updated_at: at }, now + ASK_ON_LOOKUP_AFTER_MS)).toBe(true)
  })
  it('does not ask again inside twenty seconds of the last answer', () => {
    expect(askCloudflareOnLookup({ state: 'processing', stream_uid: 'u', updated_at: at }, now + 5_000)).toBe(false)
  })
  it('never asks about a ready or failed row, or one Cloudflare has no id for', () => {
    expect(askCloudflareOnLookup({ state: 'ready', stream_uid: 'u', updated_at: at }, now + 60_000)).toBe(false)
    expect(askCloudflareOnLookup({ state: 'error', stream_uid: 'u', updated_at: at }, now + 60_000)).toBe(false)
    expect(askCloudflareOnLookup({ state: 'processing', stream_uid: null, updated_at: at }, now + 60_000)).toBe(false)
  })
})
