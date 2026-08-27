import { describe, expect, it } from 'vitest'
import {
  POLL_AFTER_MS, PREPARING_CLIENT, PREPARING_TEAM,
  isVideoUrl, mapStreamState, missingPreviewSources, parseWebhookSignature,
  pickPoster, pollablePreviews, previewCountsLine, previewPatchFrom,
  previewStateFor, streamBaseUrl, streamEmbedUrl, streamThumbnailUrl,
  webhookSignatureSource, webhookTimestampFresh,
  type PreviewRow,
} from '../app/lib/stream-core'

const HLS = 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/manifest/video.m3u8'

function row(over: Partial<PreviewRow> = {}): PreviewRow {
  return {
    source_url: 'https://cdn.example.com/a.mov',
    stream_uid: 'deadbeefcafe',
    state: 'ready',
    playback_hls: HLS,
    thumbnail_url: 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/thumbnails/thumbnail.jpg',
    ...over,
  }
}

const BLOCKED = { block: { kind: 'codec', reason: "it's HEVC, which Chrome and Edge can't decode" } }
const PLAYS = { block: null }

describe('isVideoUrl', () => {
  it('accepts the containers a player is handed', () => {
    for (const u of ['a.mp4', 'a.MOV', 'a.m4v', 'a.webm', 'a.mts', 'a.mp4?v=2']) {
      expect(isVideoUrl(`https://x/${u}`)).toBe(true)
    }
  })
  it('rejects documents, decks and nothing at all', () => {
    for (const u of ['a.pdf', 'a.jpg', 'a.mp4.txt', '']) expect(isVideoUrl(u)).toBe(false)
    expect(isVideoUrl(null)).toBe(false)
  })
})

describe('previewStateFor', () => {
  it('plays the ORIGINAL whenever the original plays, encode or no encode', () => {
    // the rule that keeps every ordinary mp4 out of the preview machinery
    expect(previewStateFor(null, PLAYS)).toEqual({ at: 'play-native' })
    expect(previewStateFor(row(), PLAYS)).toEqual({ at: 'play-native' })
  })

  it('treats a probe with no opinion as permission to try', () => {
    // a WebM, a CORS refusal — the <video> gets its chance exactly as before
    expect(previewStateFor(null, null)).toEqual({ at: 'play-native' })
    expect(previewStateFor(null, undefined)).toEqual({ at: 'play-native' })
  })

  it('plays the encode when the original cannot play', () => {
    const d = previewStateFor(row(), BLOCKED)
    expect(d.at).toBe('play-stream')
    if (d.at !== 'play-stream') throw new Error('unreachable')
    expect(d.embed).toBe('https://customer-abc123.cloudflarestream.com/deadbeefcafe/iframe')
    expect(d.poster).toContain('/thumbnails/thumbnail.jpg')
  })

  it('says it is preparing, in the viewer’s own words', () => {
    expect(previewStateFor(row({ state: 'processing' }), BLOCKED))
      .toEqual({ at: 'pending', words: PREPARING_TEAM })
    expect(previewStateFor(row({ state: 'queued' }), BLOCKED, 'client'))
      .toEqual({ at: 'pending', words: PREPARING_CLIENT })
  })

  it('falls back to the reason card with no row, with an error, or unconfigured', () => {
    expect(previewStateFor(null, BLOCKED)).toEqual({ at: 'failed' })
    expect(previewStateFor(row({ state: 'error' }), BLOCKED)).toEqual({ at: 'failed' })
  })

  it('refuses to call a row playable when there is nothing to play it from', () => {
    // ready without a manifest is a malformed row, and rendering a blank
    // frame for it is exactly the silent failure this feature replaces
    expect(previewStateFor(row({ playback_hls: null, thumbnail_url: null }), BLOCKED))
      .toEqual({ at: 'failed' })
  })
})

describe('the Cloudflare URL family', () => {
  it('derives the base from whichever URL Cloudflare gave us', () => {
    expect(streamBaseUrl(row())).toBe('https://customer-abc123.cloudflarestream.com/deadbeefcafe')
    expect(streamBaseUrl(row({ playback_hls: null }))).toBe(
      'https://customer-abc123.cloudflarestream.com/deadbeefcafe')
  })
  it('has no opinion about a URL that is not Cloudflare’s', () => {
    expect(streamBaseUrl(row({ playback_hls: 'https://evil.example.com/x/y', thumbnail_url: null }))).toBeNull()
    expect(streamEmbedUrl(null)).toBeNull()
    expect(streamThumbnailUrl(null)).toBeNull()
  })
  it('asks for a frame a second in, not frame zero', () => {
    // frame zero of a camera clip is black or a clapper
    expect(streamThumbnailUrl(row())).toContain('time=1s')
    expect(streamThumbnailUrl(row(), { height: 200 })).toContain('height=200')
  })
})

describe('pickPoster', () => {
  it('prefers the encode’s still, which for HEVC is the only picture there is', () => {
    expect(pickPoster(row(), 'fallback.jpg')).toContain('thumbnails/thumbnail.jpg')
  })
  it('keeps the caller’s own poster until the encode is ready', () => {
    expect(pickPoster(row({ state: 'processing' }), 'fallback.jpg')).toBe('fallback.jpg')
    expect(pickPoster(null)).toBeNull()
  })
})

describe('mapStreamState', () => {
  it('collapses every in-flight Cloudflare state onto processing', () => {
    for (const s of ['pendingupload', 'downloading', 'queued', 'inprogress', 'something-new']) {
      expect(mapStreamState(s)).toBe('processing')
    }
  })
  it('reads ready and error', () => {
    expect(mapStreamState('ready')).toBe('ready')
    expect(mapStreamState('error')).toBe('error')
  })
  it('does not call a video ready that says it is not', () => {
    expect(mapStreamState('ready', false)).toBe('processing')
  })
})

describe('previewPatchFrom', () => {
  it('reads a ready video', () => {
    expect(previewPatchFrom({
      uid: 'deadbeefcafe',
      readyToStream: true,
      status: { state: 'ready' },
      playback: { hls: HLS },
      thumbnail: 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/thumbnails/thumbnail.jpg',
      duration: 42.5,
      input: { width: 1920, height: 1080 },
    })).toEqual({
      stream_uid: 'deadbeefcafe',
      state: 'ready',
      playback_hls: HLS,
      thumbnail_url: 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/thumbnails/thumbnail.jpg',
      duration_sec: 42.5,
      width: 1920,
      height: 1080,
      error: null,
    })
  })

  it('reads Cloudflare’s -1 as "not known yet", never as a dimension', () => {
    const patch = previewPatchFrom({
      uid: 'u', status: { state: 'downloading' }, duration: -1, input: { width: -1, height: -1 },
    })
    expect(patch).toMatchObject({ state: 'processing', duration_sec: null, width: null, height: null })
  })

  it('keeps the reason an encode failed, and clears it when one succeeds', () => {
    expect(previewPatchFrom({
      uid: 'u', status: { state: 'error', errorReasonText: 'Unsupported audio codec' },
    })?.error).toBe('Unsupported audio codec')
    // an error state with no words is still an error, and must say something
    expect(previewPatchFrom({ uid: 'u', status: { state: 'error' } })?.error).toBeTruthy()
    expect(previewPatchFrom({ uid: 'u', status: { state: 'ready' } })?.error).toBeNull()
  })

  it('refuses a payload with no video id', () => {
    expect(previewPatchFrom(null)).toBeNull()
    expect(previewPatchFrom({})).toBeNull()
    expect(previewPatchFrom({ uid: '' })).toBeNull()
    expect(previewPatchFrom('not an object')).toBeNull()
  })
})

describe('webhook signature parsing', () => {
  const sig = 'a'.repeat(64)

  it('splits time and sig1', () => {
    expect(parseWebhookSignature(`time=1230811200,sig1=${sig}`))
      .toEqual({ time: '1230811200', sig })
  })
  it('tolerates whitespace and extra fields', () => {
    expect(parseWebhookSignature(`time=1230811200, sig1=${sig}, sig2=beef`))
      .toEqual({ time: '1230811200', sig })
  })
  it('returns null rather than throwing on anything malformed', () => {
    for (const h of [null, '', 'garbage', 'time=abc,sig1=' + sig, `time=1,sig1=short`]) {
      expect(parseWebhookSignature(h)).toBeNull()
    }
  })
  it('signs the timestamp, a dot, then the body byte-for-byte', () => {
    // re-serialising the parsed JSON is the classic way to reject every
    // genuine delivery, so the source string must take the raw text
    expect(webhookSignatureSource('123', '{"uid":"x"}')).toBe('123.{"uid":"x"}')
  })
  it('rejects a replayed delivery', () => {
    const now = 1_700_000_000_000
    expect(webhookTimestampFresh('1700000000', now)).toBe(true)
    expect(webhookTimestampFresh('1699999000', now)).toBe(false)
    expect(webhookTimestampFresh('not-a-time', now)).toBe(false)
  })
})

describe('the sweep diff', () => {
  it('asks only for video that has no row', () => {
    expect(missingPreviewSources(
      ['https://x/a.mov', 'https://x/b.mp4', 'https://x/c.pdf'],
      ['https://x/b.mp4'],
    )).toEqual(['https://x/a.mov'])
  })

  it('asks once for a file that is both a raw asset and a slide', () => {
    expect(missingPreviewSources(['https://x/a.mov', 'https://x/a.mov'], []))
      .toEqual(['https://x/a.mov'])
  })

  it('never hands Cloudflare an unbounded batch at 3am', () => {
    const many = Array.from({ length: 100 }, (_, i) => `https://x/${i}.mov`)
    expect(missingPreviewSources(many, [], 25)).toHaveLength(25)
  })

  it('ignores blanks and non-video', () => {
    expect(missingPreviewSources([null, undefined, '', '  ', 'https://x/a.jpg'], [])).toEqual([])
  })
})

describe('the backstop poller', () => {
  const now = 1_700_000_000_000
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()

  it('leaves an encode that has only just started alone', () => {
    // a normal encode finishes and webhooks in; polling it would be pure cost
    expect(pollablePreviews(
      [{ state: 'processing', updated_at: at(30_000), stream_uid: 'u' }], now,
    )).toEqual([])
  })

  it('asks about anything still in flight after two minutes', () => {
    const rows = [
      { state: 'processing' as const, updated_at: at(POLL_AFTER_MS + 1), stream_uid: 'a' },
      { state: 'queued' as const, updated_at: at(POLL_AFTER_MS + 1), stream_uid: 'b' },
      { state: 'ready' as const, updated_at: at(POLL_AFTER_MS + 1), stream_uid: 'c' },
      { state: 'error' as const, updated_at: at(POLL_AFTER_MS + 1), stream_uid: 'd' },
    ]
    expect(pollablePreviews(rows, now).map(r => r.stream_uid)).toEqual(['a', 'b'])
  })

  it('cannot poll a claim that has no video id yet', () => {
    // that row is not waiting on Cloudflare; it was never successfully asked
    expect(pollablePreviews(
      [{ state: 'queued', updated_at: at(POLL_AFTER_MS + 1), stream_uid: null }], now,
    )).toEqual([])
  })
})

describe('previewCountsLine', () => {
  it('is the one line the settings card shows', () => {
    expect(previewCountsLine({ ready: 3, preparing: 1, failed: 0 }))
      .toBe('3 ready · 1 preparing · 0 failed (last 7 days)')
  })
})
