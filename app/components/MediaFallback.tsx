'use client'

import { useEffect } from 'react'
import { ownAddress } from '../lib/media-fallback-core'

/** an element that has already been sent round once is never sent again */
const TRIED = 'data-media-fallback'

type Drawn = HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement

function drawn(node: EventTarget | null): Drawn | null {
  return node instanceof HTMLImageElement || node instanceof HTMLVideoElement || node instanceof HTMLAudioElement || node instanceof HTMLSourceElement
    ? node : null
}

/**
 * A PICTURE OR VIDEO THAT WILL NOT LOAD FROM STORAGE IS ASKED FOR AGAIN THROUGH OUR OWN SITE (see
 * media-fallback-core for the day this was needed). Mounted once, in the root layout, so it covers the dashboard,
 * the client portal and the public site without any page knowing about it.
 *
 * It listens for failed loads on the whole page (a failed load does not bubble, so it is caught on the way down),
 * and on arrival looks once at what failed before it was listening. Draws nothing.
 */
export default function MediaFallback({ publicBase }: { publicBase: string | null }) {
  useEffect(() => {
    if (!publicBase) return
    const retry = (el: Drawn) => {
      if (el.hasAttribute(TRIED)) return
      const src = el.getAttribute('src')
      const next = ownAddress(src, publicBase, window.location.origin)
      // a video's still picture comes from storage too, and a still that fails says nothing — so it goes with it
      const poster = el instanceof HTMLVideoElement ? ownAddress(el.getAttribute('poster'), publicBase, window.location.origin) : null
      if (!next && !poster) return
      el.setAttribute(TRIED, '1')
      if (poster) el.setAttribute('poster', poster)
      if (!next) return
      // a small-copy address may carry its own list of sizes; none of them can be reached either
      if (el instanceof HTMLImageElement) el.removeAttribute('srcset')
      el.setAttribute('src', next)
      if (el instanceof HTMLSourceElement) (el.parentElement as HTMLMediaElement | null)?.load?.()
    }
    const onError = (e: Event) => { const el = drawn(e.target); if (el) retry(el) }
    window.addEventListener('error', onError, true)

    // what had already failed before this was listening (a page drawn by the server, then woken up)
    document.querySelectorAll('img').forEach(img => { if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) retry(img) })
    document.querySelectorAll('video, audio').forEach(m => { if ((m as HTMLMediaElement).error) retry(m as HTMLMediaElement) })

    return () => window.removeEventListener('error', onError, true)
  }, [publicBase])
  return null
}
