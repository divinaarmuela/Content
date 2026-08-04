'use client'

import { useEffect, useRef, useState } from 'react'
import { isVideoUrl } from '../lib/media-core'

/**
 * Renders a CMS media URL as a muted looping video or a plain image.
 *
 * Playback is deliberately conservative, because the files here are large and
 * the cost of moving them lands on the visitor:
 *
 * - `preload="metadata"` — one frame, never the body, until we decide otherwise.
 * - An IntersectionObserver starts playback only when the element is on screen
 *   and pauses it again on the way out, so a grid of ten videos fetches ten
 *   frames rather than a gigabyte.
 * - Data Saver and genuinely slow connections (2G/3G) get the first frame
 *   instead of the body. Phones on a normal connection still play: the video
 *   IS the work here, and a portfolio that shows stills on mobile is not
 *   showing the work.
 * - `prefers-reduced-motion` is honoured the same way.
 *
 * On shape, grids and pages want opposite things. In a grid every card must
 * line up, so the caller fixes the frame and the media fills it. On a page
 * there is no row to match, so `adapt` lets the media keep the proportions it
 * was shot in — a vertical film renders vertical.
 */

/** Should this device spend bandwidth on decorative video? */
function shouldPlayVideo(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false

  // Data Saver, or a connection the browser considers slow.
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection
  if (conn?.saveData) return false
  if (conn?.effectiveType && /^(slow-)?2g$|^3g$/.test(conn.effectiveType)) return false

  return true
}

export default function SiteMedia({
  src, alt, className, poster, autoPlay = true, adapt = false, fallbackRatio = 16 / 9,
}: {
  src: string
  alt: string
  className?: string
  /** Still shown before playback. Without one the first frame is used. */
  poster?: string
  /** False keeps it paused until a person asks for it. */
  autoPlay?: boolean
  /** Take the media's own aspect ratio instead of a frame set by the caller. */
  adapt?: boolean
  /** Shape held before the real one is known. */
  fallbackRatio?: number
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [ratio, setRatio] = useState<number | null>(null)
  const style = adapt ? { aspectRatio: String(ratio ?? fallbackRatio) } : undefined

  useEffect(() => {
    const el = ref.current
    if (!el || !autoPlay || !shouldPlayVideo()) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.preload = 'auto'          // only now fetch the body
          el.play().catch(() => { /* refused; the frame still shows */ })
        } else {
          el.pause()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [autoPlay, src])

  if (isVideoUrl(src)) {
    return (
      <video
        ref={ref}
        src={src}
        poster={poster}
        preload="metadata"
        loop
        muted
        // without this iOS Safari throws the video fullscreen on play
        playsInline
        aria-label={alt}
        className={className}
        style={style}
        onLoadedMetadata={adapt ? e => {
          const v = e.currentTarget
          if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
        } : undefined}
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
      onLoad={adapt ? e => {
        const i = e.currentTarget
        if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight)
      } : undefined}
    />
  )
}
