'use client'

import { useEffect } from 'react'

/**
 * Keeps the blurred hero background frame-locked to the showreel.
 *
 * Two <video> tags with the same file buffer and start on their own, so they
 * drift apart — the blur showed a different moment from the reel. The reel is
 * the clock: the background mirrors its play/pause and is pulled back to the
 * reel's time whenever they differ by more than a frame or two.
 */
export default function HeroSync({ reel, bg }: { reel: string; bg: string }) {
  useEffect(() => {
    const r = document.querySelector<HTMLVideoElement>(reel)
    const b = document.querySelector<HTMLVideoElement>(bg)
    if (!r || !b) return
    let raf = 0
    const tick = () => {
      if (Math.abs(b.currentTime - r.currentTime) > 0.08) b.currentTime = r.currentTime
      raf = requestAnimationFrame(tick)
    }
    const play = () => { b.play().catch(() => {}); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick) }
    const pause = () => { b.pause(); cancelAnimationFrame(raf) }
    const seek = () => { b.currentTime = r.currentTime }
    r.addEventListener('play', play)
    r.addEventListener('pause', pause)
    r.addEventListener('seeked', seek)
    if (!r.paused) play()
    return () => {
      cancelAnimationFrame(raf)
      r.removeEventListener('play', play)
      r.removeEventListener('pause', pause)
      r.removeEventListener('seeked', seek)
    }
  }, [reel, bg])
  return null
}
