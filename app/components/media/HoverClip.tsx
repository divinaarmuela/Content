'use client'

import { useRef } from 'react'

/**
 * A CLIP TILE YOU CAN SCRUB (the owner, 16 Sep 2026: "we need a hover
 * effect since it's already downloaded — hover over the clip and it shows
 * the frames in the video"). At rest the tile is the clip a moment in. Hover
 * and it plays, muted; move across it and the frame follows the pointer,
 * left edge to right edge being the whole clip. Leave and it settles back.
 * Only ever given our own copy, which is seekable, so every frame is a
 * Range away.
 */
export default function HoverClip({ src, className = '', at = 0.5 }: {
  src: string
  className?: string
  /** the second shown at rest */
  at?: number
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const frame = useRef<number | null>(null)

  const seekTo = (fraction: number) => {
    const v = ref.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      v.currentTime = Math.max(0, Math.min(v.duration - 0.05, fraction * v.duration))
    })
  }

  return (
    <video
      ref={ref}
      src={`${src}#t=${at}`}
      muted
      playsInline
      loop
      preload="metadata"
      aria-hidden
      tabIndex={-1}
      className={className}
      onMouseEnter={() => { void ref.current?.play().catch(() => undefined) }}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        if (r.width > 0) seekTo((e.clientX - r.left) / r.width)
      }}
      onMouseLeave={() => { const v = ref.current; if (!v) return; v.pause(); v.currentTime = at }}
    />
  )
}
