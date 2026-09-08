import { describe, expect, it } from 'vitest'
import {
  cacheDecision, fromActorItem, FAIL_LIMIT, VIDEO_TTL_MS,
  type InstagramVideoRow,
} from '../app/lib/instagram-video-core'

/**
 * Instagram serves DASH: the mp4 the scraper calls `videoUrl` carries the
 * PICTURE ONLY, and the sound is a second file. Probed on a real post
 * (DSFZPrNks17) on 2026-09-08 by fetching the first 400 KB of each and
 * counting atoms: the video file had one `trak`, handler `vide`, and zero
 * `soun` / `mp4a`; the audio file had `soun` + `mp4a` and no `vide`. So a
 * card that only unmutes the <video> can never make a sound, however
 * correctly it unmutes — these tests pin the second file being kept.
 */

const CDN = 'https://instagram.fmel17-1.fna.fbcdn.net/o1/v/t2/f2'

describe('fromActorItem', () => {
  it('keeps the sound file beside the picture', () => {
    const got = fromActorItem({
      type: 'Video',
      videoUrl: `${CDN}/m367/AQO1.mp4?_nc_cat=104`,
      audioUrl: `${CDN}/m86/AQOk.mp4?_nc_cat=104`,
      videoDuration: 68.31,
    })
    expect(got?.video).toContain('m367')
    expect(got?.audio).toContain('m86')
  })

  it('leaves the sound null when the post has none', () => {
    const got = fromActorItem({ type: 'Video', videoUrl: `${CDN}/m367/AQO1.mp4` })
    expect(got?.video).toBeTruthy()
    expect(got?.audio).toBeNull()
  })

  it('refuses a sound file that is not on Instagram', () => {
    const got = fromActorItem({
      videoUrl: `${CDN}/m367/AQO1.mp4`,
      audioUrl: 'https://example.com/anything.mp4',
    })
    expect(got?.audio).toBeNull()
  })
})

describe('cacheDecision', () => {
  const now = Date.UTC(2026, 8, 8, 5, 0, 0)
  const row = (over: Partial<InstagramVideoRow> = {}): InstagramVideoRow => ({
    id: 'DSFZPrNks17',
    video: `${CDN}/m367/AQO1.mp4`,
    audio: `${CDN}/m86/AQOk.mp4`,
    audio_known: true,
    poster: null, caption: null, author: null, duration: 68.31,
    fetched_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + VIDEO_TTL_MS).toISOString(),
    fail_count: 0, last_error: null,
    ...over,
  })

  it('serves a fresh row', () => {
    expect(cacheDecision(row(), now)).toBe('serve')
  })

  it('asks again for a row cached before the sound file was known', () => {
    // audio null AND audio_known false is the shape an older build wrote;
    // serving it would leave the card silent for the whole four-hour TTL
    expect(cacheDecision(row({ audio: null, audio_known: false }), now)).toBe('fetch')
  })

  it('serves a post that genuinely has no sound, rather than asking forever', () => {
    expect(cacheDecision(row({ audio: null, audio_known: true }), now)).toBe('serve')
  })

  it('still backs off a post that keeps failing', () => {
    const failed = row({ video: null, audio: null, expires_at: null, fail_count: FAIL_LIMIT })
    expect(cacheDecision(failed, now)).toBe('backoff')
  })
})
