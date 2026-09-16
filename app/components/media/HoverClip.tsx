'use client'

import { useEffect, useRef, useState } from 'react'
import { formatStamp } from '../../lib/video-review-core'

/**
 * A CLIP TILE YOU CAN SCRUB (the owner, 16 Sep 2026: "we need a hover
 * effect since it's already downloaded — hover over the clip and it shows
 * the frames in the video; a vertical line so it indicates it nicely").
 *
 * TWO WAYS TO SHOW A FRAME. With `frames` — the preview copy's stills, one
 * per second, from Cloudflare Stream — the tile is a still at rest and the
 * still under the pointer as it moves: small pictures, instant, whatever
 * the master is (a 4K master seeks in seconds, a still arrives in
 * milliseconds — the first live try). Without `frames`, the tile is the
 * copy itself: it plays on hover and jumps to the nearest keyframe a few
 * times a second, never on every pixel of movement. Either way a thin
 * vertical line sits under the pointer with the second it is at.
 */
const SEEK_EVERY_MS = 220
const FRAME_EVERY_MS = 90

export default function HoverClip({ src, className = '', at = 0.5, poster, duration, frames }: {
  src: string
  className?: string
  /** the second shown at rest */
  at?: number
  /** a still of the clip at rest, when a preview exists */
  poster?: string | null
  /** the clip's length, when the preview knows it */
  duration?: number | null
  /** the still at a second, when a preview exists */
  frames?: ((second: number) => string) | null
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const timer = useRef<number | null>(null)
  const wanted = useRef<number | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const frameTimer = useRef<number | null>(null)
  const wantedFrame = useRef<string | null>(null)
  const warmed = useRef(false)
  useEffect(() => () => { if (frameTimer.current !== null) clearTimeout(frameTimer.current); if (timer.current !== null) clearTimeout(timer.current) }, [])

  const stills = !!frames && !!poster && typeof duration === 'number' && duration > 0

  const showFrame = () => {
    frameTimer.current = null
    const url = wantedFrame.current
    if (!url) return
    // swap only once the picture is here, so the tile never flashes empty
    const img = new Image()
    img.onload = () => { if (wantedFrame.current === url) setFrame(url) }
    img.src = url
  }

  const jump = () => {
    timer.current = null
    const v = ref.current
    const t = wanted.current
    wanted.current = null
    if (!v || t === null || v.seeking) { if (t !== null) { wanted.current = t; timer.current = window.setTimeout(jump, SEEK_EVERY_MS) } return }
    if (typeof v.fastSeek === 'function') v.fastSeek(t)
    else v.currentTime = t
    void v.play().catch(() => undefined)
  }

  const moveTo = (fraction: number) => {
    if (stills) {
      const t = Math.max(0, Math.min(duration - 0.05, fraction * duration))
      setHover({ x: fraction, t })
      wantedFrame.current = frames(Math.round(t))
      if (frameTimer.current === null) frameTimer.current = window.setTimeout(showFrame, FRAME_EVERY_MS)
      return
    }
    const v = ref.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    const t = Math.max(0, Math.min(v.duration - 0.05, fraction * v.duration))
    setHover({ x: fraction, t })
    wanted.current = t
    if (timer.current === null) timer.current = window.setTimeout(jump, SEEK_EVERY_MS)
  }

  return (
    <span className="relative block h-full w-full"
      onMouseEnter={() => {
        if (!stills) { void ref.current?.play().catch(() => undefined); return }
        // warm every still of this clip the moment the pointer arrives, so
        // each swap after that is from the browser's cache — instant
        if (!warmed.current) { warmed.current = true; for (let s = 0; s <= Math.ceil(duration); s++) { const img = new Image(); img.src = frames(s) } }
      }}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        if (r.width > 0) moveTo((e.clientX - r.left) / r.width)
      }}
      onMouseLeave={() => {
        setHover(null)
        wanted.current = null
        wantedFrame.current = null
        setFrame(null)
        if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
        if (frameTimer.current !== null) { clearTimeout(frameTimer.current); frameTimer.current = null }
        const v = ref.current
        if (!v) return
        v.pause()
        v.currentTime = at
      }}>
      {stills
        // eslint-disable-next-line @next/next/no-img-element -- the preview's stills
        ? <img src={frame ?? poster} alt="" draggable={false} className={`${className} pointer-events-none select-none`} />
        : <video ref={ref} src={`${src}#t=${at}`} muted playsInline loop preload="metadata" aria-hidden tabIndex={-1}
            className={`${className} pointer-events-none`} />}
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
