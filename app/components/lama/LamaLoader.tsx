'use client'

import { useEffect, useRef, useState } from 'react'
import { markLamaReady } from './ready'

// 4x4 ordered-dither matrix — same sequence the backdrop shader uses, so the
// loader dissolves into the page in the site's own visual language
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const CELL = 16

export default function LamaLoader() {
  const [pct, setPct] = useState(0)
  const [gone, setGone] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setGone(true); markLamaReady(); return }
    // paint the full black cover immediately — the dissolve later clears it
    const cover = canvasRef.current
    const coverCtx = cover?.getContext('2d')
    if (cover && coverCtx) {
      cover.width = window.innerWidth
      cover.height = window.innerHeight
      coverCtx.fillStyle = '#000'
      coverCtx.fillRect(0, 0, cover.width, cover.height)
    }
    const start = performance.now()
    // The counter is an easing curve, not real progress — nothing is waiting on
    // it. It was 1500 + 700, so every visit paid 2.2s during which the page is
    // held at opacity 0 and displaced by Reveal: content is not where it looks
    // like it is, so clicks land on nothing. Long enough to read as deliberate,
    // short enough not to be a toll gate.
    const DUR = 800
    const DISSOLVE = 400
    let raf = 0

    const dissolve = (from: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) { setGone(true); markLamaReady(); return }
      const cols = Math.ceil(canvas.width / CELL)
      const rows = Math.ceil(canvas.height / CELL)

      const tick = (now: number) => {
        // the black cover dissolves cell-by-cell in dither order, revealing
        // the canvas beneath — not a plain fade
        const t = Math.min((now - from) / DISSOLVE, 1)
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const order = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16
            // jitter per macro-cell so the dissolve reads organic, not tiled
            const jitter = (Math.sin(x * 12.9898 + y * 78.233) * 0.5 + 0.5) * 0.3
            if (order * 0.7 + jitter < t) ctx.clearRect(x * CELL, y * CELL, CELL, CELL)
          }
        }
        if (t < 1) raf = requestAnimationFrame(tick)
        else { setGone(true); markLamaReady() }
      }
      raf = requestAnimationFrame(tick)
    }

    const tick = (now: number) => {
      const t = Math.min((now - start) / DUR, 1)
      // easeOutCubic so it rushes early, settles at the end
      setPct(Math.round((1 - Math.pow(1 - t, 3)) * 100))
      if (t < 1) raf = requestAnimationFrame(tick)
      else dissolve(now)
    }
    raf = requestAnimationFrame(tick)

    // Someone who scrolls, clicks or presses a key has decided they are done
    // waiting. Honour that rather than making them watch the rest.
    const skip = () => { cancelAnimationFrame(raf); setGone(true); markLamaReady() }
    const opts = { once: true, passive: true } as const
    window.addEventListener('pointerdown', skip, opts)
    window.addEventListener('wheel', skip, opts)
    window.addEventListener('touchstart', skip, opts)
    window.addEventListener('keydown', skip, opts)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', skip)
      window.removeEventListener('wheel', skip)
      window.removeEventListener('touchstart', skip)
      window.removeEventListener('keydown', skip)
    }
  }, [])

  if (gone) return null
  return (
    <div aria-hidden="true" className="fixed inset-0 z-[200] pointer-events-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {pct < 100 && (
        <span className="absolute bottom-8 left-6 sm:left-10 font-lamam text-sm text-cream tracking-widest">{pct}%</span>
      )}
    </div>
  )
}
