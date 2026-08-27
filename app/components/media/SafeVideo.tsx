'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { probeUrl } from '../../lib/video-probe'
import { EXPORT_ADVICE, type PreviewBlock } from '../../lib/video-probe-core'

/**
 * A `<video>` that says why, instead of spinning.
 *
 * A super admin on a MacBook opened a review item and watched the player
 * spin until they gave up. The file was fine: a 184 MB .mov whose index
 * (`moov`) the editor's export had written AFTER the picture, so the browser
 * had to fetch all 184 MB before it could show frame one. There was no error
 * to catch and nothing on screen but a spinner — the worst possible state,
 * because it is indistinguishable from "our storage is broken".
 *
 * So: probe 256 KB first (see lib/video-probe), and when the file cannot
 * play, render the reason and the three things a person might actually do
 * about it. When the probe has no opinion — a WebM, a CORS refusal — the
 * `<video>` renders as it always did, with an eight-second stall fallback
 * behind it so a silent spinner still resolves into words.
 */

/** How long a video may show nothing before we stop calling it "loading". */
const STALL_MS = 8000
/** How long we wait on the probe before giving the player its chance anyway. */
const PROBE_MS = 6000

export type SafeVideoProps = {
  src: string
  className?: string
  /** `team` names the file and the fix; `client` says it is still processing */
  words?: 'team' | 'client'
  /** shown as "Open in Drive" on the notice, when this version has a folder */
  driveUrl?: string | null
  preload?: 'none' | 'metadata' | 'auto'
  /** false for a card that is mounted but off-screen — a ten-slide carousel
   *  must not fire ten range requests to answer a question about one slide */
  probe?: boolean
  controls?: boolean
  muted?: boolean
  ariaLabel?: string
  /** the file's true pixel size, once the browser has read it */
  onDims?: (d: { w: number; h: number }) => void
  /** extra classes for the notice card, which is not a video and rarely wants
   *  the video's own sizing */
  noticeClassName?: string
}

type State =
  | { at: 'checking' }
  | { at: 'ok' }
  | { at: 'blocked'; block: PreviewBlock; bytes: number | null }

const STALLED: PreviewBlock = {
  kind: 'fast-start',
  reason: 'it has not started after 8 seconds, so it is downloading in full before it can play',
}
const BROKEN: PreviewBlock = {
  kind: 'codec',
  reason: 'the browser could not decode it',
}

const SafeVideo = forwardRef<HTMLVideoElement, SafeVideoProps>(function SafeVideo({
  src, className, words = 'team', driveUrl, preload = 'metadata', probe = true,
  controls = true, muted, ariaLabel, onDims, noticeClassName,
}, ref) {
  const [state, setState] = useState<State>({ at: 'checking' })
  const stall = useRef<number | null>(null)

  // the probe. A new src is a new question, and never inherits the last answer.
  useEffect(() => {
    let live = true
    if (!probe) { setState({ at: 'ok' }); return }
    setState({ at: 'checking' })
    const giveUp = window.setTimeout(() => { if (live) setState({ at: 'ok' }) }, PROBE_MS)
    void probeUrl(src).then(check => {
      if (!live) return
      window.clearTimeout(giveUp)
      setState(check.block ? { at: 'blocked', block: check.block, bytes: check.bytes } : { at: 'ok' })
    })
    return () => { live = false; window.clearTimeout(giveUp) }
  }, [src, probe])

  const clearStall = () => {
    if (stall.current !== null) { window.clearTimeout(stall.current); stall.current = null }
  }
  // the fallback: the probe said nothing, the player says nothing either
  useEffect(() => {
    // an unprobed card is also an unloaded one (preload="none"): it shows
    // nothing because nothing was asked for, which is not a stall
    if (state.at !== 'ok' || !probe) return
    stall.current = window.setTimeout(
      () => setState({ at: 'blocked', block: STALLED, bytes: null }),
      STALL_MS,
    )
    return clearStall
  }, [state.at, src, probe])

  if (state.at === 'checking') {
    // deliberately not a spinner: a spinner is the thing that lied
    return <div className={className} aria-hidden />
  }

  if (state.at === 'blocked') {
    return (
      <Notice
        block={state.block} src={src} driveUrl={driveUrl} words={words}
        className={noticeClassName ?? className}
      />
    )
  }

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={ref}
      src={src}
      controls={controls}
      muted={muted}
      playsInline
      preload={preload}
      className={className}
      aria-label={ariaLabel}
      onLoadedMetadata={e => {
        clearStall()
        onDims?.({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
      }}
      onCanPlay={clearStall}
      onPlaying={clearStall}
      onError={() => setState({ at: 'blocked', block: BROKEN, bytes: null })}
      onStalled={e => {
        // a stall after the metadata is in is ordinary buffering and resolves
        // itself; a stall before it is the 184 MB download, starting again
        if (e.currentTarget.readyState >= 1 || stall.current !== null) return
        stall.current = window.setTimeout(
          () => setState({ at: 'blocked', block: STALLED, bytes: null }),
          STALL_MS,
        )
      }}
    />
  )
})

export default SafeVideo

/**
 * The card that replaces the spinner.
 *
 * Team members get the reason, the file, and the export setting that stops it
 * happening again. A client gets none of that — "HEVC" is our problem, not
 * theirs — but they still get the file.
 */
function Notice({ block, src, driveUrl, words, className }: {
  block: PreviewBlock
  src: string
  driveUrl?: string | null
  words: 'team' | 'client'
  className?: string
}) {
  const client = words === 'client'
  return (
    <div className={`flex flex-col items-start gap-2 bg-zinc-100 p-4 text-left dark:bg-zinc-900 ${className ?? ''}`}>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
        {client
          ? 'This video is still processing for preview — download to watch.'
          : <>This file can&rsquo;t preview in the browser — {block.reason}.</>}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <a href={src} download target="_blank" rel="noreferrer noopener"
          className="font-medium text-blue-600 hover:underline dark:text-blue-400">
          Download
        </a>
        {driveUrl && (
          <a href={driveUrl} target="_blank" rel="noreferrer noopener"
            className="text-blue-600 hover:underline dark:text-blue-400">
            Open in Drive
          </a>
        )}
      </div>
      {!client && (
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Ask the editor to export as .mp4 (H.264) with Fast Start. {EXPORT_ADVICE}
        </p>
      )}
    </div>
  )
}
