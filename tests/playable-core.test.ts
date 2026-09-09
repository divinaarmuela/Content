import { describe, expect, it } from 'vitest'
import { isVideoUrl, playableUrl } from '../app/lib/playable-core'

/* ── a browser plays the encoder's copy, not the camera's .mov (10 Sep 2026) ── */

const MASTER = 'https://pub-x.r2.dev/1788957404553-ltpm8p-Event_Spaces_1.mov'
const rows = [
  { source_url: MASTER, platform: 'tiktok', status: 'done', output_key: 'copy-tiktok.mp4' },
  { source_url: MASTER, platform: 'instagram', status: 'done', output_key: 'copy-instagram.mp4' },
  { source_url: MASTER, platform: 'youtube', status: 'running', output_key: null },
  { source_url: 'https://pub-x.r2.dev/other.mov', platform: 'instagram', status: 'done', output_key: 'other-copy.mp4' },
]

describe('playableUrl', () => {
  it('prefers a finished Instagram copy, beside the master in the same bucket', () => {
    expect(playableUrl(MASTER, rows)).toBe('https://pub-x.r2.dev/copy-instagram.mp4')
  })
  it('takes whichever copy is finished, and the master when none is', () => {
    expect(playableUrl(MASTER, rows.filter(r => r.platform !== 'instagram'))).toBe('https://pub-x.r2.dev/copy-tiktok.mp4')
    expect(playableUrl(MASTER, rows.filter(r => r.status !== 'done'))).toBe(MASTER)
    expect(playableUrl(MASTER, null)).toBe(MASTER)
  })
  it('leaves a picture alone', () => {
    expect(playableUrl('https://pub-x.r2.dev/a.jpg', rows)).toBe('https://pub-x.r2.dev/a.jpg')
    expect(isVideoUrl('https://x/a.MOV')).toBe(true)
    expect(isVideoUrl('https://x/a.png')).toBe(false)
  })
})
