'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Has this element ever been on screen?
 *
 * Sticky: once true it stays true, because the question it answers is "is it
 * worth asking the network about this yet?" and an answer, once fetched, is
 * cached. A browser without IntersectionObserver says yes immediately — the
 * old behaviour, on a browser too old to have met this page.
 */
export function useInView(ref: RefObject<Element | null>, margin = '200px'): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (seen) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver !== 'function') { setSeen(true); return }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect() }
    }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin, seen])
  return seen
}
