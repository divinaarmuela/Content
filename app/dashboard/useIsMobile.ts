'use client'

import { useEffect, useState } from 'react'

/**
 * Is this a phone? One answer, from the same breakpoint Tailwind's `md:`
 * uses, so what the hook decides and what the classes draw never disagree.
 *
 * False until mounted: these pages prerender, and the server has no viewport.
 * A board that briefly draws five lanes and then collapses is worse than one
 * that draws the picker a frame late, so callers should treat the first
 * render as "unknown" where it matters (they mostly hide behind a skeleton).
 */
export function useIsMobile(maxWidth = 767): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const apply = () => setMobile(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [maxWidth])
  return mobile
}
