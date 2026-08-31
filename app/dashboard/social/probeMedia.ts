'use client'

/**
 * Measure a file before it is scheduled.
 *
 * The size, the pixel dimensions and the duration are the three facts that
 * decide whether a platform will re-encode, crop, or refuse an asset — and
 * all three are readable in the browser, off the local file, before a byte
 * has been uploaded. Doing it here means the warning appears the moment the
 * media is chosen rather than after a failed publish.
 *
 * Nothing here throws. A codec the browser will not decode, a file that is
 * not really what its name says — every one of those resolves with the
 * measurement missing, and the checker reports it as unknown rather than
 * quietly passing an unmeasured file.
 */

import type { AssetProbe } from '../../lib/media-fit-core'

/** Give up on a file the browser is chewing on rather than block the strip.
 *  A metadata read is milliseconds; anything past this is a decode failure
 *  that will never fire an event either way. */
const TIMEOUT_MS = 8000

function measureImage(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const done = (out: { width?: number; height?: number }) => {
      URL.revokeObjectURL(url)
      resolve(out)
    }
    const timer = setTimeout(() => done({}), TIMEOUT_MS)
    img.onload = () => { clearTimeout(timer); done({ width: img.naturalWidth, height: img.naturalHeight }) }
    img.onerror = () => { clearTimeout(timer); done({}) }
    img.src = url
  })
}

/** How wide a poster frame is kept. Big enough for a 64px thumbnail on a
 *  retina screen, small enough that the data URL is a few KB. */
const POSTER_WIDTH = 320

/** Grab a frame the person will recognise.
 *
 *  The very first frame of a graded clip is very often black, so this seeks a
 *  little way in. Returns nothing if the browser will not decode the file —
 *  a camera .mov usually will not, and that is what the Cloudflare Stream
 *  preview exists to cover. */
function grabPoster(video: HTMLVideoElement): string | undefined {
  try {
    const width = Math.min(POSTER_WIDTH, video.videoWidth)
    if (!width || !video.videoHeight) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * width)
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    // a codec the canvas cannot read — the grey placeholder still works
    return undefined
  }
}

function measureVideo(
  file: File,
): Promise<{ width?: number; height?: number; seconds?: number; poster?: string }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const done = (out: { width?: number; height?: number; seconds?: number; poster?: string }) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      resolve(out)
    }
    const timer = setTimeout(() => done({}), TIMEOUT_MS)
    video.preload = 'metadata'
    // muted + no autoplay: this element never plays, it only reads the header
    video.muted = true
    video.onerror = () => { clearTimeout(timer); done({}) }

    video.onloadedmetadata = () => {
      // a stream with no duration reports Infinity, which is not a measurement
      const seconds = Number.isFinite(video.duration) ? video.duration : undefined
      const measured = {
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        seconds,
      }
      // the measurements are in hand; a poster is a bonus and must never cost
      // them, so anything that goes wrong from here resolves with what we have
      video.onseeked = () => { clearTimeout(timer); done({ ...measured, poster: grabPoster(video) }) }
      try {
        video.currentTime = seconds ? Math.min(0.1, seconds / 2) : 0
      } catch {
        clearTimeout(timer)
        done(measured)
      }
    }
    video.src = url
  })
}

/**
 * Everything measurable about one chosen file.
 *
 * `url` is filled in by the caller once the upload finishes — the measurement
 * happens against the local file, so it does not wait on the transfer.
 */
export async function probeFile(
  file: File,
): Promise<Omit<AssetProbe, 'url'> & { poster?: string }> {
  const type = file.type.startsWith('video/')
    ? 'video' as const
    : file.type === 'application/pdf'
    ? 'document' as const
    : 'image' as const

  const base = { type, mime: file.type || undefined, bytes: file.size }
  if (type === 'document') return base
  const measured = type === 'video' ? await measureVideo(file) : await measureImage(file)
  return { ...base, ...measured }
}
