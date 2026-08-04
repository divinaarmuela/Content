'use client'

import { useEffect, useRef, useState } from 'react'
import { isVideoUrl } from '../lib/media-core'

/**
 * Renders a CMS media URL as a muted looping video or a plain image.
 *
 * Videos play silently with no controls — the motion is the design — but only
 * once on screen. `autoPlay` with `preload="auto"` makes the browser download
 * every video on the page at once, so a grid holding one 219MB master stalled
 * before anything rendered. Metadata only until an IntersectionObserver says
 * it is visible.
 *
 * On shape, there are two situations and they want opposite things:
 *
 * - In a GRID, every card must be the same height, so the caller fixes the
 *   frame and the media fills it. Something gets cropped; a 4:5 frame makes
 *   that the edges of a landscape clip rather than the middle of a reel.
 * - On a PAGE, there is no row to line up with, so `adapt` lets the media keep
 *   its own proportions. A vertical film renders vertical.
 *
 * Until the real ratio is known the fallback holds the space, so nothing jumps
 * when metadata lands.
 */
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
    if (!el || !autoPlay) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

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
      className={className}
      style={style}
      onLoad={adapt ? e => {
        const i = e.currentTarget
        if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight)
      } : undefined}
    />
  )
}
