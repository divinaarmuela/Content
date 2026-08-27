'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { probeUrl, type VideoCheck } from '../../lib/video-probe'
import { EXPORT_ADVICE, type PreviewBlock } from '../../lib/video-probe-core'
import { PREVIEW_POLL_LIMIT, PREVIEW_POLL_MS, previewOf } from '../../lib/stream-client'
import { previewStateFor } from '../../lib/stream-core'

/**
 * A `<video>` that plays, or says why not — never a spinner.
 *
 * A super admin on a MacBook opened a review item and watched the player
 * spin until they gave up. The file was fine: a 184 MB .mov whose index
 * (`moov`) the editor's export had written AFTER the picture, so the browser
 * had to fetch all 184 MB before it could show frame one. There was no error
 * to catch and nothing on screen but a spinner — the worst possible state,
 * because it is indistinguishable from "our storage is broken".
 *
 * So: probe 256 KB first (see lib/video-probe), and when the file cannot
 * play, do something about it. There are three answers, in this order:
 *
 *   1. The original plays        → play the original. A fast-start H.264 mp4
 *                                  is already the best version of itself.
 *   2. It does not, but the
 *      Cloudflare Stream encode
 *      of it is ready            → play that instead, in Cloudflare's own
 *                                  iframe (no player library, plays in every
 *                                  browser — see stream-core for why not HLS
 *                                  in a `<video>`).
 *   3. It does not and there is
 *      no encode yet             → say it is being prepared, and keep asking;
 *                                  or, if none is coming, the reason card.
 *
 * With Cloudflare Stream unconfigured, step 2 and the "preparing" state never
 * occur and this behaves exactly as it did before: reason card and download.
 *
 * When the probe has no opinion — a WebM, a CORS refusal — the `<video>`
 * renders as it always did, with an eight-second stall fallback behind it so
 * a silent spinner still resolves into words.
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
  /** the Cloudflare encode, in Cloudflare's own player */
  | { at: 'stream'; embed: string; poster: string | null }
  /** the encode is on its way — this state re-asks until it is not */
  | { at: 'pending'; words: string }
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
  /** the probe's verdict, kept so the poller can re-decide without re-probing */
  const verdict = useRef<VideoCheck | null>(null)

  // the probe, then — only if the original will not play — the preview.
  //
  // Strictly in that order, and never in parallel: asking about a preview for
  // every ordinary mp4 in the dashboard would be a request per card to answer
  // a question whose answer does not matter. The lookup happens for the files
  // that actually have the problem.
  useEffect(() => {
    let live = true
    verdict.current = null
    if (!probe) { setState({ at: 'ok' }); return }
    setState({ at: 'checking' })
    const giveUp = window.setTimeout(() => { if (live) setState({ at: 'ok' }) }, PROBE_MS)

    void (async () => {
      const check = await probeUrl(src)
      if (!live) return
      verdict.current = check
      if (!check.block) {
        window.clearTimeout(giveUp)
        setState({ at: 'ok' })
        return
      }
      // it will not play. Is there a copy that will — and if not, start one.
      // `claim` is true only on this path, because only here do we KNOW the
      // original is unplayable; encoding a file that plays fine is a bill for
      // nothing.
      const { row } = await previewOf(src, true)
      if (!live) return
      window.clearTimeout(giveUp)
      setState(decide(row, check, words))
    })()

    return () => { live = false; window.clearTimeout(giveUp) }
  }, [src, probe, words])

  /**
   * While an encode is in flight, keep asking.
   *
   * "Check back shortly" that requires the person to reload is a worse promise
   * than it sounds — they are sitting on the page waiting for it. Bounded at
   * ten minutes, which is twice what the copy promises, after which a stuck
   * encode becomes the reason card rather than an endless poll.
   */
  useEffect(() => {
    if (state.at !== 'pending') return
    let live = true
    let asked = 0
    const timer = window.setInterval(() => {
      if (!live) return
      if (++asked > PREVIEW_POLL_LIMIT) {
        window.clearInterval(timer)
        const check = verdict.current
        if (check?.block) setState({ at: 'blocked', block: check.block, bytes: check.bytes })
        return
      }
      void previewOf(src).then(({ row }) => {
        if (!live) return
        const next = decide(row, verdict.current, words)
        // only a CHANGE is worth a re-render; still-pending is the normal case
        if (next.at !== 'pending') setState(next)
      })
    }, PREVIEW_POLL_MS)
    return () => { live = false; window.clearInterval(timer) }
  }, [state.at, src, words])

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

  if (state.at === 'stream') {
    return (
      <iframe
        src={state.embed}
        title={ariaLabel ?? 'Video preview'}
        className={`border-0 ${className ?? ''}`}
        // the set Cloudflare's own embed documentation asks for; without
        // `fullscreen` the control is present and does nothing, which reads
        // as a broken player
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
      />
    )
  }

  if (state.at === 'pending') {
    return (
      <Preparing words={state.words} src={src} driveUrl={driveUrl}
        className={noticeClassName ?? className} />
    )
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
 * The probe's verdict plus the preview row, turned into what to render.
 *
 * A thin shell over `previewStateFor`, which is where the actual rule lives
 * and is unit-tested. Everything this adds is the mapping onto React state.
 */
function decide(
  row: Parameters<typeof previewStateFor>[0],
  check: VideoCheck | null | undefined,
  words: 'team' | 'client',
): State {
  const d = previewStateFor(row, check, words)
  if (d.at === 'play-native') return { at: 'ok' }
  if (d.at === 'play-stream') return { at: 'stream', embed: d.embed, poster: d.poster }
  if (d.at === 'pending') return { at: 'pending', words: d.words }
  return check?.block
    ? { at: 'blocked', block: check.block, bytes: check.bytes }
    : { at: 'ok' }
}

/**
 * The card shown while Cloudflare is encoding.
 *
 * It is not a spinner, for the same reason nothing else here is: a spinner
 * says "something is happening" and nothing else, and the complaint that
 * started all of this was a person watching one for two minutes. This says
 * what is happening, roughly how long it takes, and hands over the file in
 * the meantime — the wait is never the only option.
 */
function Preparing({ words, src, driveUrl, className }: {
  words: string
  src: string
  driveUrl?: string | null
  className?: string
}) {
  return (
    <div
      role="status"
      className={`flex flex-col items-start gap-2 bg-zinc-100 p-4 text-left dark:bg-zinc-900 ${className ?? ''}`}
    >
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{words}</p>
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
    </div>
  )
}

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
