'use client'

import { useEffect, useState } from 'react'

// Entrance gate: the preloader announces when it has faded out, and every
// entrance animation (Reveal, Scramble) waits for it — otherwise the hero
// animates behind the black loader screen and appears already settled.
declare global {
  // eslint-disable-next-line no-var
  var __lamaReady: boolean | undefined
}

export function markLamaReady() {
  window.__lamaReady = true
  window.dispatchEvent(new Event('lama:ready'))
}

// True while the closing experience section is on screen (or about to be) —
// the nav pill and side panel hide themselves during it
export function useExperienceActive() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-lama-title="EXPERIENCE"]')
    if (!el) return
    const onScroll = () => {
      const r = el.getBoundingClientRect()
      setActive(r.top < window.innerHeight * 0.8 && r.bottom > 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return active
}

export function useLamaReady() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (window.__lamaReady) { setReady(true); return }
    const on = () => setReady(true)
    window.addEventListener('lama:ready', on)
    // safety net: never keep the page hidden if the loader fails to mount
    const t = window.setTimeout(on, 3000)
    return () => { window.removeEventListener('lama:ready', on); window.clearTimeout(t) }
  }, [])

  return ready
}
