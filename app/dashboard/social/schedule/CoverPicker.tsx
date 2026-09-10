'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COVER_RULES, coverFrameTimes, coverPlatforms, coverProblems } from '@/app/lib/cover-core'
import { uploadFiles } from '../../uploadQueue'
import { SAVE_WAIT_MS, withTimeout } from '@/app/lib/wait-core'
import PlatformIcon from '../PlatformIcon'

/**
 * THE COVER, CHOSEN IN THE POST WINDOW.
 *
 * Two ways in — a frame off the video, or a picture of your own — and one
 * result: a URL the window writes into each channel's own cover field
 * (`cover-core.coverPatchFor`). Instagram and Facebook take it as the Reel
 * cover, TikTok stitches it in as the first frame, YouTube uses it as the
 * thumbnail on a video (never a Short). The owner, 10 Sep 2026: "can I have
 * an option to upload a cover or choose from the frames?"
 *
 * Frames are taken the way the video editor takes them: the clip is opened
 * with `crossOrigin` so a still can be drawn out of it; a store that will
 * not allow that is said plainly rather than shown as a black strip.
 */
export default function CoverPicker({
  videoUrl, playable, platforms, current, locked, onPick,
}: {
  /** the master file in the post */
  videoUrl: string
  /** the file a browser can play for it (the encoder's copy) */
  playable: (url: string) => string
  /** the networks on the post */
  platforms: readonly string[]
  /** what the post carries now, and where it came from */
  current: { url: string; source: 'window' | 'editor' } | null
  locked: boolean
  /** a new cover URL, or null to go back to the editor's / the network's own */
  onPick: (url: string | null) => void
}) {
  const takers = coverPlatforms(platforms)
  const [mode, setMode] = useState<'closed' | 'frames'>('closed')
  const [frames, setFrames] = useState<{ at: number; still: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const file = useRef<HTMLInputElement | null>(null)

  /* ── the strip: eight stills along the clip, drawn small ── */
  useEffect(() => {
    if (mode !== 'frames') return
    let cancelled = false
    const el = document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.muted = true
    el.playsInline = true
    el.preload = 'auto'
    el.src = playable(videoUrl)
    video.current = el
    setFrames([])
    setProblem(null)
    setBusy('Reading the video')
    const fail = (why: string) => { if (!cancelled) { setProblem(why); setBusy(null) } }
    el.onerror = () => fail('This video will not open here — the place it is stored will not let the page read it.')
    el.onloadedmetadata = async () => {
      try {
        const times = coverFrameTimes(el.duration)
        const out: { at: number; still: string }[] = []
        for (const at of times) {
          if (cancelled) return
          await seek(el, at)
          out.push({ at, still: draw(el, 180) })
          setFrames([...out])
        }
        if (!cancelled) setBusy(null)
      } catch (e) {
        fail(words(e))
      }
    }
    return () => { cancelled = true; el.src = ''; video.current = null }
  }, [mode, videoUrl, playable])

  const useFrame = async (at: number) => {
    const el = video.current
    if (!el) return
    setBusy('Saving the cover')
    setProblem(null)
    try {
      await seek(el, at)
      const canvas = document.createElement('canvas')
      canvas.width = el.videoWidth || 1080
      canvas.height = el.videoHeight || 1920
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser could not take a still from the video')
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('The cover picture could not be written out')
      const url = await send(new File([blob], `cover-${Math.round(at * 10)}.jpg`, { type: 'image/jpeg' }))
      onPick(url)
      setMode('closed')
    } catch (e) {
      setProblem(words(e))
    } finally {
      setBusy(null)
    }
  }

  const usePicture = async (f: File | null | undefined) => {
    if (!f) return
    const wrong = coverProblems({ name: f.name, size: f.size }, takers)
    if (wrong.length) { setProblem(wrong.join(' ')); return }
    setBusy('Uploading the cover')
    setProblem(null)
    try {
      onPick(await send(f))
      setMode('closed')
    } catch (e) {
      setProblem(words(e))
    } finally {
      setBusy(null)
      if (file.current) file.current.value = ''
    }
  }

  if (takers.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
      <div className="flex items-center gap-3">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt="The cover" className="h-[70px] w-[40px] shrink-0 rounded-tile object-cover bg-foreground/[0.06]" />
        ) : (
          <span className="flex h-[70px] w-[40px] shrink-0 items-center justify-center rounded-tile bg-foreground/[0.06] text-muted-foreground">
            <ImageIcon className="h-4 w-4" strokeWidth={1.6} aria-hidden />
          </span>
        )}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-[13px] font-semibold">Cover</span>
          <span className="text-[12px] text-muted-foreground">
            {current
              ? current.source === 'editor' ? 'From the video editor.' : 'Chosen here.'
              : 'None chosen — each network picks a frame itself.'}
            {' '}The picture people see before they press play.
          </span>
          <span className="mt-0.5 flex items-center gap-1">
            {takers.map(p => <PlatformIcon key={p} platform={p} size={14} className="rounded-full" />)}
          </span>
        </span>
      </div>

      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setMode(m => (m === 'frames' ? 'closed' : 'frames'))}
            className={cn(
              'min-h-11 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted disabled:opacity-50',
              mode === 'frames' && 'bg-foreground text-background hover:bg-foreground',
            )}
          >
            Choose a frame
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => file.current?.click()}
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Upload a picture
          </button>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={e => void usePicture(e.target.files?.[0])}
          />
          {current?.source === 'window' && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => { onPick(null); setMode('closed') }}
              className="flex min-h-11 items-center gap-1 rounded-full px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Remove
            </button>
          )}
        </div>
      )}

      {mode === 'frames' && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {frames.map(f => (
            <button
              key={f.at}
              type="button"
              disabled={busy !== null && busy !== 'Reading the video'}
              onClick={() => void useFrame(f.at)}
              title={`${f.at}s`}
              className="shrink-0 overflow-hidden rounded-tile border border-border hover:outline hover:outline-2 hover:outline-accent-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.still} alt={`Frame at ${f.at} seconds`} className="h-[90px] w-auto" />
            </button>
          ))}
          {frames.length === 0 && !problem && (
            <span className="text-[12px] text-muted-foreground">{busy ?? 'Reading the video'}…</span>
          )}
        </div>
      )}

      {busy && mode !== 'frames' && <p role="status" className="text-[12px] text-muted-foreground">{busy}…</p>}
      {/* the readable red, and said out loud: an upload that was refused has
          to reach somebody who is not looking at this corner of the panel */}
      {problem && <p role="alert" className="text-[12px] font-medium text-accent-red-deep">{problem}</p>}

      <p className="text-[12px] leading-snug text-muted-foreground">
        {takers.map(p => COVER_RULES[p].note).join(' ')}
      </p>
    </div>
  )
}

/* ── helpers ── */

function seek(el: HTMLVideoElement, at: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { el.removeEventListener('seeked', done); el.removeEventListener('error', bad); resolve() }
    const bad = () => { el.removeEventListener('seeked', done); el.removeEventListener('error', bad); reject(new Error('The video could not be read')) }
    el.addEventListener('seeked', done)
    el.addEventListener('error', bad)
    el.currentTime = at
  })
}

/** a small still for the strip, as a data URL */
function draw(el: HTMLVideoElement, height: number): string {
  const scale = height / (el.videoHeight || height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((el.videoWidth || height) * scale))
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not take a still from the video')
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

async function send(f: File): Promise<string> {
  const { done } = uploadFiles([f], { group: `cover:${Date.now()}`, purpose: 'social' })
  const url = (await withTimeout(done, SAVE_WAIT_MS * 3, 'The cover upload'))[0]?.url ?? null
  if (!url) throw new Error('The cover picture did not finish uploading')
  return url
}

function words(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return /taint|SecurityError|cross-origin/i.test(m)
    ? 'A frame cannot be taken here — the place the video is stored will not let the page read it. Upload a picture instead.'
    : m || 'That did not work. Try again.'
}
