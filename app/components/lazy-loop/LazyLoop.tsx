'use client'

import { useEffect, useRef } from 'react'

/**
 * A silent looping clip that costs nothing until it is near the screen.
 *
 * `autoPlay` makes browsers fetch the whole file on page load even with
 * preload="metadata" — a page of ten loops was downloading ~14 MB before
 * anyone scrolled. Here the poster shows first; the video source is attached
 * only when a third of it is on screen, and the clip
 * pauses again when it leaves. Reduced-motion visitors keep the poster.
 *
 * `src` is the path without extension: `${src}.mp4` + `${src}.jpg` poster.
 *
 * NO FLASH: the poster must be the frame the clip starts on. It was a frame from a
 * second (or seven) in, so every clip jumped to another picture the moment it began
 * (the owner, 1 Nov 2026: "it flashes when we scroll to it"). Posters are now the
 * first frame; a clip whose poster is taken later (the site recordings open on a
 * loader) passes `start`, the second its poster shows. The clip rewinds while it is
 * off screen, never in sight. `skipOpening` loops back to `start` instead of 0, so a
 * site recording does not sit on its blank loader each time round (homepage tile 04).
 */
export default function LazyLoop({ src, className, label, start = 0, skipOpening = false }: { src: string; className?: string; label: string; start?: number; skipOpening?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (!v.src) v.src = start ? `${src}.mp4#t=${start}` : `${src}.mp4`
          v.play().catch(() => {})
        } else if (v.src) {
          // rewound out of sight, so it comes back on its poster frame and plays from there
          v.pause()
          v.currentTime = start
        }
      },
      { rootMargin: '0px', threshold: 0.35 },
    )
    io.observe(v)
    const again = () => { v.currentTime = start; v.play().catch(() => {}) }
    if (skipOpening) v.addEventListener('ended', again)
    return () => { io.disconnect(); v.removeEventListener('ended', again) }
  }, [src, start, skipOpening])

  return <video ref={ref} className={className} muted loop={!skipOpening} playsInline preload="none" poster={`${src}.jpg`} aria-label={label} />
}
