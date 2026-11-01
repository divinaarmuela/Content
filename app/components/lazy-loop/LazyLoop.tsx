'use client'

import { useEffect, useRef } from 'react'

/**
 * A silent looping clip that costs nothing until it is near the screen.
 *
 * `autoPlay` makes browsers fetch the whole file on page load even with
 * preload="metadata" — a page of ten loops was downloading ~14 MB before
 * anyone scrolled. Here the poster shows first; the video source is attached
 * as it nears the screen, it plays once a third of it is on screen, and it
 * pauses again when it leaves. Reduced-motion visitors keep the poster.
 *
 * `src` is the path without extension: `${src}.mp4` + `${src}.jpg` poster.
 *
 * NO FLASH (the owner, 1 Nov 2026: "it flashes when we scroll to it", "shows the
 * still and then goes blank and comes back the video"):
 * - the poster is the clip's FIRST FRAME, so starting never jumps to another picture;
 *   every clip plays from its start, the site recordings' opening animation and all;
 * - Chrome drops the poster the moment a source is attached and paints nothing until
 *   the first frame decodes, so the poster is also the element's own background —
 *   there is never an empty box;
 * - the source is attached 400px before the clip is in sight, so it has loaded by then;
 * - it rewinds while off screen, never in sight.
 */
export default function LazyLoop({ src, className, label }: { src: string; className?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    // the poster behind the video, placed as the video itself is (cover, its own object-position)
    v.style.backgroundImage = `url(${src}.jpg)`
    v.style.backgroundSize = 'cover'
    v.style.backgroundPosition = getComputedStyle(v).objectPosition
    v.style.backgroundRepeat = 'no-repeat'
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const near = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !v.src) { v.preload = 'auto'; v.src = `${src}.mp4` }
      },
      { rootMargin: '400px 0px' },
    )
    const seen = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (!v.src) v.src = `${src}.mp4`
          v.play().catch(() => {})
        } else if (v.src) {
          // rewound out of sight, so it comes back on its first frame and plays from there
          v.pause()
          v.currentTime = 0
        }
      },
      { rootMargin: '0px', threshold: 0.35 },
    )
    near.observe(v)
    seen.observe(v)
    return () => { near.disconnect(); seen.disconnect() }
  }, [src])

  return <video ref={ref} className={className} muted loop playsInline preload="none" poster={`${src}.jpg`} aria-label={label} />
}
