import { describe, expect, it } from 'vitest'
import { clipSource, HEAVY_MASTER_BYTES, isVideoUrl, playableUrl } from '../app/lib/playable-core'

/* ── a browser plays the encoder's copy, not the camera's .mov (10 Sep 2026) ── */

const MASTER = 'https://pub-x.r2.dev/1788957404553-ltpm8p-Event_Spaces_1.mov'
const rows = [
  { source_url: MASTER, platform: 'tiktok', status: 'done', output_key: 'copy-tiktok.mp4' },
  { source_url: MASTER, platform: 'instagram', status: 'done', output_key: 'copy-instagram.mp4' },
  { source_url: MASTER, platform: 'youtube', status: 'running', output_key: null },
  { source_url: 'https://pub-x.r2.dev/other.mov', platform: 'instagram', status: 'done', output_key: 'other-copy.mp4' },
]

describe('what the clip page hands its player (22 Nov 2026)', () => {
  const big = HEAVY_MASTER_BYTES + 1
  const base = { master: 'https://pub-x.r2.dev/pulls/f/a.mov', masterBytes: big, hls: null, encoded: null, jobsLoaded: true, copyFailed: false, fallback: '/api/drive/stream?id=1' }
  it('never a heavy master: it waits while it finds out, then says a copy is being made', () => {
    expect(clipSource({ ...base, jobsLoaded: false })).toEqual({ src: null, state: 'checking' })
    expect(clipSource(base)).toEqual({ src: null, state: 'making' })
    expect(clipSource({ ...base, copyFailed: true })).toEqual({ src: null, state: 'failed' })
  })
  it('the copy as soon as there is one: Cloudflare stream first, then our own .mp4', () => {
    expect(clipSource({ ...base, encoded: 'https://pub-x.r2.dev/c.mp4' })).toEqual({ src: 'https://pub-x.r2.dev/c.mp4', state: 'play' })
    expect(clipSource({ ...base, encoded: 'https://pub-x.r2.dev/c.mp4', hls: 'https://s/manifest/video.m3u8' }).src).toBe('https://s/manifest/video.m3u8')
  })
  it('a light master, or one a browser plays, is played as before', () => {
    expect(clipSource({ ...base, masterBytes: 50_000_000 }).src).toBe(base.master)
    expect(clipSource({ ...base, master: 'https://pub-x.r2.dev/a.mp4' }).src).toBe('https://pub-x.r2.dev/a.mp4')
    expect(clipSource({ ...base, master: null }).src).toBe('/api/drive/stream?id=1')
  })
  it('the page asks for nothing until the card and its copies are read', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/dashboard/editor/[id]/video/[fileId]/page.tsx', 'utf8')
    expect(src).toContain('useHlsSource(video, isImage || refused || loading || pullsLoading ? null : pick.src)')
  })
})

describe('playableUrl', () => {
  it('prefers a finished Instagram copy, beside the master in the same bucket', () => {
    expect(playableUrl(MASTER, rows)).toBe('https://pub-x.r2.dev/copy-instagram.mp4')
  })
  it('takes whichever copy is finished, and the master when none is', () => {
    expect(playableUrl(MASTER, rows.filter(r => r.platform !== 'instagram'))).toBe('https://pub-x.r2.dev/copy-tiktok.mp4')
    expect(playableUrl(MASTER, rows.filter(r => r.status !== 'done'))).toBe(MASTER)
    expect(playableUrl(MASTER, null)).toBe(MASTER)
    // a master in a folder (a Drive pull): the copy is still at the bucket's root (live, 17 Nov 2026 — it was a 404)
    const pulled = 'https://pub-x.r2.dev/pulls/folder/clip.mov'
    expect(playableUrl(pulled, [{ source_url: pulled, output_key: 'copy-instagram.mp4', status: 'done', platform: 'instagram' }])).toBe('https://pub-x.r2.dev/copy-instagram.mp4')
  })
  it('leaves a picture alone', () => {
    expect(playableUrl('https://pub-x.r2.dev/a.jpg', rows)).toBe('https://pub-x.r2.dev/a.jpg')
    expect(isVideoUrl('https://x/a.MOV')).toBe(true)
    expect(isVideoUrl('https://x/a.png')).toBe(false)
  })
})
