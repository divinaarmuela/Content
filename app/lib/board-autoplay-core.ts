/**
 * Reference clips on the board play by themselves — the pure half.
 *
 * The owner's ask was one sentence: "I simply upload a link", and the clip
 * should move. Everything that decides WHETHER a card moves, WHICH cards move
 * when there are twenty of them, and WHAT URL the frame gets is here, with no
 * DOM in it, so it can be tested the way `workflow-core.ts` is. The observer
 * wiring that feeds it rectangles lives in `board-autoplay-client.ts`.
 *
 * Three rules, in order of who they protect:
 *
 *  1. The viewer. Someone who asked their machine for less movement
 *     (`prefers-reduced-motion`) gets the still and the play badge, always.
 *  2. The machine. A board of twenty clips is not twenty players: only the
 *     few nearest the middle of the screen run, and a card that has never
 *     come near the screen has not cost a byte.
 *  3. The provider. Instagram's embed does not autoplay and offers no flag,
 *     and we are not copying their files. So an Instagram card does the
 *     next best thing: Instagram's own embed IS the card's face as soon as
 *     the card comes near the screen, and one tap on their play button
 *     plays the Reel right there on the board — never a thumbnail that
 *     first swaps to a frame, never a jump to instagram.com. The frame
 *     comes down again when the card leaves the screen, like the others.
 */

import { isPlayableFile, tiktokVideoId, youtubeId } from './link-preview-core'

/** How many clips may run at once. Three is "the ones you are looking at";
 *  more than that and a laptop fan is the first thing anyone notices. */
export const MAX_AUTOPLAY = 3

/** How far off-screen, in CSS px, a card may be before we start loading its
 *  bytes. Wide enough that a pan reveals a clip already buffering, narrow
 *  enough that a big board opens cheaply. */
export const NEAR_MARGIN_PX = 320

/** What kind of player a card would be, if it were allowed to move.
 *  `instagram` is the odd one: it never moves by itself, but its frame is
 *  mounted ahead of the tap so the tap is the only one needed. */
export type AutoplayKind = 'file' | 'embed' | 'instagram' | 'none'

const ID_OK = /^[\w-]{6,20}$/

/**
 * The iframe URL that plays silently, on a loop, with nothing to click.
 *
 * Built from the id the same way `embedUrlFor` is, and for the same reason:
 * a URL we assemble on a fixed host is inert until it is put in a frame, and
 * nothing a user typed reaches the frame except the id we validated. The
 * parameters are each provider's own, checked against their docs on
 * 2026-09-06:
 *
 *  - YouTube: `autoplay=1&mute=1&loop=1&playlist=<id>` — loop only works when
 *    the video is its own one-item playlist, which is YouTube's documented
 *    quirk, not ours. `controls=0` because the card is a picture that moves,
 *    not a player; tapping it opens the real player with sound.
 *  - TikTok: the Embed Player at `/player/v1/<id>` takes `autoplay=1&muted=1&
 *    loop=1`, and `controls=0` hides the chrome for the same reason.
 *  - Vimeo: `background=1` is Vimeo's own name for exactly this mode —
 *    muted, looping, no controls — and the other three flags are belt and
 *    braces for players that predate it.
 *
 * Instagram and Facebook return null on purpose — see rule 3 above — as does
 * anything that is not one of the three. The click-to-play path
 * (`embedUrlFor`) is untouched and still knows how to play those.
 */
export function autoplayEmbedUrlFor(url: string, canonical?: string | null, origin?: string | null): string | null {
  const yt = youtubeId(url)
  if (yt && ID_OK.test(yt)) {
    // `enablejsapi=1&origin=<ours>` is what lets the page talk to the
    // player after it is up — unmute in place, no second frame. YouTube
    // only listens when the origin is stated and matches the page's own.
    const api = origin && /^https?:\/\/[^/]+$/.test(origin) ? `&enablejsapi=1&origin=${encodeURIComponent(origin)}` : ''
    return `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&mute=1&loop=1&playlist=${yt}&controls=0&rel=0&playsinline=1${api}`
  }
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const path = u.pathname

  if (host.endsWith('vimeo.com')) {
    const id = /^\/(\d+)/.exec(path)?.[1]
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1&muted=1&loop=1&background=1` : null
  }

  if (host.endsWith('tiktok.com')) {
    // a vm.tiktok.com share link carries no id; the link-preview route
    // followed it and stored the real URL as `canonical`, so that plays too
    const id = tiktokVideoId(url) ?? (canonical ? tiktokVideoId(canonical) : null)
    return id ? `https://www.tiktok.com/player/v1/${id}?autoplay=1&muted=1&loop=1&controls=0` : null
  }

  return null
}

/** Which player is inside a frame we built — by the host the frame is on,
 *  never by anything a user typed. */
export type FramePlayer = 'youtube' | 'tiktok' | 'vimeo'

export function framePlayerOf(src: string | null | undefined): FramePlayer | null {
  if (!src) return null
  if (src.startsWith('https://www.youtube-nocookie.com/')) return 'youtube'
  if (src.startsWith('https://www.tiktok.com/player/')) return 'tiktok'
  if (src.startsWith('https://player.vimeo.com/')) return 'vimeo'
  return null
}

/**
 * The message that turns a running frame's sound on or off, IN PLACE — the
 * same player, no reload, no resize. Each provider's own wire format,
 * checked against their docs on 2026-09-06, and each sent only to that
 * provider's origin so a frame that is not theirs never hears it:
 *
 *  - YouTube (IFrame API): a JSON string `{"event":"command","func":"unMute"}`
 *    to `https://www.youtube-nocookie.com`; needs `enablejsapi=1` on the frame.
 *  - TikTok (Embed Player): an object `{"x-tiktok-player":true,"type":"unMute"}`
 *    to `https://www.tiktok.com`.
 *  - Vimeo (Player API): a JSON string `{"method":"setMuted","value":false}`
 *    to `https://player.vimeo.com`.
 */
export function soundCommand(player: FramePlayer, on: boolean): { message: string | Record<string, unknown>; targetOrigin: string } {
  switch (player) {
    case 'youtube':
      return { message: JSON.stringify({ event: 'command', func: on ? 'unMute' : 'mute', args: [] }), targetOrigin: 'https://www.youtube-nocookie.com' }
    case 'tiktok':
      return { message: { 'x-tiktok-player': true, type: on ? 'unMute' : 'mute' }, targetOrigin: 'https://www.tiktok.com' }
    case 'vimeo':
      return { message: JSON.stringify({ method: 'setMuted', value: !on }), targetOrigin: 'https://player.vimeo.com' }
  }
}

/** What YouTube's player wants to hear first, so it starts reporting and
 *  accepts commands — sent once the frame has loaded. */
export const YOUTUBE_LISTEN = JSON.stringify({ event: 'listening' })

/**
 * Instagram's embed page for a post, as the card's face.
 *
 * The plain `/embed/` rather than `/embed/captioned/`: captioned appends the
 * whole caption under the post and the frame grows with it, so a card that
 * should be a compact tile becomes a column of text. The plain one is the
 * media, the header and the action row — tall enough already. Reels keep
 * `/reel/`, posts and IGTV go through `/p/`; both shapes exist on Instagram's
 * side and using the one the link came with is the least surprising.
 */
export function instagramEmbedUrlFor(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (!host.endsWith('instagram.com')) return null
  const m = /^\/(p|reel|reels|tv)\/([\w-]+)/.exec(u.pathname)
  if (!m) return null
  const shape = m[1] === 'reel' || m[1] === 'reels' ? 'reel' : 'p'
  return `https://www.instagram.com/${shape}/${m[2]}/embed/`
}

/** Which player this card would be. A file we host (or any direct video
 *  URL) is a `<video>`; YouTube, TikTok and Vimeo are frames that run by
 *  themselves; an Instagram post is a frame that waits for one tap;
 *  everything else is `none` and keeps today's behaviour. */
export function autoplayKindFor(card: {
  kind?: string; url?: string; media?: string; canonical?: string; embeddable?: false
}): AutoplayKind {
  const url = card.url ?? ''
  if (!url) return 'none'
  if (isPlayableFile(url)) return 'file'
  if (card.kind !== 'link') return 'none'
  if (autoplayEmbedUrlFor(url, card.canonical)) return 'embed'
  // a post Instagram itself said cannot be framed is a still, never a frame
  // that would show their "this post may have been removed" as the card
  if (card.embeddable === false) return 'none'
  if (instagramEmbedUrlFor(url)) return 'instagram'
  return 'none'
}

/** What the card says under an Instagram video, in the team's own words.
 *  Instagram's embed will not play a video on the board — its play button
 *  shows "Watch on Instagram" and leaves — and every link-fixer proxy is
 *  gone (checked 2026-09-06), so the honest line is the one that says what
 *  DOES work. Only for a video (a reel URL, or a post the preview said is
 *  a video), only for someone who can put a file on the board — a viewer
 *  and the client portal (`canEdit` false) get nothing, because the line
 *  asks them to do something they cannot. Never for an image post. */
export const INSTAGRAM_PLAY_HINT = "Instagram won't play here — drop the video file on the board to play it."
export function instagramPlayHint(
  card: { kind?: string; url?: string; media?: string; provider?: string },
  canEdit: boolean,
): string | null {
  if (!canEdit || card.kind !== 'link') return null
  let u: URL
  try { u = new URL(card.url ?? '') } catch { return null }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (card.provider !== 'Instagram' && !host.endsWith('instagram.com')) return null
  const reel = /^\/(reel|reels)\//.test(u.pathname)
  return card.media === 'video' || reel ? INSTAGRAM_PLAY_HINT : null
}

/** One card, as the arbiter sees it: is it on screen, and how far is its
 *  middle from the middle of the screen. */
export type Candidate = {
  id: string
  /** intersecting the viewport right now */
  visible: boolean
  /** px from the card's centre to the viewport's centre; smaller wins */
  distance: number
}

/**
 * Which cards get to play: the visible ones nearest the middle of the
 * screen, at most `cap`. Deterministic on ties (by id) so two renders of the
 * same board pick the same cards, and so a test can say exactly which.
 */
export function pickPlayers(candidates: Candidate[], cap = MAX_AUTOPLAY): string[] {
  if (cap <= 0) return []
  return candidates
    .filter(c => c.visible)
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, cap)
    .map(c => c.id)
}

export type Rect = { top: number; left: number; width: number; height: number }

/** Distance between the middles of two boxes — the ranking key above. */
export function centreDistance(card: Rect, viewport: Rect): number {
  const cx = card.left + card.width / 2, cy = card.top + card.height / 2
  const vx = viewport.left + viewport.width / 2, vy = viewport.top + viewport.height / 2
  return Math.hypot(cx - vx, cy - vy)
}

/** Is any part of the box within `margin` px of the viewport? Used for the
 *  "has it ever been near" question, which decides whether to fetch bytes. */
export function isNear(card: Rect, viewport: Rect, margin = NEAR_MARGIN_PX): boolean {
  return card.left + card.width >= viewport.left - margin
    && card.left <= viewport.left + viewport.width + margin
    && card.top + card.height >= viewport.top - margin
    && card.top <= viewport.top + viewport.height + margin
}

/** What one card should do right now. */
export type AutoplayDecision = {
  /** put a src on the element at all — false means zero bytes */
  load: boolean
  /** and actually run it */
  play: boolean
}

/**
 * The whole decision for one card, from the facts about it.
 *
 * - a card the viewer has tapped (`userPlaying`) is the real player and is
 *   not ours to run — the existing branch renders it
 * - Instagram never plays by itself; its frame is up while the card is
 *   within range of the screen (`inRange`, live) and down when it is not.
 *   Reduced motion does not apply: nothing moves until the viewer taps.
 * - for everything else, reduced motion wins: no load, no play
 * - a card that has never been near the screen loads nothing
 * - otherwise it plays exactly when the arbiter chose it
 *
 * For a frame, `load` and `play` are the same thing (the src IS the
 * playback), so an unchosen frame gets no src — that is the off-screen
 * teardown. For a `<video>` we keep the src once near so a re-entry is
 * instant, and only toggle play/pause.
 */
export function decideAutoplay(f: {
  kind: AutoplayKind
  reducedMotion: boolean
  /** has ever been within NEAR_MARGIN_PX of the screen — sticky */
  near: boolean
  /** is within NEAR_MARGIN_PX of the screen right now — live */
  inRange?: boolean
  /** one of the arbiter's few */
  chosen: boolean
  userPlaying?: boolean
}): AutoplayDecision {
  if (f.kind === 'none' || f.userPlaying) return { load: false, play: false }
  if (f.kind === 'instagram') return { load: Boolean(f.inRange), play: false }
  if (f.reducedMotion || !f.near) return { load: false, play: false }
  if (f.kind === 'embed') return { load: f.chosen, play: f.chosen }
  return { load: true, play: f.chosen }
}

/**
 * The arbiter: every card on the page registers, reports whether it is on
 * screen, and is told whether it is one of the chosen. Pure — it is handed a
 * `measure` that returns a card's distance from the viewport's centre, so a
 * test can feed it numbers and the browser can feed it rectangles.
 *
 * One per page, not per board (the portal has one board; the dashboard may
 * one day show two): the cap is about the machine, not the board.
 */
export class AutoplayArbiter {
  private cards = new Map<string, { visible: boolean; chosen: boolean; listener: (chosen: boolean) => void }>()
  constructor(private measure: (id: string) => number, private cap = MAX_AUTOPLAY) {}

  add(id: string, listener: (chosen: boolean) => void): void {
    this.cards.set(id, { visible: false, chosen: false, listener })
  }

  remove(id: string): void {
    this.cards.delete(id)
    this.recompute()
  }

  setVisible(id: string, visible: boolean): void {
    const c = this.cards.get(id)
    if (!c || c.visible === visible) return
    c.visible = visible
    this.recompute()
  }

  /** the ids currently allowed to play */
  chosen(): string[] {
    return [...this.cards].filter(([, c]) => c.chosen).map(([id]) => id)
  }

  get size(): number { return this.cards.size }

  /** Re-rank. Also called by the browser side after any intersection change,
   *  since a pan moves a card nearer the centre without changing whether it
   *  is visible. */
  recompute(): void {
    const cands: Candidate[] = []
    for (const [id, c] of this.cards) {
      cands.push({ id, visible: c.visible, distance: c.visible ? this.measure(id) : Infinity })
    }
    const picked = new Set(pickPlayers(cands, this.cap))
    for (const [id, c] of this.cards) {
      const next = picked.has(id)
      if (next === c.chosen) continue
      c.chosen = next
      c.listener(next)
    }
  }
}
