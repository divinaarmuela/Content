'use client'

import { useEffect, useState } from 'react'

export default function LamaLoader() {
  const [pct, setPct] = useState(0)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setGone(true); return }
    const start = performance.now()
    const DUR = 1500
    let raf = 0
    let timeout = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / DUR, 1)
      // easeOutCubic so it rushes early, settles at the end
      setPct(Math.round((1 - Math.pow(1 - t, 3)) * 100))
      if (t < 1) raf = requestAnimationFrame(tick)
      else timeout = window.setTimeout(() => setGone(true), 250)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(timeout) }
  }, [])

  if (gone) return null
  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[200] flex items-center justify-center bg-black transition-opacity duration-500 ${pct >= 100 ? 'opacity-0' : 'opacity-100'}`}
    >
      <span className="font-lamam text-sm text-cream tracking-widest">{pct}%</span>
    </div>
  )
}
