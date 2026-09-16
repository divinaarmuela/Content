'use client'

import { useEffect, type RefObject } from 'react'

/**
 * THE CLIP A PHONE CAN PLAY (the owner, 16 Sep 2026: "the client portal —
 * the videos are not working on the phone"). The copy in our storage is the
 * camera master — a 300 MB .mov a laptop chews through and a phone will not
 * start. Once Cloudflare Stream has made its preview of the copy, the player
 * is handed that instead: an adaptive stream every phone plays. Safari plays
 * HLS natively; everything else gets hls.js, loaded only when it is needed.
 * With no preview yet, the copy plays as before.
 */
export function hlsManifestUrl(base: string | null | undefined): string | null {
  return base ? `${base}/manifest/video.m3u8` : null
}

export function useHlsSource(video: RefObject<HTMLVideoElement | null>, src: string | null | undefined): void {
  useEffect(() => {
    const el = video.current
    if (!el || !src) return
    if (!src.endsWith('.m3u8')) {
      if (el.getAttribute('src') !== src) el.src = src
      return
    }
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = src
      return
    }
    let live = true
    let player: { destroy(): void } | null = null
    void import('hls.js').then(({ default: Hls }) => {
      if (!live) return
      if (!Hls.isSupported()) { el.src = src; return }
      const h = new Hls({ maxBufferLength: 30 })
      h.loadSource(src)
      h.attachMedia(el)
      player = h
    })
    return () => { live = false; player?.destroy() }
  }, [video, src])
}
