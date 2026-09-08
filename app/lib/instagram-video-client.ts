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
    /* THE FIRST ASK TAKES HALF A MINUTE. Fetching the video is a real piece
     * of work, and the first answer for a post is usually "not yet". The card
     * used to take that as final: it showed the still, dropped the sound
     * control (there being no video to unmute), and never looked again — so
     * the post sat there looking silent until somebody reloaded the page.
     * It waits instead, quietly, for about a minute. `answers` is cleared for
     * this post on a miss so the next look asks again rather than replaying
     * the same "not yet". */
    let tries = 0
    const settle = (a: VideoAnswer) => {
      if (cancelled) return
      if (a.video !== null) { setVideo(a.video); setSettled(true); return }
      // 'off' means the feature is not switched on, 'not_video' means there is
      // nothing to play — neither improves by asking again
      if (a.reason !== 'unavailable' || tries >= 12) { setSettled(true); return }
      tries += 1
      answers.delete(code)
      window.setTimeout(() => {
        if (cancelled) return
        const next = ask(url, token, false)
        answers.set(code, next)
        next.then(settle)
      }, 5000)
    }
    p.then(settle)
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
