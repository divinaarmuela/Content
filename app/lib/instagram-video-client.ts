'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { instagramShortcode } from './link-preview-core'
import type { VideoAnswer } from './instagram-video-core'

/**
 * The browser's side of an Instagram video on the board.
 *
 * A card asks ONCE, when it is first near the viewport, and keeps the
 * answer for the life of the page; one more ask is allowed when playback
 * fails (the signed URL expired early). The portal passes its share token
 * through `PortalTokenProvider`; the dashboard passes nothing and is
 * recognised by its session.
 */

const PortalTokenContext = createContext<string | null>(null)
export const PortalTokenProvider = PortalTokenContext.Provider
export function usePortalToken(): string | null {
  return useContext(PortalTokenContext)
}

/** answers shared across every card on the page, by shortcode */
const answers = new Map<string, Promise<VideoAnswer>>()

async function ask(url: string, token: string | null, force: boolean): Promise<VideoAnswer> {
  try {
    const res = await fetch('/api/instagram-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, token: token ?? undefined, force }),
    })
    if (!res.ok) return { video: null, reason: 'unavailable' }
    const json = await res.json() as VideoAnswer
    return json && 'video' in json ? json : { video: null, reason: 'unavailable' }
  } catch {
    return { video: null, reason: 'unavailable' }
  }
}

export type InstagramVideoState = {
  /** the mp4 to play, once known */
  video: string | null
  /** true once the server has answered, video or not */
  settled: boolean
  /** playback failed on the stored URL — ask once more */
  refresh: () => void
}

export function useInstagramVideo(url: string | undefined, wanted: boolean, token: string | null): InstagramVideoState {
  const code = url ? instagramShortcode(url) : null
  const [video, setVideo] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)
  const refreshed = useRef(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!code || !url || !wanted) return
    let cancelled = false
    const force = tick > 0
    let p = force ? undefined : answers.get(code)
    if (!p) {
      p = ask(url, token, force)
      answers.set(code, p)
    }
    p.then(a => {
      if (cancelled) return
      setVideo(a.video)
      setSettled(true)
    })
    return () => { cancelled = true }
  }, [code, url, wanted, token, tick])

  const refresh = () => {
    if (refreshed.current) { setVideo(null); return }
    refreshed.current = true
    setVideo(null)
    setTick(t => t + 1)
  }

  return { video, settled, refresh }
}
