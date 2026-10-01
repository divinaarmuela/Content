import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CANCELLED_NOTICE, CANCELLED_NOTICE_SCHEDULE, newlyCancelled } from '../app/lib/post-board-core'
import { MOV_PREVIEW_WAIT, needsPreviewCopy, shownVideo } from '../app/lib/playable-core'

/**
 * Two fixes from the live walk (1 Oct 2026):
 *   1. CANCEL IS NOT A DELETE. Cancel post (T20) moved the card out of its lane into the folded
 *      "Cancelled · N" list, so it looked deleted. The press now says where it went, offers Re-book
 *      (T22) on the spot, and opens the list — on Post approval, from a card or the post window, and
 *      on Schedule's after-press window.
 *   2. A .MOV IS NOT A BLACK BOX. A draft from an edit card's .mov original showed an empty box with a
 *      film icon. The window shows Cloudflare's preview of the file, or its still and "Preview being
 *      made — the original is a .mov". What is published is not touched.
 */
const src = (p: string) => readFileSync(p, 'utf8')

describe('a cancelled post says where it went, with Re-book', () => {
  it('the words', () => {
    expect(CANCELLED_NOTICE).toBe('Cancelled — it’s in Cancelled at the bottom of this page')
    expect(CANCELLED_NOTICE_SCHEDULE).toMatch(/^Cancelled — /)
  })

  it('the board opens its Cancelled list for a post that just left a lane — and only then', () => {
    expect(newlyCancelled(new Set(['a', 'b']), [{ id: 'b' }, { id: 'z' }])).toEqual(['b'])
    expect(newlyCancelled(new Set(), [{ id: 'b' }])).toEqual([])
    expect(newlyCancelled(new Set(['a']), [])).toEqual([])
  })

  it('a card’s Cancel post: the toast, Re-book through the one act route (T22)', () => {
    const acts = src('app/dashboard/scheduler/board/usePostActs.tsx')
    expect(acts).toMatch(/if \(json\.stage === 'cancelled'\)/)
    expect(acts).toMatch(/toast\.success\(CANCELLED_NOTICE, \{[\s\S]*?label: 'Re-book'[\s\S]*?rebookPost\(post\.id/)
    const rebook = src('app/dashboard/scheduler/board/rebook.ts')
    expect(rebook).toMatch(/postAct\(postId, \{ action: 'rebook', expect_rev: rev \}\)/)
  })

  it('the post window’s Cancel post on Post approval says the same', () => {
    const w = src('app/dashboard/scheduler/PostWindowFromAddress.tsx')
    expect(w).toMatch(/outcome\.stage === 'cancelled'[\s\S]*?CANCELLED_NOTICE[\s\S]*?label: 'Re-book'/)
  })

  it('the board’s Cancelled list is closed by default and opened by a cancel', () => {
    const b = src('app/dashboard/scheduler/board/PostBoard.tsx')
    expect(b).toContain('const [cancelledOpen, setCancelledOpen] = useState(false)')
    expect(b).toMatch(/newlyCancelled\(onLaneIds\.current, cancelled\.map\(bp => bp\.post\)\)/)
    expect(b).toMatch(/<details ref=\{cancelledBox\} open=\{cancelledOpen\}/)
  })

  it('Schedule: the window after a cancel offers Re-book and the cancelled list, not "Open the post"', () => {
    const f = src('app/dashboard/social/schedule/useComposeFlow.tsx')
    expect(f).toMatch(/stage === 'cancelled' && done\.postId/)
    expect(f).toContain('rebookPost(id)')
    expect(f).toContain('Show cancelled posts')
    expect(src('app/dashboard/social/schedule/page.tsx')).toContain("onShowCancelled: () => showList('cancelled')")
  })
})

describe('what the post window shows for a video (shownVideo)', () => {
  const MOV = 'https://r2.test/up/clip-1.mov'
  const MP4 = 'https://r2.test/up/clip-2.mp4'
  const READY = {
    state: 'ready',
    playback_hls: 'https://customer-abc123.cloudflarestream.com/uid42/manifest/video.m3u8',
    thumbnail_url: 'https://customer-abc123.cloudflarestream.com/uid42/thumbnails/thumbnail.jpg',
  }

  it('the encoder’s .mp4 copy first', () => {
    const rows = [{ source_url: MOV, output_key: 'clip-1.instagram.mp4', status: 'done', platform: 'instagram' }]
    expect(shownVideo({ url: MOV, encodeRows: rows, stream: READY })).toEqual({ kind: 'file', src: 'https://r2.test/up/clip-1.instagram.mp4' })
  })

  it('else Cloudflare’s preview of the original, with its still as the poster', () => {
    expect(shownVideo({ url: MOV, stream: READY })).toEqual({
      kind: 'stream',
      hls: 'https://customer-abc123.cloudflarestream.com/uid42/manifest/video.m3u8',
      poster: 'https://customer-abc123.cloudflarestream.com/uid42/thumbnails/thumbnail.jpg?time=1s',
    })
  })

  it('a .mov with nothing yet: its still and the words — never an empty box', () => {
    expect(shownVideo({ url: MOV, stream: { state: 'processing' }, thumb: '/api/drive/thumbnail?id=d1' }))
      .toEqual({ kind: 'waiting', poster: '/api/drive/thumbnail?id=d1', words: MOV_PREVIEW_WAIT })
    expect(shownVideo({ url: MOV })).toEqual({ kind: 'waiting', poster: null, words: 'Preview being made — the original is a .mov' })
  })

  it('a video the browser plays is played as it is', () => {
    expect(shownVideo({ url: MP4 })).toEqual({ kind: 'file', src: MP4 })
    expect(needsPreviewCopy(MOV)).toBe(true)
    expect(needsPreviewCopy(`${MOV}?x=1`)).toBe(true)
    expect(needsPreviewCopy(MP4)).toBe(false)
  })

  it('the window draws it in the media square, the strip, the Instagram grid and Preview — and publishes nothing new', () => {
    const w = src('app/dashboard/social/schedule/PostWindow.tsx')
    expect(w).toContain('const shownFor = useShownVideos(shown.slides)')
    expect(w).toContain("videoView(shownSlide, title, 'h-full w-full') ?? <Thumb")
    expect(w).toContain("videoView(s, s.name, 'h-full w-full', true) ?? <Thumb")
    expect(w).toMatch(/videoFor=\{\(url, label\) => videoView/)
    const v = src('app/dashboard/social/schedule/ShownVideo.tsx')
    // shown only: no write of any kind from the preview
    expect(v).not.toMatch(/method: '(PATCH|POST|PUT|DELETE)'/)
    expect(v).not.toMatch(/social_posts|postAct|updatePost|api\/social\/schedule/)
    expect(src('app/components/social/PostPreview.tsx')).toMatch(/media\.type === 'video' && instead \?/)
  })
})
