'use client'

import { useRef, useState } from 'react'
import { formatStamp } from '../../lib/video-review-core'

/**
 * A CLIP TILE YOU CAN SCRUB (the owner, 16 Sep 2026: "we need a hover
 * effect since it's already downloaded — hover over the clip and it shows
 * the frames in the video; a vertical line so it indicates it nicely"). At
 * rest the tile is the clip a moment in. Move across it and the frame
 * follows the pointer, left edge to right edge being the whole clip, with a
 * thin vertical line under the pointer and the second it is at. Leave and it
 * settles back. Only ever given our own copy, which is seekable, so every
 * frame is a Range away.
 */
export default function HoverClip({ src, className = '', at = 0.5 }: {
  src: string
  className?: string
  /** the second shown at rest */
  at?: number
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const frame = useRef<number | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)

  const seekTo = (fraction: number) => {
    const v = ref.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    const t = Math.max(0, Math.min(v.duration - 0.05, fraction * v.duration))
    setHover({ x: fraction, t })
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      v.currentTime = t
    })
  }

  return (
    <span className="relative block h-full w-full"
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        if (r.width > 0) seekTo((e.clientX - r.left) / r.width)
      }}
      onMouseLeave={() => { const v = ref.current; setHover(null); if (!v) return; v.pause(); v.currentTime = at }}>
      <video ref={ref} src={`${src}#t=${at}`} muted playsInline preload="metadata" aria-hidden tabIndex={-1}
        className={`${className} pointer-events-none`} />
      {hover && (
        <>
          {/* the line under the pointer, and the second it is at */}
          <span aria-hidden className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ left: `${hover.x * 100}%` }} />
          <span aria-hidden className="pointer-events-none absolute bottom-1.5 rounded-full bg-black/75 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white"
            style={{ left: `${hover.x * 100}%`, transform: `translateX(${hover.x > 0.7 ? '-100%' : hover.x < 0.3 ? '0' : '-50%'})` }}>
            {formatStamp(hover.t)}
          </span>
          <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 bg-white/30" />
          <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-white" style={{ width: `${hover.x * 100}%` }} />
        </>
      )}
    </span>
  )
}
