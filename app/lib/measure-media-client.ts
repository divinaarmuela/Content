'use client'

/**
 * What a picture or a video actually IS, read in the browser.
 *
 * Until 8 Sep 2026 a file arrived on a post as `bytes, name, type, url` and
 * nothing else — no width, no height, no length. So a 16:9 master posted as
 * a Reel was cropped by Instagram and nobody was told, and a four-minute
 * clip posted as a Story was cut to sixty seconds and nobody was told. The
 * rules that say those things (`media-fit-core`) were written and tested;
 * they had nothing to read.
 *
 * The browser can answer in well under a second, before the upload has even
 * finished: an image's natural size from a decoded bitmap, a video's size and
 * length from its metadata. Both are measured here, for a File just picked
 * and for a URL already stored, and the answer travels on the slide.
 *
 * Nothing here throws. A file that will not decode simply stays unmeasured,
 * and `AssetCheck` says so rather than guessing.
 */

export type Measured = { width?: number; height?: number; seconds?: number }

const TIMEOUT_MS = 15_000

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), TIMEOUT_MS)
    p.then(v => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(fallback) })
  })
}

function measureImageUrl(url: string): Promise<Measured> {
  return withTimeout(new Promise<Measured>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('image'))
    img.src = url
  }), {})
}

function measureVideoUrl(url: string): Promise<Measured> {
  return withTimeout(new Promise<Measured>((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => {
      const out: Measured = {}
      if (v.videoWidth > 0 && v.videoHeight > 0) { out.width = v.videoWidth; out.height = v.videoHeight }
      if (Number.isFinite(v.duration) && v.duration > 0) out.seconds = Math.round(v.duration * 100) / 100
      resolve(out)
    }
    v.onerror = () => reject(new Error('video'))
    v.src = url
  }), {})
}

/** A file the person just picked — measured off a local object URL, so it
 *  costs nothing and does not wait for the upload. */
export async function measureFile(file: File): Promise<Measured> {
  if (typeof window === 'undefined') return {}
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith('video/')) return await measureVideoUrl(url)
    if (file.type.startsWith('image/')) return await measureImageUrl(url)
    return {}
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A file already in storage — the composer measures what the picker or an
 *  older upload never did. Reads only the header of a video. */
export async function measureUrl(url: string, type: 'image' | 'video'): Promise<Measured> {
  if (typeof window === 'undefined' || !url) return {}
  return type === 'video' ? measureVideoUrl(url) : measureImageUrl(url)
}

/** Has this slide been measured already? Unmeasured is `undefined`, not 0. */
export function isMeasured(s: { width?: number; height?: number; seconds?: number; type: string }): boolean {
  if (!s.width || !s.height) return false
  return s.type !== 'video' || s.seconds !== undefined
}
