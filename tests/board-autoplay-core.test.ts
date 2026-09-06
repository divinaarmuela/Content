import { describe, it, expect } from 'vitest'
import {
  AutoplayArbiter, MAX_AUTOPLAY, autoplayEmbedUrlFor, autoplayKindFor, centreDistance, decideAutoplay,
  framePlayerOf, INSTAGRAM_PLAY_HINT, instagramEmbedUrlFor, instagramPlayHint, isNear, pickPlayers,
  soundCommand, YOUTUBE_LISTEN,
} from '../app/lib/board-autoplay-core'
import { embedUrlFor, isSafePreviewUrl } from '../app/lib/link-preview-core'

describe('the frame that plays by itself', () => {
  // each provider's own flags, from their docs, and nothing a user typed in
  // the URL except the id we validated
  it('builds a silent, looping YouTube frame — looped via the one-item playlist YouTube requires', () => {
    expect(autoplayEmbedUrlFor('https://www.youtube.com/watch?v=abc123XYZ'))
      .toBe('https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&mute=1&loop=1&playlist=abc123XYZ&controls=0&rel=0&playsinline=1')
    expect(autoplayEmbedUrlFor('https://youtu.be/abc123XYZ')).toContain('/embed/abc123XYZ?')
    expect(autoplayEmbedUrlFor('https://www.youtube.com/shorts/abc123XYZ')).toContain('playlist=abc123XYZ')
  })

  it("builds TikTok's Embed Player with autoplay, muted and loop", () => {
    expect(autoplayEmbedUrlFor('https://www.tiktok.com/@someone/video/7412345678901234567'))
      .toBe('https://www.tiktok.com/player/v1/7412345678901234567?autoplay=1&muted=1&loop=1&controls=0')
  })

  it("builds Vimeo's background mode", () => {
    expect(autoplayEmbedUrlFor('https://vimeo.com/12345678'))
      .toBe('https://player.vimeo.com/video/12345678?autoplay=1&muted=1&loop=1&background=1')
  })

  it('plays a vm.tiktok.com share link once the route has recorded where it points', () => {
    // the pasted link has no id; the card stores the canonical URL the
    // link-preview route found by following it, and that is what plays
    expect(autoplayEmbedUrlFor('https://vm.tiktok.com/ZMrRs9oPp/', 'https://www.tiktok.com/@petsmeowwoof/video/7290074173500706079'))
      .toBe('https://www.tiktok.com/player/v1/7290074173500706079?autoplay=1&muted=1&loop=1&controls=0')
    expect(autoplayKindFor({ kind: 'link', url: 'https://vm.tiktok.com/ZMrRs9oPp/' })).toBe('none')
    expect(autoplayKindFor({ kind: 'link', url: 'https://vm.tiktok.com/ZMrRs9oPp/', canonical: 'https://www.tiktok.com/@_/video/7290074173500706079' })).toBe('embed')
    // never from a canonical URL on someone else's host
    expect(autoplayEmbedUrlFor('https://vm.tiktok.com/ZMrRs9oPp/', 'https://evil.example/video/7290074173500706079')).toBeNull()
  })

  it('an Instagram post Instagram itself said cannot be framed is a still, not a frame', () => {
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.instagram.com/p/Dbqg-OzRmcw/' })).toBe('instagram')
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.instagram.com/p/Dbqg-OzRmcw/', embeddable: false })).toBe('none')
  })

  it('refuses Instagram, Facebook, a short link with no id, and anything else', () => {
    expect(autoplayEmbedUrlFor('https://www.instagram.com/reel/Cabc123/')).toBeNull()
    expect(autoplayEmbedUrlFor('https://www.facebook.com/page/posts/123')).toBeNull()
    expect(autoplayEmbedUrlFor('https://vm.tiktok.com/ZMabc/')).toBeNull()
    expect(autoplayEmbedUrlFor('https://example.com/video/123')).toBeNull()
    expect(autoplayEmbedUrlFor('not a url')).toBeNull()
  })

  it('never reflects a host the user typed — the frame is always on the provider', () => {
    for (const u of [
      'https://www.youtube.com.evil.example/watch?v=abc123XYZ',
      'https://tiktok.com.evil.example/@a/video/123456',
      'https://notvimeo.com/12345678',
    ]) {
      const out = autoplayEmbedUrlFor(u)
      expect(out === null || /^https:\/\/(www\.youtube-nocookie\.com|www\.tiktok\.com|player\.vimeo\.com)\//.test(out), u).toBe(true)
    }
    // the youtube id regex is the same gate the click-to-play frame uses
    expect(autoplayEmbedUrlFor('https://www.youtube.com/watch?v=../../x')).toBeNull()
  })
})

describe("Instagram: the embed is the card's face, one tap plays it", () => {
  it('uses the plain embed page, reels through /reel/ and posts through /p/', () => {
    expect(instagramEmbedUrlFor('https://www.instagram.com/reel/Cabc123/?igsh=xyz'))
      .toBe('https://www.instagram.com/reel/Cabc123/embed/')
    expect(instagramEmbedUrlFor('https://www.instagram.com/reels/Cabc123/'))
      .toBe('https://www.instagram.com/reel/Cabc123/embed/')
    expect(instagramEmbedUrlFor('https://www.instagram.com/p/Cabc123/'))
      .toBe('https://www.instagram.com/p/Cabc123/embed/')
    expect(instagramEmbedUrlFor('https://www.instagram.com/tv/Cabc123/'))
      .toBe('https://www.instagram.com/p/Cabc123/embed/')
    // not the captioned variant: that one grows with the caption
    expect(instagramEmbedUrlFor('https://www.instagram.com/reel/Cabc123/')).not.toContain('captioned')
  })

  it('refuses a profile, another host, or nonsense', () => {
    expect(instagramEmbedUrlFor('https://www.instagram.com/someaccount/')).toBeNull()
    expect(instagramEmbedUrlFor('https://www.instagram.com.evil.example/reel/Cabc/')).toBeNull()
    expect(instagramEmbedUrlFor('not a url')).toBeNull()
  })

  it('mounts the frame as soon as the card is within range — no first tap, no seat needed', () => {
    const d = decideAutoplay({ kind: 'instagram', reducedMotion: false, near: true, inRange: true, chosen: false })
    expect(d).toEqual({ load: true, play: false })
  })

  it('tears the frame down when the card leaves the screen', () => {
    expect(decideAutoplay({ kind: 'instagram', reducedMotion: false, near: true, inRange: false, chosen: false }))
      .toEqual({ load: false, play: false })
  })

  it('never plays by itself, and does not care about reduced motion since nothing moves until the tap', () => {
    const d = decideAutoplay({ kind: 'instagram', reducedMotion: true, near: true, inRange: true, chosen: true })
    expect(d).toEqual({ load: true, play: false })
  })

  it('the click-to-play frame is untouched', () => {
    expect(embedUrlFor('https://www.instagram.com/reel/Cabc123/'))
      .toBe('https://www.instagram.com/p/Cabc123/embed/captioned/')
  })
})

describe('what kind of player a card is', () => {
  it('a direct video file is a <video>, whatever kind of card carries it', () => {
    expect(autoplayKindFor({ kind: 'image', url: 'https://r2.example.com/clip.mp4' })).toBe('file')
    expect(autoplayKindFor({ kind: 'link', url: 'https://cdn.example.com/a.webm?x=1' })).toBe('file')
  })
  it('YouTube, TikTok and Vimeo links are frames; Instagram is its own thing', () => {
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.youtube.com/watch?v=abc123XYZ' })).toBe('embed')
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.tiktok.com/@a/video/123456' })).toBe('embed')
    expect(autoplayKindFor({ kind: 'link', url: 'https://vimeo.com/123' })).toBe('embed')
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.instagram.com/reel/Cabc123/' })).toBe('instagram')
  })
  it('a page link, a picture, an empty card: none', () => {
    expect(autoplayKindFor({ kind: 'link', url: 'https://example.com/article' })).toBe('none')
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.pinterest.com/pin/1/' })).toBe('none')
    expect(autoplayKindFor({ kind: 'image', url: 'https://r2.example.com/a.jpg' })).toBe('none')
    expect(autoplayKindFor({ kind: 'note' })).toBe('none')
    // a mockup with a YouTube url is a mockup, not a link card
    expect(autoplayKindFor({ kind: 'mockup', url: 'https://www.youtube.com/watch?v=abc123XYZ' })).toBe('none')
  })
})

describe('which cards get to play', () => {
  const c = (id: string, visible: boolean, distance: number) => ({ id, visible, distance })

  it('only the visible ones, nearest the middle of the screen, capped', () => {
    const cands = [
      c('far', true, 900), c('mid', true, 300), c('near', true, 10),
      c('hidden-near', false, 0), c('mid2', true, 310), c('mid3', true, 320),
    ]
    expect(pickPlayers(cands)).toEqual(['near', 'mid', 'mid2'])
    expect(MAX_AUTOPLAY).toBe(3)
  })

  it('twenty visible clips is still three players', () => {
    const cands = Array.from({ length: 20 }, (_, i) => c(`c${i}`, true, i * 50))
    expect(pickPlayers(cands)).toHaveLength(3)
    expect(pickPlayers(cands, 1)).toEqual(['c0'])
    expect(pickPlayers(cands, 0)).toEqual([])
  })

  it('breaks ties by id so two renders agree', () => {
    expect(pickPlayers([c('b', true, 5), c('a', true, 5)], 1)).toEqual(['a'])
  })

  it('nothing visible, nothing plays', () => {
    expect(pickPlayers([c('a', false, 0), c('b', false, 0)])).toEqual([])
  })
})

describe('the arbiter', () => {
  function board(distances: Record<string, number>) {
    const arb = new AutoplayArbiter(id => distances[id] ?? Infinity)
    const seen: Record<string, boolean[]> = {}
    for (const id of Object.keys(distances)) {
      seen[id] = []
      arb.add(id, chosen => seen[id].push(chosen))
    }
    return { arb, seen }
  }

  it('hands out at most three seats to the visible cards nearest the centre', () => {
    const { arb } = board({ a: 10, b: 20, c: 30, d: 40, e: 50 })
    for (const id of ['e', 'd', 'c', 'b', 'a']) arb.setVisible(id, true)
    expect(arb.chosen().sort()).toEqual(['a', 'b', 'c'])
  })

  it('a card leaving the screen gives its seat to the next nearest, and is told to stop', () => {
    const { arb, seen } = board({ a: 10, b: 20, c: 30, d: 40 })
    for (const id of ['a', 'b', 'c', 'd']) arb.setVisible(id, true)
    expect(arb.chosen().sort()).toEqual(['a', 'b', 'c'])
    arb.setVisible('a', false)
    expect(arb.chosen().sort()).toEqual(['b', 'c', 'd'])
    expect(seen.a).toEqual([true, false])
    expect(seen.d).toEqual([true])
    // b and c were told once and not again — no churn
    expect(seen.b).toEqual([true])
  })

  it('a pan that moves cards without changing visibility re-ranks on recompute', () => {
    const distances: Record<string, number> = { a: 10, b: 20, c: 30, d: 40 }
    const arb = new AutoplayArbiter(id => distances[id])
    for (const id of Object.keys(distances)) arb.add(id, () => {})
    for (const id of Object.keys(distances)) arb.setVisible(id, true)
    expect(arb.chosen().sort()).toEqual(['a', 'b', 'c'])
    distances.a = 500
    arb.recompute()
    expect(arb.chosen().sort()).toEqual(['b', 'c', 'd'])
  })

  it('an unmounted card leaves the table', () => {
    const { arb } = board({ a: 10, b: 20, c: 30, d: 40 })
    for (const id of ['a', 'b', 'c', 'd']) arb.setVisible(id, true)
    arb.remove('a')
    expect(arb.size).toBe(3)
    expect(arb.chosen().sort()).toEqual(['b', 'c', 'd'])
  })

  it('a repeated visibility report is a no-op', () => {
    const { arb, seen } = board({ a: 10 })
    arb.setVisible('a', true)
    arb.setVisible('a', true)
    expect(seen.a).toEqual([true])
  })
})

describe('one card: load, play, or neither', () => {
  const base = { reducedMotion: false, near: true, inRange: true, chosen: true }

  it('a chosen clip plays; an unchosen frame has no src at all (that is the off-screen teardown)', () => {
    expect(decideAutoplay({ ...base, kind: 'embed' })).toEqual({ load: true, play: true })
    expect(decideAutoplay({ ...base, kind: 'embed', chosen: false })).toEqual({ load: false, play: false })
  })

  it('a file keeps its bytes once near, and only pauses when it loses its seat', () => {
    expect(decideAutoplay({ ...base, kind: 'file' })).toEqual({ load: true, play: true })
    expect(decideAutoplay({ ...base, kind: 'file', chosen: false })).toEqual({ load: true, play: false })
  })

  it('a card that has never been near the screen loads nothing, chosen or not', () => {
    expect(decideAutoplay({ ...base, kind: 'file', near: false })).toEqual({ load: false, play: false })
    expect(decideAutoplay({ ...base, kind: 'embed', near: false })).toEqual({ load: false, play: false })
  })

  it('reduced motion: no autoplay, so the card keeps its play badge', () => {
    expect(decideAutoplay({ ...base, kind: 'file', reducedMotion: true })).toEqual({ load: false, play: false })
    expect(decideAutoplay({ ...base, kind: 'embed', reducedMotion: true })).toEqual({ load: false, play: false })
  })

  it('a card the viewer tapped is the real player, not ours', () => {
    expect(decideAutoplay({ ...base, kind: 'embed', userPlaying: true })).toEqual({ load: false, play: false })
  })

  it('a card that cannot play is left alone', () => {
    expect(decideAutoplay({ ...base, kind: 'none' })).toEqual({ load: false, play: false })
  })
})

describe('geometry', () => {
  const vp = { top: 0, left: 0, width: 1000, height: 800 }
  it('measures centre to centre', () => {
    expect(centreDistance({ top: 300, left: 400, width: 200, height: 200 }, vp)).toBe(0)
    expect(centreDistance({ top: 0, left: 0, width: 200, height: 200 }, vp)).toBeCloseTo(Math.hypot(400, 300))
  })
  it('near means within the margin, in any direction', () => {
    expect(isNear({ top: -400, left: 0, width: 100, height: 100 }, vp, 320)).toBe(true)
    expect(isNear({ top: -500, left: 0, width: 100, height: 100 }, vp, 320)).toBe(false)
    expect(isNear({ top: 0, left: 1300, width: 100, height: 100 }, vp, 320)).toBe(true)
    expect(isNear({ top: 0, left: 1400, width: 100, height: 100 }, vp, 320)).toBe(false)
  })
})

describe('the SSRF guard is untouched by any of this', () => {
  // the autoplay URLs are built without a fetch, and the guard that stands
  // between a text field and our metadata endpoint still refuses everything
  // it refused before
  it('still refuses loopback, link-local, private ranges and non-https', () => {
    for (const bad of [
      'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/x', 'https://172.16.4.4/x', 'https://192.168.1.1/x', 'https://[::1]/x',
      'https://intranet/x', 'https://build.internal/x', 'http://example.com', 'file:///etc/passwd',
    ]) expect(isSafePreviewUrl(bad), bad).toBe(false)
    expect(isSafePreviewUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
  })
})

describe('sound in place — the same player, told to unmute', () => {
  it("YouTube's frame is built to listen to us: enablejsapi and OUR origin, only when given one", () => {
    const withApi = autoplayEmbedUrlFor('https://www.youtube.com/watch?v=abc123XYZ', null, 'https://app.mdmmarketing.com.au')!
    expect(withApi).toContain('enablejsapi=1')
    expect(withApi).toContain('origin=https%3A%2F%2Fapp.mdmmarketing.com.au')
    expect(withApi.startsWith('https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&mute=1')).toBe(true)
    // no origin, no api flag — the old URL exactly
    expect(autoplayEmbedUrlFor('https://www.youtube.com/watch?v=abc123XYZ')).not.toContain('enablejsapi')
    // an origin that is not an origin is not written into the URL
    expect(autoplayEmbedUrlFor('https://www.youtube.com/watch?v=abc123XYZ', null, 'javascript:alert(1)')).not.toContain('enablejsapi')
    // TikTok and Vimeo take no origin and are unchanged
    expect(autoplayEmbedUrlFor('https://vimeo.com/12345678', null, 'https://x.example')).not.toContain('origin')
  })

  it('knows which player is in a frame by the host we put it on', () => {
    expect(framePlayerOf('https://www.youtube-nocookie.com/embed/x?autoplay=1')).toBe('youtube')
    expect(framePlayerOf('https://www.tiktok.com/player/v1/1?autoplay=1')).toBe('tiktok')
    expect(framePlayerOf('https://player.vimeo.com/video/1?background=1')).toBe('vimeo')
    expect(framePlayerOf('https://www.instagram.com/p/x/embed/')).toBeNull()
    expect(framePlayerOf(null)).toBeNull()
    expect(framePlayerOf('https://www.youtube-nocookie.com.evil.example/embed/x')).toBeNull()
  })

  it("speaks each provider's own words, to that provider's origin only", () => {
    expect(soundCommand('youtube', true)).toEqual({
      message: '{"event":"command","func":"unMute","args":[]}', targetOrigin: 'https://www.youtube-nocookie.com',
    })
    expect(JSON.parse(soundCommand('youtube', false).message as string).func).toBe('mute')
    expect(soundCommand('tiktok', true)).toEqual({
      message: { 'x-tiktok-player': true, type: 'unMute' }, targetOrigin: 'https://www.tiktok.com',
    })
    expect((soundCommand('tiktok', false).message as { type: string }).type).toBe('mute')
    expect(soundCommand('vimeo', true)).toEqual({
      message: '{"method":"setMuted","value":false}', targetOrigin: 'https://player.vimeo.com',
    })
    expect(JSON.parse(soundCommand('vimeo', false).message as string).value).toBe(true)
    expect(JSON.parse(YOUTUBE_LISTEN).event).toBe('listening')
  })

  it('a mock-up made from a post is the same kind of player its post is', () => {
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.tiktok.com/@a/video/7412345678901234567' })).toBe('embed')
    expect(autoplayKindFor({ kind: 'link', url: 'https://www.instagram.com/reel/Cabc123/' })).toBe('instagram')
    // and a mock-up with no post is not a player at all
    expect(autoplayKindFor({ kind: 'mockup' })).toBe('none')
  })
})

describe('the line under an Instagram video that says how to make it play', () => {
  const reel = { kind: 'link', url: 'https://www.instagram.com/reel/C1a2B3c4D5e/', provider: 'Instagram', media: 'video' }

  it('shows for an Instagram video when the viewer can edit', () => {
    expect(instagramPlayHint(reel, true)).toBe(INSTAGRAM_PLAY_HINT)
    expect(INSTAGRAM_PLAY_HINT).toBe("Instagram won't play here — drop the video file on the board to play it.")
    // a /p/ post the preview said is a video counts; so does a reel URL
    // whose preview never came back (no media field at all)
    expect(instagramPlayHint({ ...reel, url: 'https://www.instagram.com/p/C1a2B3c4D5e/' }, true)).toBe(INSTAGRAM_PLAY_HINT)
    expect(instagramPlayHint({ kind: 'link', url: 'https://instagram.com/reels/C1a2B3c4D5e/' }, true)).toBe(INSTAGRAM_PLAY_HINT)
  })

  it('never for an image post', () => {
    expect(instagramPlayHint({ ...reel, url: 'https://www.instagram.com/p/C1a2B3c4D5e/', media: 'image' }, true)).toBeNull()
    expect(instagramPlayHint({ kind: 'link', url: 'https://www.instagram.com/p/C1a2B3c4D5e/', provider: 'Instagram' }, true)).toBeNull()
  })

  it('never when the viewer cannot edit (a viewer, the client portal)', () => {
    expect(instagramPlayHint(reel, false)).toBeNull()
  })

  it('never for another platform, a mock-up, or a bad URL', () => {
    expect(instagramPlayHint({ kind: 'link', url: 'https://www.tiktok.com/@a/video/7412345678901234567', media: 'video' }, true)).toBeNull()
    expect(instagramPlayHint({ ...reel, kind: 'mockup' }, true)).toBeNull()
    expect(instagramPlayHint({ kind: 'link', url: 'not a url', provider: 'Instagram', media: 'video' }, true)).toBeNull()
  })
})
