'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import SafeVideo from './SafeVideo'
import { previewOf } from '../../lib/stream-client'
import { pickPoster } from '../../lib/stream-core'
import {
  SWIPE_THRESHOLD_PX, allSeen, clampIndex, counterLabel, markSeen,
  nextIndex, prevIndex, swipeDecision,
} from '../../lib/slide-carousel-core'

/**
 * A carousel, shown as a carousel.
 *
 * A post can be up to ten cards in a chosen order (see version-files-core).
 * Everywhere a client met one, they got card one at full size and the rest as
 * 36px thumbnails glued to the bottom of the frame — which reads as "one
 * image, plus some clutter", and is what the client actually said. The whole
 * post is now in the frame: arrows, dots, a swipe, and on the full viewer a
 * position counter and a strip that jumps.
 *
 * The arithmetic — wrapping, swipe-vs-scroll, which cards have been seen —
 * lives in `app/lib/slide-carousel-core.ts` and is unit-tested there. This
 * file is the shell: events in, pixels out.
 *
 * A single-file piece renders exactly what it rendered before this existed:
 * one image or one video, no chrome. Most posts are single-file, and none of
 * them should grow a disabled arrow.
 */

export type CarouselSlide = {
  url: string
  /** the file's own name — the alt text, and the thumbnail's tooltip */
  name?: string
  type?: 'image' | 'video'
}

export type SlideCarouselProps = {
  slides: readonly CarouselSlide[]
  /** the shape of the frame. Portal cards are square or 4:5 because that is
   *  what the feed will make of them; the item page is natural, capped at
   *  70vh, because there the client is inspecting the file itself. */
  aspect?: 'video' | 'square' | 'portrait' | 'natural'
  /** which card to open on — a stale index clamps rather than blanking */
  initial?: number
  /** `compact` is a card in a grid: arrows, dots, cover-cropped.
   *  `full` is the piece's own page: counter, thumbnail strip, contained. */
  mode?: 'compact' | 'full'
  className?: string
  /** extra classes for the rows UNDER the frame (dots + counter, thumbnails).
   *  A card's media is full-bleed while its chrome is inset with the rest of
   *  the card's text, so the two need different padding. */
  chromeClassName?: string
  /** the ceiling on a `natural` frame — a Tailwind max-height class. The
   *  review card wants a smaller one than the piece's own page. */
  naturalMax?: string
  /** what the frame sits on. Media is letterboxed, so it is always visible. */
  background?: string
  /** told every time the set of seen cards grows — ReviewCard prints it
   *  beside Approve. Never a gate: see the note there. */
  onSeenChange?: (state: { seen: number[]; total: number; allSeen: boolean }) => void
  /** for screen readers: "Carousel — <title>" */
  label?: string
}

const ASPECT: Record<NonNullable<SlideCarouselProps['aspect']>, string> = {
  video: 'aspect-video',
  square: 'aspect-square',
  portrait: 'aspect-[4/5]',
  natural: '',
}

const VIDEO_URL = /\.(mp4|webm|mov|m4v)(\?|$)/i

function isVideo(s: CarouselSlide): boolean {
  return s.type ? s.type === 'video' : VIDEO_URL.test(s.url)
}

export default function SlideCarousel({
  slides, aspect = 'natural', initial = 0, mode = 'full',
  className, chromeClassName = '', naturalMax = 'max-h-[70vh]',
  background = '#0a0a0a', onSeenChange, label,
}: SlideCarouselProps) {
  const total = slides.length
  const [index, setIndex] = useState(() => clampIndex(initial, total))
  const [seen, setSeen] = useState<number[]>(() => markSeen([], clampIndex(initial, total), total))
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  const go = useCallback((to: number) => {
    const at = clampIndex(to, total)
    setIndex(at)
    setSeen(s => markSeen(s, at, total))
  }, [total])

  // the slides changed under an open card — never leave the index dangling
  useEffect(() => {
    setIndex(i => clampIndex(i, total))
    setSeen(s => markSeen(s, clampIndex(initial, total), total))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  useEffect(() => {
    onSeenChange?.({ seen, total, allSeen: allSeen(seen, total) })
    // the callback is usually an inline arrow — depending on it would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, total])

  /** a video left playing behind a slide you have swiped away from is a voice
   *  coming out of a page that shows something else */
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (v && i !== index && !v.paused) v.pause()
    })
  }, [index])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (total < 2) return
    if (e.key === 'ArrowRight') { e.preventDefault(); go(nextIndex(index, total)) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(prevIndex(index, total)) }
  }

  // Pointer events, not touch events: one code path covers finger, pen and a
  // mouse drag. Anything with its own gesture — a video's scrubber, the
  // arrows — keeps it.
  const onPointerDown = (e: React.PointerEvent) => {
    if (total < 2) return
    const el = e.target as HTMLElement | null
    if (el?.closest('video, audio, button, a')) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId) return
    const decision = swipeDecision(e.clientX - d.x, e.clientY - d.y, SWIPE_THRESHOLD_PX)
    if (decision === 'next') go(nextIndex(index, total))
    if (decision === 'prev') go(prevIndex(index, total))
  }

  if (total === 0) return null

  const many = total > 1
  const full = mode === 'full'
  const fit = full ? 'object-contain' : 'object-cover'
  const natural = aspect === 'natural'
  const mediaClass = natural
    ? `${naturalMax} w-full ${fit}`
    : `h-full w-full ${fit}`
  const counter = counterLabel(index, total)

  return (
    <div className={className}>
      <div
        role="group"
        aria-roledescription={many ? 'carousel' : undefined}
        aria-label={label ?? (many ? `Carousel, ${total} slides` : undefined)}
        tabIndex={many ? 0 : -1}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={endDrag}
        onPointerCancel={() => { drag.current = null }}
        className={`relative grid w-full overflow-hidden outline-none ${ASPECT[aspect]} ${natural ? naturalMax : ''} ${many ? 'touch-pan-y select-none' : ''}`}
        style={{ background }}
      >
        {slides.map((s, i) => {
          const current = i === index
          const alt = s.name?.trim() || (many ? `Slide ${i + 1} of ${total}` : '')
          return (
            <div
              key={s.url + i}
              aria-hidden={!current}
              role={many ? 'group' : undefined}
              aria-roledescription={many ? 'slide' : undefined}
              aria-label={many ? `${i + 1} of ${total}` : undefined}
              className={`col-start-1 row-start-1 flex h-full w-full items-center justify-center transition-opacity duration-200 motion-reduce:transition-none ${
                current ? 'opacity-100' : 'pointer-events-none invisible opacity-0'
              }`}
            >
              {isVideo(s) ? (
                // a .mov whose index is at the end shows a client nothing but
                // a spinner — SafeVideo turns that into a download link and
                // words the client can act on
                <SafeVideo
                  ref={el => { videos.current[i] = el }}
                  src={s.url}
                  words="client"
                  // only the card in the frame is worth a network request
                  preload={current ? 'metadata' : 'none'}
                  probe={current}
                  className={mediaClass}
                  noticeClassName="w-full max-w-md rounded-lg"
                  ariaLabel={alt || undefined}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.url}
                  alt={alt}
                  // a native image-drag fires pointercancel mid-swipe, which
                  // ate every swipe that started on the picture itself
                  draggable={false}
                  loading={current ? 'eager' : 'lazy'}
                  decoding="async"
                  className={mediaClass}
                />
              )}
            </div>
          )
        })}

        {many && (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              onClick={() => go(prevIndex(index, total))}
              className="absolute left-1.5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-opacity hover:bg-black/75 motion-reduce:transition-none"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={() => go(nextIndex(index, total))}
              className="absolute right-1.5 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-opacity hover:bg-black/75 motion-reduce:transition-none"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            {/* the dots ride on the frame on a card, where vertical space is
                the scarce thing; the full viewer gives them their own row
                alongside the counter */}
            {!full && <Dots total={total} index={index} onGo={go} overlay />}
          </>
        )}
      </div>

      {many && full && (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 ${chromeClassName}`}>
          <Dots total={total} index={index} onGo={go} />
          <span className="ml-auto font-mono text-[11px] tabular-nums opacity-60">{counter}</span>
        </div>
      )}

      {many && full && (
        // wrapped, not scrolled: a strip that runs off the right edge of a
        // phone hides the cards it is there to reveal (and trips the
        // off-screen tap-target rule in check-mobile)
        <div className={`flex flex-wrap gap-1.5 pt-1 ${chromeClassName}`}>
          {slides.map((s, i) => (
            <button
              key={s.url + i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show slide ${i + 1}${s.name ? ` — ${s.name}` : ''}`}
              aria-current={i === index}
              title={s.name || `Slide ${i + 1}`}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md transition-opacity motion-reduce:transition-none"
              style={{
                background: '#0a0a0a',
                border: i === index
                  ? '2px solid var(--p-accent, #18181b)'
                  : '1px solid var(--p-border, #e4e4e7)',
                opacity: i === index ? 1 : 0.65,
              }}
            >
              {isVideo(s) ? (
                <VideoThumb url={s.url} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              )}
              <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 font-mono text-[10px] text-white">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One video's tile in the thumbnail strip.
 *
 * `<video preload="none">` was chosen so ten cards did not fetch ten videos —
 * but a video element with nothing preloaded paints nothing, so the strip on
 * a video carousel was a row of black squares with numbers on them. For an
 * HEVC or ProRes .mov it would have stayed black even fully loaded, because
 * the browser cannot decode a single frame of it to show.
 *
 * Cloudflare's encode has a still, and a still is a 20 KB JPEG rather than a
 * video. Where there is one, the tile is a picture of the clip. Where there is
 * not — Stream unconfigured, encode not finished, file that plays fine
 * natively — the tile is exactly the `<video>` it always was.
 */
function VideoThumb({ url }: { url: string }) {
  const [poster, setPoster] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setPoster(null)
    void previewOf(url).then(({ row }) => {
      if (live) setPoster(pickPoster(row))
    })
    return () => { live = false }
  }, [url])

  if (poster) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={poster} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
  }
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video src={url} muted playsInline preload="none" className="h-full w-full object-cover" />
}

/**
 * The dots.
 *
 * Each one is a 44px-tall thumb target with a 6px dot drawn in the middle of
 * it — the portal's tap-target floor applies to a dot as much as to a button,
 * and a 6px button is a miss waiting to happen.
 */
function Dots({ total, index, onGo, overlay }: {
  total: number; index: number; onGo: (i: number) => void; overlay?: boolean
}) {
  return (
    <div
      className={overlay
        ? 'absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-0.5'
        : 'flex flex-wrap items-center gap-0.5'}
    >
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onGo(i)}
          aria-label={`Show slide ${i + 1} of ${total}`}
          aria-current={i === index}
          className="flex h-11 w-6 items-center justify-center"
        >
          <span
            className={`block h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none ${
              i === index ? 'w-4' : 'w-1.5'
            }`}
            style={{
              background: overlay
                ? (i === index ? '#ffffff' : 'rgba(255,255,255,0.5)')
                : (i === index ? 'var(--p-accent, #18181b)' : 'var(--p-border, #d4d4d8)'),
              boxShadow: overlay ? '0 1px 3px rgba(0,0,0,0.6)' : undefined,
            }}
          />
        </button>
      ))}
    </div>
  )
}
