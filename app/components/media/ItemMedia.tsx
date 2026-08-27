'use client'

import { useState } from 'react'
import SafeVideo from './SafeVideo'
import VideoTile from './VideoTile'
import { looksLikeVideo } from '../../lib/video-probe'

/**
 * The item page's two media pieces, in their own module so the freeze harness
 * at /dev/item-media can render exactly what the item page renders.
 */

export function Media({ src, className, driveUrl, onDims }: {
  src: string
  className?: string
  /** offered on the notice when the file cannot play here */
  driveUrl?: string | null
  /** reports the media's true pixel size once loaded — 1080 × 1350 etc. */
  onDims?: (d: { w: number; h: number }) => void
}) {
  if (!src) return null
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)) {
    // never a bare <video>: a .mov exported with its index at the end spins
    // here forever, and a spinner is indistinguishable from a broken app
    return (
      <SafeVideo src={src} className={className} driveUrl={driveUrl} onDims={onDims}
        noticeClassName="w-full" />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img src={src} alt="" className={className}
      onLoad={e => onDims?.({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
  )
}

/**
 * One row of the Files box.
 *
 * The source files an editor works from are mostly footage, and "click the
 * link and see what happens" is a 184 MB gamble. So a video row grows a Play
 * toggle, and NOTHING happens until it is pressed — not a probe, not a
 * lookup, not a `<video>`. Three source files of 100–400 MB each used to be
 * probed on page load; that was only 768 KB, but the player behind the
 * toggle was a `<video preload="metadata">`, and one press on a moov-at-end
 * .mov was the whole file. Now the press opens a SafeVideo, which probes
 * (once, cached), plays what plays, and says why the rest will not.
 */
export function RawFileRow({ file, canManage, onRemove }: {
  file: { url: string; name: string }
  canManage: boolean
  onRemove?: () => void
}) {
  const [open, setOpen] = useState(false)
  const video = looksLikeVideo(file.url)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <a href={file.url} target="_blank" rel="noreferrer noopener"
          className="truncate text-sm text-blue-600 hover:underline dark:text-blue-400">
          {file.name || file.url}
        </a>
        {video && (
          <button type="button" onClick={() => setOpen(o => !o)}
            className="shrink-0 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
            {open ? 'Hide' : 'Play'}
          </button>
        )}
        {canManage && onRemove && (
          <button type="button" aria-label={`Remove ${file.name}`}
            className="shrink-0 text-zinc-400 hover:text-red-500"
            onClick={onRemove}>✕</button>
        )}
      </div>
      {open && (
        // the press WAS the play: no second poster to press
        <SafeVideo src={file.url} autoStart
          className="max-h-72 w-full rounded-lg bg-zinc-950 object-contain" />
      )}
    </div>
  )
}

/**
 * One tile in a slide strip — the draft strip while a version is built and
 * the strip under the latest cut both draw it. A video slide is a picture of
 * the clip (see VideoTile), never a `<video>`: two of these on a 184 MB .mov
 * were two full downloads.
 */
export function SlideThumb({ slide }: { slide: { url: string; type?: 'image' | 'video' } }) {
  return slide.type === 'video'
    ? <VideoTile url={slide.url} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={slide.url} alt="" className="h-full w-full object-cover" />
}
