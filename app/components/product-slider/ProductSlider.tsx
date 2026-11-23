'use client'

import { useEffect, useRef } from 'react'

/** `wide`: a landscape photo. Its frame is as tall as the others and wider, so nothing is cut off it. */
export type ProductShot = { src: string; alt: string; caption: string; wide?: boolean }

/**
 * THE PRODUCT SHOTS SLIDER (the owner, 23 Nov 2026, with a sample: "use this instead for the product shots").
 * An endless row of photos that drifts by itself, can be dragged or swiped, and moves each picture a little inside
 * its frame as it crosses the screen. The idea is the sample's (an "infinite horizontal slider"); it is rebuilt here
 * for a page somebody is scrolling down:
 *
 *   - It does NOT take over the mouse wheel. The sample turned every vertical scroll into sideways movement, which
 *     on a full page traps the reader in this section. Only a sideways wheel (a trackpad swipe) moves it.
 *   - A finger moving up or down still scrolls the page (`touch-action: pan-y` in the CSS).
 *   - It stops working while it is off screen, and does not drift for somebody who asked for reduced motion.
 *   - The slides are real elements with their descriptions, drawn by React, not built from strings.
 */

const COPIES = 4
const DRIFT = 24 // px a second, whatever the screen's refresh rate
const EASE = 4.2 // how fast it catches up with where it is headed, a second
const PARALLAX = 0.05

export default function ProductSlider({ shots, label }: { shots: readonly ProductShot[]; label: string }) {
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current, tr = track.current
    if (!el || !tr || shots.length === 0) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const s = { x: 0, target: 0, seq: 0, dragging: false, lastX: 0, moved: 0, seen: false, raf: 0, at: 0 }

    const measure = () => {
      const first = tr.children[0] as HTMLElement | undefined
      const next = tr.children[shots.length] as HTMLElement | undefined
      if (!first || !next) return
      // one full set's width, read off the page so it follows the CSS at every screen size
      const seq = next.offsetLeft - first.offsetLeft
      if (seq <= 0) return
      const keep = s.seq ? s.x / s.seq : -1
      s.seq = seq
      s.x = s.target = keep * seq
    }

    const frame = (now: number) => {
      s.raf = 0
      if (!s.seen) { s.at = 0; return }
      // by the clock, not by the frame: a 120 Hz screen must not drift twice as fast as a 60 Hz one
      const dt = s.at ? Math.min(0.05, (now - s.at) / 1000) : 1 / 60
      s.at = now
      if (!s.dragging && !calm) s.target -= DRIFT * dt
      s.x += (s.target - s.x) * (1 - Math.exp(-EASE * dt))
      // always between one and two sets in, so there is a set either side to show
      if (s.seq > 0) {
        while (s.x > -s.seq) { s.x -= s.seq; s.target -= s.seq }
        while (s.x < -2 * s.seq) { s.x += s.seq; s.target += s.seq }
      }
      tr.style.transform = `translate3d(${s.x}px,0,0)`
      const mid = window.innerWidth / 2
      for (const slide of tr.children) {
        const r = (slide as HTMLElement).getBoundingClientRect()
        if (r.right < -200 || r.left > window.innerWidth + 200) continue
        const img = slide.querySelector('img')
        if (img) img.style.transform = `translate3d(${(r.left + r.width / 2 - mid) * -PARALLAX}px,0,0) scale(1.18)`
      }
      s.raf = requestAnimationFrame(frame)
    }
    const run = () => { if (!s.raf) s.raf = requestAnimationFrame(frame) }

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      s.dragging = true; s.lastX = e.clientX; s.moved = 0
      el.setPointerCapture?.(e.pointerId)
      el.dataset.dragging = 'true'
    }
    const move = (e: PointerEvent) => {
      if (!s.dragging) return
      const d = e.clientX - s.lastX
      s.lastX = e.clientX
      s.moved += Math.abs(d)
      s.target += d * 1.6
    }
    const up = (e: PointerEvent) => {
      if (!s.dragging) return
      s.dragging = false
      el.releasePointerCapture?.(e.pointerId)
      delete el.dataset.dragging
    }
    const wheel = (e: WheelEvent) => {
      // sideways only: an up-and-down wheel belongs to the page
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      e.preventDefault()
      s.target -= Math.max(-120, Math.min(120, e.deltaX * 1.4))
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      s.target += (e.key === 'ArrowLeft' ? 1 : -1) * (s.seq / shots.length || 300)
      run()
    }

    const io = new IntersectionObserver(([entry]) => { s.seen = entry.isIntersecting; if (s.seen) run() }, { rootMargin: '200px' })
    io.observe(el)
    const ro = new ResizeObserver(measure)
    ro.observe(tr)
    measure()

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('keydown', key)
    return () => {
      io.disconnect(); ro.disconnect()
      if (s.raf) cancelAnimationFrame(s.raf)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('keydown', key)
    }
  }, [shots])

  return (
    <div ref={root} className="ps" role="group" aria-roledescription="carousel" aria-label={label} tabIndex={0}>
      <div ref={track} className="ps-track">
        {Array.from({ length: COPIES }, (_, copy) => shots.map((shot, i) => (
          // the first set is the one a screen reader hears; the others are the same pictures again
          <figure key={`${copy}-${shot.src}`} className={shot.wide ? 'ps-slide ps-slide-wide' : 'ps-slide'} aria-hidden={copy > 0 || undefined}>
            <div className="ps-frame">
              <img src={shot.src} alt={copy === 0 ? shot.alt : ''} draggable={false} decoding="async" loading={copy === 0 && i < 6 ? 'eager' : 'lazy'} />
            </div>
            <figcaption>{shot.caption}</figcaption>
          </figure>
        )))}
      </div>
    </div>
  )
}
