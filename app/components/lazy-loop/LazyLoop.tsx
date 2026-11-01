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
 * NO FLASH: the poster must be the clip's FIRST FRAME. It was a frame from a second
 * (or seven) in, so every clip jumped to another picture the moment it began (the
 * owner, 1 Nov 2026: "it flashes when we scroll to it"). Every clip plays from its
 * start — the site recordings too, opening animation and all ("why are the phone
 * mockup videos starting in the middle"). The clip rewinds while it is off screen,
 * never in sight.
 */
export default function LazyLoop({ src, className, label, }: { src: string; className?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (!v.src) v.src = `${src}.mp4`
          v.play().catch(() => {})
        } else if (v.src) {
          // rewound out of sight, so it comes back on its poster frame and plays from there
          v.pause()
          v.currentTime = 0
        }
      },
      { rootMargin: '0px', threshold: 0.35 },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [src])

  return <video ref={ref} className={className} muted loop playsInline preload="none" poster={`${src}.jpg`} aria-label={label} />
}
