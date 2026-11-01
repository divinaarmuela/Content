'use client'

import { useEffect, useRef } from 'react'

/**
 * A silent looping clip that costs nothing until it is near the screen.
 *
 * `autoPlay` makes browsers fetch the whole file on page load even with
 * preload="metadata" — a page of ten loops was downloading ~14 MB before
 * anyone scrolled. Here the poster shows first; the video source is attached
 * only when the element comes within 300px of the viewport, and the clip
 * pauses again when it leaves. Reduced-motion visitors keep the poster.
 *
 * `src` is the path without extension: `${src}.mp4` + `${src}.jpg` poster.
 */
export default function LazyLoop({ src, className, label }: { src: string; className?: string; label: string }) {
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
          v.pause()
        }
      },
      { rootMargin: '300px 0px' },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [src])

  return <video ref={ref} className={className} muted loop playsInline preload="none" poster={`${src}.jpg`} aria-label={label} />
}
