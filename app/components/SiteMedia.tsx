'use client'

import { useEffect, useRef } from 'react'
import { isVideoUrl } from '../lib/media-core'

/**
 * Renders a CMS media URL as a muted looping video or a plain image.
 *
 * Videos play silently, with no controls — the motion is the design. But they
 * only start once they are actually on screen, and until then the browser is
 * told to fetch metadata only.
 *
 * That distinction is the whole page-load story. `autoPlay` with
 * `preload="auto"` makes the browser download every video on the page at once,
 * so a grid holding one 219MB master stalled before anything rendered. Now
 * nothing downloads a body until it scrolls into view, and playback pauses
 * again when it leaves — a page of ten cards fetches ten first frames instead
 * of a gigabyte.
 *
 * On shape: callers give the frame a fixed aspect ratio so every card in a row
 * is the same height, and use object-contain so a portrait clip is fitted
 * inside that frame rather than cropped to a band through its middle.
 *
 * A large file is still slow to play once it starts. Compress anything
 * public-facing before upload — the storage limit is 5GB, the page has no such
 * patience.
 */
export default function SiteMedia({
  src, alt, className, poster, autoPlay = true,
}: {
  src: string
  alt: string
  className?: string
  /** Still shown before playback. Without one the first frame is used. */
  poster?: string
  /** False keeps it paused until a person asks for it. */
  autoPlay?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !autoPlay) return

    // Respect a stated preference for less motion: leave it on its first frame.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // only now does the browser fetch the body
          el.preload = 'auto'
          el.play().catch(() => { /* autoplay refused; the frame still shows */ })
        } else {
          el.pause()
        }
      },
      // a little early so it is moving by the time it is properly visible
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
        // metadata is one frame; auto would be the entire file
        preload="metadata"
        loop
        muted
        // without this iOS Safari throws the video fullscreen on play
        playsInline
        aria-label={alt}
        className={className}
      />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={className} />
}
