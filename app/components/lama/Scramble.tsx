'use client'

import { createElement, useEffect, useRef, useState } from 'react'
import { useLamaReady } from './ready'

const CHARS = '#(_>@%$*+·<)[]0123456789'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const glitch = (text: string) =>
  text
    .split('')
    .map((c) => (c === ' ' ? ' ' : CHARS[Math.floor(Math.random() * CHARS.length)]))
    .join('')

// Decode animation: every unsettled character flickers through random glyphs
// in chunky ~80ms steps while characters settle left-to-right over `duration`.
export function useScramble(text: string, opts?: { play?: boolean; duration?: number }) {
  const { play = true, duration = 900 } = opts ?? {}
  const [display, setDisplay] = useState(() => (prefersReduced() ? text : ''))
  const raf = useRef(0)

  useEffect(() => {
    if (!play) return
    if (prefersReduced()) { setDisplay(text); return }
    const start = performance.now()
    let lastFlicker = 0
    let noise = glitch(text)
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      // refresh the random glyphs only every ~80ms → chunky terminal flicker
      if (now - lastFlicker > 80) { noise = glitch(text); lastFlicker = now }
      const settled = Math.floor(t * text.length)
      let out = ''
      for (let i = 0; i < text.length; i++) {
        out += i < settled || text[i] === ' ' ? text[i] : noise[i]
      }
      setDisplay(out)
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else setDisplay(text)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [text, play, duration])

  return display
}

export function Scramble({
  text, className, as = 'span', delay = 0,
}: { text: string; className?: string; as?: 'span' | 'p' | 'div'; delay?: number }) {
  const ref = useRef<HTMLElement>(null)
  const [play, setPlay] = useState(false)
  const ready = useLamaReady()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timeout = 0
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          timeout = window.setTimeout(() => setPlay(true), delay)
          io.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => { io.disconnect(); window.clearTimeout(timeout) }
  }, [delay])

  const display = useScramble(text, { play: play && ready })
  // reserve width with invisible final text to avoid layout shift
  return createElement(
    as,
    { ref, className: `relative inline-block ${className ?? ''}` },
    <>
      <span aria-hidden="true" className="invisible">{text}</span>
      <span className="absolute inset-0">{display}</span>
    </>,
  )
}

// Encode-while-scrolling text (the reference site's sticky-bar behaviour):
// while `scrambling` is true the text churns as random glyphs; when it flips
// false it decodes back into the real text.
export function ScrollGlitch({ text, scrambling, className }: { text: string; scrambling: boolean; className?: string }) {
  const [noise, setNoise] = useState(text)

  useEffect(() => {
    if (!scrambling || prefersReduced()) return
    setNoise(glitch(text))
    const id = setInterval(() => setNoise(glitch(text)), 80)
    return () => clearInterval(id)
  }, [scrambling, text])

  const decoded = useScramble(text, { play: !scrambling, duration: 600 })

  return (
    <span className={`relative inline-block ${className ?? ''}`}>
      <span aria-hidden="true" className="invisible">{text}</span>
      <span className="absolute inset-0">{scrambling && !prefersReduced() ? noise : decoded}</span>
    </span>
  )
}
