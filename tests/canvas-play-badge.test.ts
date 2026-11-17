import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE BROWSER SAID NO (the owner, 15 Sep 2026: "the video here is not
 * playing — sometimes it works, sometimes it does not", on an iMac).
 *
 * A mock-up card with a known clip moved only when the browser allowed a
 * silent autoplay. Safari on a Mac refuses that when its Auto-Play setting
 * says so, and the card then sat frozen with no button — while the plain
 * link card beside it had one. Pinned on the source: the refusal is
 * remembered, a play badge takes over, and the press opens a real player.
 */
const src = readFileSync(join(process.cwd(), 'app/dashboard/production/shoots/[id]/CanvasCard.tsx'), 'utf8').replace(/\r\n/g, '\n')

describe('a refused autoplay is remembered', () => {
  it('the play attempt records its answer', () => {
    expect(src).toContain('const [refused, setRefused] = React.useState(false)')
    expect(src).toContain('if (auto.play) v.play().then(() => setRefused(false)).catch(() => setRefused(true))')
    expect(src).toContain('else { v.pause(); setRefused(false) }')
  })
})

describe('the mock-up card', () => {
  it('draws a play badge whenever its clip is not moving, and a sound badge only while it is', () => {
    expect(src).toContain("{auto.play && !refused && <SoundBadge on={soundOn} onToggle={toggleSound} label={post.title ?? 'post'} onPause={film ? pauseForControls : undefined} />}")
    expect(src).toMatch(/\{!playing && \(autoKind === 'instagram'\s*\? \(post\.media === 'video' \|\| !post\.thumb\)\s*: \(!!film && \(!auto\.play \|\| refused\)\)\) && \(\s*<PlayBadge onPlay=\{onPlay\} label=\{post\.title \?\? 'post'\} \/>/)
  })
  it('the press opens a real player: controls, autoplay, the pointer, like the link card', () => {
    expect(src).toContain('<video ref={videoRef} src={playing || auto.load ? film : undefined} muted loop={!playing} playsInline')
    expect(src).toContain('controls={playing} autoPlay={playing}')
    expect(src).toContain("style={{ pointerEvents: playing ? 'auto' : 'none' }} />")
  })
})

describe('the link card and the file card', () => {
  it('show the play badge, not the sound badge, when the browser refused', () => {
    expect(src).toContain("{!playing && (auto.play && !refused\n              ? <SoundBadge on={soundOn} onToggle={toggleSound} label={card.name ?? 'video'} onPause={pauseForControls} />")
    expect(src).toContain("{auto.play && !refused\n            ? <SoundBadge on={soundOn} onToggle={toggleSound} label={card.title ?? 'post'} onPause={film ? pauseForControls : undefined} />")
  })
})

/**
 * PAUSE ON A CLIP THAT PLAYS BY ITSELF (the owner, 17 Nov 2026: "the controls
 * missing, only sound unmute is there"). A moving clip wore only the sound
 * badge, and the real player came only behind a play badge it never wears —
 * so it could not be stopped or wound back. Pinned on the source: the pause
 * button stops the clip and opens the same real player, and it is offered
 * only where the clip is a file (never over a provider's frame).
 */
describe('a clip playing by itself can be paused', () => {
  it('pause stops the clip and its sound file, then opens the real player', () => {
    expect(src).toContain('const pauseForControls = () => {\n    videoRef.current?.pause()\n    audioRef.current?.pause()\n    onPlay?.()\n  }')
  })
  it('the button is drawn only when a pause was given, and never starts a drag', () => {
    expect(src).toContain('{onPause && (\n        <button')
    expect(src).toContain('data-clip-pause\n          onPointerDown={e => e.stopPropagation()}\n          onClick={e => { e.stopPropagation(); onPause() }}')
  })
})
