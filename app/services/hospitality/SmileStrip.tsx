'use client'

import { useEffect, useRef } from 'react'

/**
 * THE PHOTOS ON A SMILE (owner, 11 Nov 2026: "make the images marquee flow in a smiley way"). The strip glides left
 * forever; each photo sits on a curve that dips in the middle of the screen and rises at both edges, and tilts to
 * follow it. Pure transforms on one rAF loop, no layout work per frame. Pauses on hover; people who ask for less
 * motion get the same curve standing still.
 */
/** `base`: folder the photo names live in (default /hospitality/); pass '' when `src` is already a full path without .jpg */
export default function SmileStrip({ photos, base = '/hospitality/' }: { photos: { src: string; alt: string }[]; base?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const w = wrap.current, t = track.current
    if (!w || !t) return
    const items = [...t.children] as HTMLElement[]
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let offset = 0, last = performance.now(), paused = false, raf = 0
    const SPEED = 40 // px a second

    const place = () => {
      const half = w.clientWidth / 2
      // how deep the smile is; on phones (owner: "moving weirdly") the strip runs straight: the curve was too tight to read
      const depth = w.clientWidth < 700 ? 0 : Math.min(90, w.clientWidth * 0.07)
      const loop = t.scrollWidth / 2 // the list is drawn twice, so half the track is one full lap
      for (const el of items) {
        const iw = el.offsetWidth
        const x = el.offsetLeft - offset
        const wrapped = (((x + iw) % loop) + loop) % loop - iw // each photo leaves on the left and comes back on the right
        const centre = wrapped + el.offsetWidth / 2 - half
        // COSINE smile (owner: "use cosine"): u = -1 at the left edge, 0 in the middle, 1 at the right edge.
        // y = depth · (1 + cos πu) / 2 → 0 at both edges, `depth` (lowest) in the middle; flat beyond the edges.
        const u = Math.max(-1, Math.min(1, centre / half))
        const y = depth * (1 + Math.cos(Math.PI * u)) / 2
        // tilt = the curve's own slope: dy/dx = -(depth·π / 2·half) · sin πu, as an angle
        const tilt = (Math.atan((-depth * Math.PI / (2 * half)) * Math.sin(Math.PI * u)) * 180) / Math.PI
        el.style.transform = `translate3d(${wrapped - el.offsetLeft}px, ${y}px, 0) rotate(${tilt}deg)`
      }
    }
    const tick = (now: number) => {
      const dt = Math.min(64, now - last); last = now
      if (!paused && !still) offset += (SPEED * dt) / 1000
      place()
      raf = requestAnimationFrame(tick)
    }
    // pause for a MOUSE only: on phones a tap fired mouseenter with no mouseleave, so the strip froze
    const enter = (e: PointerEvent) => { if (e.pointerType === 'mouse') paused = true }
    const leave = () => { paused = false }
    w.addEventListener('pointerenter', enter)
    w.addEventListener('pointerleave', leave)
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); w.removeEventListener('pointerenter', enter); w.removeEventListener('pointerleave', leave) }
  }, [])

  return (
    <div ref={wrap} className="hx-smile" aria-label="More of our hospitality photography">
      <div ref={track} className="hx-smile-track">
        {[...photos, ...photos].map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${p.src}-${i}`} src={`${base}${p.src}.jpg`} alt={i < photos.length ? p.alt : ''} aria-hidden={i >= photos.length} loading="lazy" decoding="async" />
        ))}
      </div>
    </div>
  )
}
