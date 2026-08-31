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

function measureVideo(file: File): Promise<{ width?: number; height?: number; seconds?: number }> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (out: { width?: number; height?: number; seconds?: number }) => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      resolve(out)
    }
    const timer = setTimeout(() => done({}), TIMEOUT_MS)
    video.preload = 'metadata'
    // muted + no autoplay: this element never plays, it only reads the header
    video.muted = true
    video.onloadedmetadata = () => {
      clearTimeout(timer)
      // a stream with no duration reports Infinity, which is not a measurement
      const seconds = Number.isFinite(video.duration) ? video.duration : undefined
      done({
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        seconds,
      })
    }
    video.onerror = () => { clearTimeout(timer); done({}) }
    video.src = url
  })
}

/**
 * Everything measurable about one chosen file.
 *
 * `url` is filled in by the caller once the upload finishes — the measurement
 * happens against the local file, so it does not wait on the transfer.
 */
export async function probeFile(file: File): Promise<Omit<AssetProbe, 'url'>> {
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
