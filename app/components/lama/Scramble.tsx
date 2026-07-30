'use client'

import { createElement, useEffect, useRef, useState } from 'react'

const CHARS = '#(_>@%$*+·<)[]'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useScramble(text: string, opts?: { play?: boolean; duration?: number }) {
  const { play = true, duration = 900 } = opts ?? {}
  const [display, setDisplay] = useState(() => (prefersReduced() ? text : ''))
  const raf = useRef(0)

  useEffect(() => {
    if (!play) return
    if (prefersReduced()) { setDisplay(text); return }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const settled = Math.floor(t * text.length)
      let out = text.slice(0, settled)
      for (let i = settled; i < text.length; i++) {
        out += text[i] === ' ' ? ' ' : CHARS[Math.floor(Math.random() * CHARS.length)]
      }
      setDisplay(out)
      if (t < 1) raf.current = requestAnimationFrame(tick)
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

  const display = useScramble(text, { play })
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
