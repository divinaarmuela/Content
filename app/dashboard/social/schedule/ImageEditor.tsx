'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crop as CropIcon, Loader2, Redo2, SlidersHorizontal, Type as TypeIcon, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CROP_PRESETS, EMPTY_TEXT, LOOKS, MAX_EXPORT_PX, NEUTRAL_FILTERS, TEXT_FONTS,
  TEXT_SIZE_MAX, TEXT_SIZE_MIN, applyMatrix, arrowDelta, clampCover, clampCrop,
  clampTextSpot, clampTrim, clockOf, cropRectFor, derivedName, exportSize,
  filterMatrix, filtersAreNeutral, hasText, isWholeImage, outputType,
  presetByKey, resizeCrop, saveDecision, textLayout, trimChanged,
  videoSaveDecision, wholeClip,
  type Corner, type Filters, type Rect, type TextLine, type Trim,
} from '@/app/lib/image-edit-core'
import { friendlyError } from '@/app/lib/support-core'
import type { Slide } from '@/app/lib/version-files-core'
import { uploadFiles } from '../../uploadQueue'

/**
 * EDIT IMAGE — crop, filters, one line of text. In the browser, on a canvas.
 *
 * The whole window is built around one sentence: the button says what the
 * save will do to the client's approval BEFORE it is pressed. A crop is the
 * same picture in a tighter frame, so the approval stands and the button
 * reads "Save crop". A filter or a caption is a different picture, so it
 * becomes a new version the client has to look at again — and the button says
 * exactly that, in those words. `saveDecision` in `image-edit-core.ts` is the
 * one place that rule lives; nothing here decides it locally.
 *
 * Everything is done here, in the page: the file is drawn, cropped, filtered
 * and written out by the browser, then uploaded like any other file. No
 * server-side image pipeline, no queue, and nothing to go wrong halfway.
 *
 * A video gets the two things a browser can honestly do to one — pick the
 * cover frame and mark where the clip should start and end. It is never
 * re-encoded here: that would hand the client a worse copy of their own
 * footage. The window says so rather than offering a cut it cannot make.
 */

type Tab = 'crop' | 'filters' | 'text'

/** The four handles, named the way somebody would say them out loud rather
 *  than by compass point — a screen reader saying "n w corner" helps nobody. */
const CORNERS: { key: Corner; label: string }[] = [
  { key: 'nw', label: 'Top left' },
  { key: 'ne', label: 'Top right' },
  { key: 'sw', label: 'Bottom left' },
  { key: 'se', label: 'Bottom right' },
]

export type ImageEditorTarget = {
  itemId: string
  title: string
  versionNumber: number | null
  /** every slide of the version, so the new-version save can send the set */
  slides: Slide[]
  /** which one is being edited */
  index: number
  /** the post this media is in, when there is one */
  postId: string | null
}

/** one step of history — everything a person can undo */
type Step = { crop: Rect; filters: Filters; text: TextLine; preset: string }

export default function ImageEditor(
  { target, onClose, onSaved }: {
    target: ImageEditorTarget
    onClose: () => void
    onSaved: (message: string) => void
  },
) {
  const slide = target.slides[target.index]
  const isVideo = slide?.type === 'video'

  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose, busy])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isVideo ? 'Edit video' : 'Edit image'}
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-3 sm:items-center sm:p-6"
    >
      <div className="flex max-h-full w-full max-w-[900px] flex-col gap-3 rounded-card bg-surface p-4 shadow-xl sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-section-title">{isVideo ? 'Edit video' : 'Edit image'}</h2>
            <p className="text-[13px] text-muted-foreground">{target.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-50"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {problem && (
          <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
            {problem}
          </p>
        )}

        {!slide ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            That file is not part of this piece any more. Close this and open it again.
          </p>
        ) : isVideo ? (
          <VideoPanel
            target={target} slide={slide} busy={busy} setBusy={setBusy}
            setProblem={setProblem} onSaved={onSaved}
          />
        ) : (
          <PicturePanel
            target={target} slide={slide} busy={busy} setBusy={setBusy}
            setProblem={setProblem} onSaved={onSaved}
          />
        )}
      </div>
    </div>
  )
}

/* ── the picture ───────────────────────────────────────────────────────── */

function PicturePanel({ target, slide, busy, setBusy, setProblem, onSaved }: {
  target: ImageEditorTarget
  slide: Slide
  busy: boolean
  setBusy: (v: boolean) => void
  setProblem: (v: string | null) => void
  onSaved: (message: string) => void
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const [tab, setTab] = useState<Tab>('crop')
  const [preset, setPreset] = useState('free')
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const [filters, setFilters] = useState<Filters>(NEUTRAL_FILTERS)
  const [text, setText] = useState<TextLine>(EMPTY_TEXT)

  /** undo: every change pushes the state it replaced */
  const [past, setPast] = useState<Step[]>([])
  const [future, setFuture] = useState<Step[]>([])
  const current = useMemo<Step>(() => ({ crop, filters, text, preset }), [crop, filters, text, preset])
  const remember = useCallback(() => {
    setPast(p => [...p.slice(-40), current])
    setFuture([])
  }, [current])

  /**
   * Undo and redo, with every setter called at the TOP LEVEL.
   *
   * They used to be called inside the `setPast` updater, which React is free
   * to run twice — and does, in development — so one press of Undo could push
   * two redo entries. An updater has to be a pure function of the state it is
   * handed; anything else belongs out here.
   */
  const apply = useCallback((step: Step) => {
    setCrop(step.crop)
    setFilters(step.filters)
    setText(step.text)
    setPreset(step.preset)
  }, [])

  const undo = useCallback(() => {
    if (past.length === 0) return
    const last = past[past.length - 1]
    setPast(p => p.slice(0, -1))
    setFuture(f => [current, ...f])
    apply(last)
  }, [past, current, apply])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setFuture(f => f.slice(1))
    setPast(p => [...p, current])
    apply(next)
  }, [future, current, apply])

  /**
   * The file, fetched so the canvas may read its pixels.
   *
   * `crossOrigin` has to be set BEFORE `src` or the browser caches the image
   * without permission to read it back, and every export from then on throws
   * a security error that looks like a bug in the editor.
   */
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImage(img)
      setNatural({ width: img.naturalWidth, height: img.naturalHeight })
      setCrop({ x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => setLoadFailed(true)
    img.src = slide.url
    return () => { img.onload = null; img.onerror = null }
  }, [slide.url])

  /* ── the preview ─────────────────────────────────────────────────────── */

  const canvas = useRef<HTMLCanvasElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  // the picture drawn to fit its frame, with the filters on it. Redrawn on
  // every slider move, which is cheap at preview size and is the ONLY way the
  // screen and the exported file can be guaranteed to agree.
  useEffect(() => {
    const el = canvas.current
    if (!el || !image || !natural || box.width === 0) return
    el.width = Math.round(box.width)
    el.height = Math.round(box.height)
    const ctx = el.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.drawImage(image, 0, 0, el.width, el.height)
    if (!filtersAreNeutral(filters)) {
      const data = ctx.getImageData(0, 0, el.width, el.height)
      applyMatrix(data.data, filterMatrix(filters))
      ctx.putImageData(data, 0, 0)
    }
  }, [image, natural, box, filters])

  // how big the picture is allowed to be drawn, and the scale between the
  // file's pixels and the screen's
  useEffect(() => {
    const el = frame.current
    if (!el || !natural) return
    const measure = () => {
      const w = el.clientWidth
      const maxH = Math.max(220, Math.min(460, window.innerHeight - 420))
      const scale = Math.min(w / natural.width, maxH / natural.height, 1)
      setBox({ width: natural.width * scale, height: natural.height * scale })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [natural])

  const scale = natural && box.width > 0 ? box.width / natural.width : 1

  /* ── dragging the crop box ───────────────────────────────────────────── */

  const drag = useRef<
    { mode: 'move' | Corner; x: number; y: number; start: Rect } | null>(null)

  const onPointerDown = (mode: 'move' | Corner) =>
    (e: React.PointerEvent) => {
      if (!natural) return
      e.preventDefault()
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      remember()
      drag.current = { mode, x: e.clientX, y: e.clientY, start: crop }
    }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !natural) return
    const dx = (e.clientX - d.x) / scale
    const dy = (e.clientY - d.y) / scale
    if (d.mode === 'move') {
      // moving never resizes, so the ratio must not be re-imposed here
      setCrop(clampCrop({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, natural, null))
      return
    }
    // the corner being dragged is the only one that moves — `resizeCrop`
    // nails the opposite one down, so a square does not slide away under a
    // hand pulling one of its corners
    setCrop(resizeCrop(d.mode, d.start, dx, dy, natural, presetByKey(preset).ratio))
  }

  const endDrag = () => { drag.current = null }

  /**
   * The same two moves from the keyboard.
   *
   * Until now the frame could only be placed with a pointer: the presets gave
   * somebody on a keyboard a shape and then nothing to do with it. Arrow keys
   * move the frame (or resize from whichever corner has focus) a pixel at a
   * time, Shift makes it ten.
   */
  const onFrameKey = (e: React.KeyboardEvent) => {
    if (!natural) return
    const move = arrowDelta(e.key, e.shiftKey)
    if (!move) return
    e.preventDefault()
    e.stopPropagation()
    remember()
    setCrop(clampCrop(
      { ...crop, x: crop.x + move.dx, y: crop.y + move.dy }, natural, null))
  }

  const onCornerKey = (corner: Corner) => (e: React.KeyboardEvent) => {
    if (!natural) return
    const move = arrowDelta(e.key, e.shiftKey)
    if (!move) return
    e.preventDefault()
    e.stopPropagation()
    remember()
    setCrop(resizeCrop(corner, crop, move.dx, move.dy, natural, presetByKey(preset).ratio))
  }

  /* ── dragging the caption ────────────────────────────────────────────── */

  const textDrag = useRef(false)
  const onTextDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    remember()
    textDrag.current = true
  }
  const onTextMove = (e: React.PointerEvent) => {
    if (!textDrag.current) return
    const rect = (e.currentTarget as Element).parentElement?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    setText(t => ({
      ...t,
      ...clampTextSpot({
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      }),
    }))
  }

  /** The caption, moved by arrow keys — a pixel of the picture as drawn, so a
   *  press does the same thing it would with a mouse. */
  const onTextKey = (e: React.KeyboardEvent) => {
    const move = arrowDelta(e.key, e.shiftKey)
    if (!move || box.width === 0 || box.height === 0) return
    e.preventDefault()
    e.stopPropagation()
    remember()
    setText(t => ({
      ...t,
      ...clampTextSpot({
        x: t.x + move.dx / box.width,
        y: t.y + move.dy / box.height,
      }),
    }))
  }

  /* ── what the save will do ───────────────────────────────────────────── */

  const cropped = Boolean(natural) && !isWholeImage(crop, natural ?? { width: 1, height: 1 })
  const plan = saveDecision({
    cropped,
    filtered: !filtersAreNeutral(filters),
    text: hasText(text),
  })

  const out = natural ? exportSize(crop) : null

  const save = async () => {
    if (!image || !natural || plan.kind === 'none') return
    setBusy(true)
    setProblem(null)
    try {
      const size = exportSize(crop)
      const el = document.createElement('canvas')
      el.width = size.width
      el.height = size.height
      const ctx = el.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('This browser could not open the picture for editing')

      ctx.drawImage(
        image,
        crop.x, crop.y, crop.width, crop.height,
        0, 0, size.width, size.height,
      )
      if (!filtersAreNeutral(filters)) {
        const data = ctx.getImageData(0, 0, size.width, size.height)
        applyMatrix(data.data, filterMatrix(filters))
        ctx.putImageData(data, 0, 0)
      }
      if (hasText(text)) {
        const t = textLayout(text, size)
        ctx.font = t.font
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        // a thin dark edge, so white words survive a white background
        ctx.lineWidth = Math.max(1, Math.round(t.fontPx / 12))
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'
        ctx.strokeText(text.text, t.x, t.y)
        ctx.fillStyle = text.colour
        ctx.fillText(text.text, t.x, t.y)
      }

      const { mime, quality } = outputType(slide.url)
      const blob = await new Promise<Blob | null>(resolve => el.toBlob(resolve, mime, quality))
      if (!blob) throw new Error('The edited picture could not be written out')

      const name = derivedName(slide.name, plan.kind === 'crop' ? 'cropped' : 'edited')
      const file = new File([blob], name, { type: mime })
      const { done } = uploadFiles([file], {
        group: `image-edit:${target.itemId}`, purpose: 'social',
      })
      const landed = await done
      const url = landed[0]?.url
      if (!url) throw new Error('The edited picture did not finish uploading')

      const res = plan.kind === 'crop'
        ? await fetch('/api/social/schedule/derive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: target.itemId,
            version_number: target.versionNumber,
            from_url: slide.url,
            to_url: url,
            kind: 'crop',
          }),
        })
        : await fetch('/api/social/schedule/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: target.itemId,
            post_id: target.postId,
            files: target.slides.map((s, i) =>
              (i === target.index ? { ...s, url, name } : s)),
          }),
        })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProblem(friendlyError(
          String(json?.problems?.[0] ?? json?.error ?? ''), 'Schedule'))
        return
      }
      onSaved(String(json?.message ?? 'Saved.'))
    } catch (e) {
      setProblem(e instanceof Error && e.message
        ? securityWords(e.message)
        : 'That picture could not be saved. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  if (loadFailed) {
    return (
      <p className="rounded-inner border border-border bg-paper px-3 py-6 text-center text-[13px] text-muted-foreground">
        That picture would not open for editing. It may have been moved. Try
        opening it from the piece itself.
      </p>
    )
  }

  if (!image || !natural) {
    return (
      <div className="flex h-[280px] items-center justify-center gap-2 rounded-inner border border-border text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
        Opening the picture…
      </div>
    )
  }

  const cropDisplay = {
    left: crop.x * scale,
    top: crop.y * scale,
    width: crop.width * scale,
    height: crop.height * scale,
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* what is being changed */}
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          ['crop', 'Crop', CropIcon],
          ['filters', 'Filters', SlidersHorizontal],
          ['text', 'Text', TypeIcon],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold',
              tab === key ? 'bg-foreground text-background' : 'bg-surface hover:bg-muted',
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Undo"
            disabled={past.length === 0}
            onClick={undo}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Redo"
            disabled={future.length === 0}
            onClick={redo}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
          >
            <Redo2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      </div>

      {/* the picture */}
      <div ref={frame} className="flex justify-center rounded-inner bg-foreground/[0.06] p-2">
        <div
          className="relative touch-none select-none"
          style={{ width: box.width, height: box.height }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <canvas ref={canvas} className="block h-full w-full rounded-[4px]" />

          {/* everything outside the crop, dimmed */}
          {tab === 'crop' && (
            <>
              <div
                className="pointer-events-none absolute inset-0 rounded-[4px] bg-ink/45"
                style={{
                  clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${cropDisplay.left}px ${cropDisplay.top}px, ${cropDisplay.left}px ${cropDisplay.top + cropDisplay.height}px, ${cropDisplay.left + cropDisplay.width}px ${cropDisplay.top + cropDisplay.height}px, ${cropDisplay.left + cropDisplay.width}px ${cropDisplay.top}px, ${cropDisplay.left}px ${cropDisplay.top}px)`,
                }}
              />
              <div
                role="application"
                tabIndex={0}
                aria-label="Crop frame. Arrow keys move it, hold Shift to move further."
                onPointerDown={onPointerDown('move')}
                onKeyDown={onFrameKey}
                className="absolute cursor-move border-2 border-cream shadow-[0_0_0_1px_rgba(0,0,0,0.4)] outline-none focus-visible:ring-2 focus-visible:ring-cream"
                style={cropDisplay}
              >
                {CORNERS.map(({ key: corner, label }) => (
                  <button
                    key={corner}
                    type="button"
                    aria-label={`${label} corner. Arrow keys resize from here, hold Shift to resize further.`}
                    onPointerDown={onPointerDown(corner)}
                    onKeyDown={onCornerKey(corner)}
                    className={cn(
                      'absolute h-5 w-5 rounded-full border-2 border-ink bg-cream outline-none focus-visible:ring-2 focus-visible:ring-cream',
                      corner === 'nw' && '-left-2.5 -top-2.5 cursor-nwse-resize',
                      corner === 'ne' && '-right-2.5 -top-2.5 cursor-nesw-resize',
                      corner === 'sw' && '-bottom-2.5 -left-2.5 cursor-nesw-resize',
                      corner === 'se' && '-bottom-2.5 -right-2.5 cursor-nwse-resize',
                    )}
                  />
                ))}
              </div>
            </>
          )}

          {/* the one line, where it will actually land */}
          {hasText(text) && (
            <span
              role="application"
              tabIndex={0}
              aria-label={`Caption “${text.text}”. Arrow keys move it, hold Shift to move further.`}
              onPointerDown={onTextDown}
              onPointerMove={onTextMove}
              onPointerUp={() => { textDrag.current = false }}
              onKeyDown={onTextKey}
              className="absolute cursor-move whitespace-nowrap px-1 outline-none [text-shadow:0_1px_3px_rgba(0,0,0,0.55)] focus-visible:ring-2 focus-visible:ring-cream"
              style={{
                left: `${text.x * 100}%`,
                top: `${text.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                color: text.colour,
                fontSize: `${text.size / 100 * box.height}px`,
                fontWeight: 600,
                fontFamily: text.font === 'serif'
                  ? 'Georgia, "Times New Roman", serif'
                  : text.font === 'mono'
                    ? '"Courier New", monospace'
                    : '"Helvetica Neue", Arial, sans-serif',
              }}
            >
              {text.text}
            </span>
          )}
        </div>
      </div>

      {/* the controls for whichever tab is open */}
      <div className="min-h-[112px]">
        {tab === 'crop' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {CROP_PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={preset === p.key}
                  title={p.hint}
                  onClick={() => {
                    remember()
                    setPreset(p.key)
                    setCrop(cropRectFor(natural, p.ratio))
                  }}
                  className={cn(
                    'min-h-11 rounded-full border border-border px-4 text-[13px] font-semibold',
                    preset === p.key ? 'bg-foreground text-background' : 'bg-surface hover:bg-muted',
                  )}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  remember()
                  setPreset('free')
                  setCrop({ x: 0, y: 0, width: natural.width, height: natural.height })
                }}
                className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
              >
                Whole picture
              </button>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Drag the frame to move it, or a corner to resize. With the keyboard,
              tab to the frame or a corner and use the arrow keys — hold Shift to
              go ten times as far.{' '}
              {out && `Saved at ${out.width} × ${out.height} pixels.`}
              {out && Math.max(crop.width, crop.height) > MAX_EXPORT_PX
                && ' The long side is brought down to keep the file sensible.'}
            </p>
          </div>
        )}

        {tab === 'filters' && (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap gap-1.5">
              {LOOKS.map(look => (
                <button
                  key={look.key}
                  type="button"
                  onClick={() => { remember(); setFilters(look.filters) }}
                  className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
                >
                  {look.label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Slider
                label="Brightness" min={0} max={200} value={filters.brightness}
                onStart={remember}
                onChange={v => setFilters(f => ({ ...f, brightness: v }))}
              />
              <Slider
                label="Contrast" min={0} max={200} value={filters.contrast}
                onStart={remember}
                onChange={v => setFilters(f => ({ ...f, contrast: v }))}
              />
              <Slider
                label="Colour" min={0} max={200} value={filters.saturation}
                onStart={remember}
                onChange={v => setFilters(f => ({ ...f, saturation: v }))}
              />
              <Slider
                label="Warmth" min={-100} max={100} value={filters.warmth}
                onStart={remember}
                onChange={v => setFilters(f => ({ ...f, warmth: v }))}
              />
            </div>
          </div>
        )}

        {tab === 'text' && (
          <div className="flex flex-col gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-muted-foreground">
                One line, on the picture
              </span>
              <input
                value={text.text}
                maxLength={80}
                onFocus={remember}
                onChange={e => setText(t => ({ ...t, text: e.target.value }))}
                placeholder="Type the line"
                className="min-h-11 w-full rounded-full border border-border bg-paper px-4 text-[14px] outline-none"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {TEXT_FONTS.map(f => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={text.font === f.key}
                  onClick={() => { remember(); setText(t => ({ ...t, font: f.key })) }}
                  className={cn(
                    'min-h-11 rounded-full border border-border px-4 text-[13px] font-semibold',
                    text.font === f.key ? 'bg-foreground text-background' : 'bg-surface hover:bg-muted',
                  )}
                >
                  {f.label}
                </button>
              ))}
              <label className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-3">
                <span className="text-[12px] font-semibold text-muted-foreground">Colour</span>
                <input
                  type="color"
                  value={text.colour}
                  onChange={e => setText(t => ({ ...t, colour: e.target.value }))}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                  aria-label="Text colour"
                />
              </label>
              <div className="min-w-[160px] flex-1">
                <Slider
                  label="Size" min={TEXT_SIZE_MIN} max={TEXT_SIZE_MAX} value={text.size}
                  onStart={remember}
                  onChange={v => setText(t => ({ ...t, size: v }))}
                />
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Drag the line on the picture to move it, or tab to it and use the
              arrow keys.
            </p>
          </div>
        )}
      </div>

      <SaveBar plan={plan} busy={busy} onSave={() => void save()} />
    </div>
  )
}

/* ── the video ─────────────────────────────────────────────────────────── */

function VideoPanel({ target, slide, busy, setBusy, setProblem, onSaved }: {
  target: ImageEditorTarget
  slide: Slide
  busy: boolean
  setBusy: (v: boolean) => void
  setProblem: (v: string | null) => void
  onSaved: (message: string) => void
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [trim, setTrim] = useState<Trim>({ start: 0, end: 0 })
  /**
   * The chosen cover, as the PICTURE ITSELF and not a timestamp.
   *
   * It used to be a time, with the still taken off the live <video> at save
   * time — so playing on after choosing (or nudging a trim slider, which
   * seeks) uploaded a different frame from the one the label promised. The
   * frame is grabbed the moment the button is pressed, which is also the
   * moment the person is looking at it.
   */
  const [cover, setCover] = useState<{ at: number; blob: Blob } | null>(null)
  const [grabbing, setGrabbing] = useState(false)

  const trimmed = duration > 0 && trimChanged(trim, duration)
  const plan = videoSaveDecision({ coverChanged: cover !== null, trimmed })

  const seek = (at: number) => {
    const el = video.current
    if (el) el.currentTime = at
  }

  /** Move the playhead and WAIT for the frame to actually be there. Drawing
   *  before `seeked` paints whatever was on screen before. */
  const seekAndWait = (el: HTMLVideoElement, at: number) => new Promise<void>(resolve => {
    if (Math.abs(el.currentTime - at) < 0.02) { resolve(); return }
    const done = () => { el.removeEventListener('seeked', done); resolve() }
    el.addEventListener('seeked', done)
    el.currentTime = at
    // a video that will not seek must not hang the button for ever
    window.setTimeout(done, 2000)
  })

  const grabCover = async () => {
    const el = video.current
    if (!el) return
    setGrabbing(true)
    setProblem(null)
    try {
      const at = clampCover(el.currentTime, trim)
      await seekAndWait(el, at)
      const width = el.videoWidth || 1080
      const height = el.videoHeight || 1920
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser could not take a still from the video')
      ctx.drawImage(el, 0, 0, width, height)
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('The cover picture could not be written out')
      setCover({ at, blob })
    } catch (e) {
      setProblem(e instanceof Error && e.message
        ? securityWords(e.message)
        : 'That frame could not be used as the cover.')
    } finally {
      setGrabbing(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      let coverUrl: string | null = null
      if (cover) {
        // the still grabbed when the button was pressed, not whatever the
        // playhead happens to be sitting on now
        const file = new File([cover.blob], derivedName(slide.name, 'cover'), { type: 'image/jpeg' })
        const { done } = uploadFiles([file], {
          group: `image-edit:${target.itemId}`, purpose: 'social',
        })
        coverUrl = (await done)[0]?.url ?? null
        if (!coverUrl) throw new Error('The cover picture did not finish uploading')
      }

      const res = await fetch('/api/social/schedule/derive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: target.itemId,
          version_number: target.versionNumber,
          from_url: slide.url,
          cover_url: coverUrl,
          trim_start: trimmed ? trim.start : null,
          trim_end: trimmed ? trim.end : null,
          kind: 'video',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProblem(friendlyError(String(json?.error ?? ''), 'Schedule'))
        return
      }
      onSaved(String(json?.message ?? 'Saved.'))
    } catch (e) {
      setProblem(e instanceof Error && e.message
        ? securityWords(e.message)
        : 'That video could not be saved. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-center rounded-inner bg-ink p-2">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={video}
          src={slide.url}
          crossOrigin="anonymous"
          controls
          onLoadedMetadata={e => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d)) {
              setDuration(d)
              setTrim(wholeClip(d))
            }
          }}
          // `crossOrigin` is what lets us take a still out of the clip, and it
          // is also what stops it playing at all if the place the file is
          // stored will not allow it. A blank black box is not an explanation,
          // so say the same thing the picture editor says.
          onError={() => setProblem(
            'This video will not open for editing here — the place it is stored will not let the page read it. Send it to us and we will switch that on.',
          )}
          className="max-h-[46vh] w-auto rounded-[4px]"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Slider
          label={`Starts at ${clockOf(trim.start)}`}
          min={0} max={Math.max(1, duration)} step={0.1} value={trim.start}
          onChange={v => {
            const next = clampTrim({ ...trim, start: v }, duration)
            setTrim(next)
            seek(next.start)
          }}
        />
        <Slider
          label={`Ends at ${clockOf(trim.end)}`}
          min={0} max={Math.max(1, duration)} step={0.1} value={trim.end}
          onChange={v => {
            const next = clampTrim({ ...trim, end: v }, duration)
            setTrim(next)
            seek(next.end)
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={grabbing || duration === 0}
          onClick={() => void grabCover()}
          className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
        >
          {grabbing && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />}
          Use this frame as the cover
        </button>
        <span className="text-[12px] text-muted-foreground">
          {cover === null
            ? 'Play to the frame you want, then press the button.'
            : `Cover taken at ${clockOf(cover.at)} — that exact frame is what will be saved.`}
        </span>
      </div>

      <p className="rounded-inner border border-border bg-paper px-3 py-2 text-[12px] text-muted-foreground">
        We do not re-cut the video here — re-encoding it in a browser would hand
        the client a worse copy of their own footage. The marks are saved with
        the post so whoever cuts it knows where it starts and ends.
      </p>

      <SaveBar plan={plan} busy={busy} onSave={() => void save()} />
    </div>
  )
}

/* ── shared bits ───────────────────────────────────────────────────────── */

function SaveBar({ plan, busy, onSave }: {
  plan: { label: string; notice: string; disabled: boolean }
  busy: boolean
  onSave: () => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {/* the sentence comes FIRST: what the button is about to do to the
          client's approval has to be readable before the button is */}
      <p className="text-[12px] text-muted-foreground">{plan.notice}</p>
      <button
        type="button"
        disabled={plan.disabled || busy}
        onClick={onSave}
        className="flex min-h-11 items-center justify-center gap-2 self-end rounded-full bg-foreground px-5 text-[13px] font-semibold text-background disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />}
        {busy ? 'Saving…' : plan.label}
      </button>
    </div>
  )
}

function Slider({ label, min, max, value, step = 1, onChange, onStart }: {
  label: string
  min: number
  max: number
  value: number
  step?: number
  onChange: (v: number) => void
  onStart?: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        // a slider moved with the arrow keys has to be undoable as well: the
        // undo step used to be pushed on pointer-down only, so keyboard
        // changes silently could not be taken back
        onKeyDown={e => {
          if (/^(Arrow|Page)|^(Home|End)$/.test(e.key)) onStart?.()
        }}
        onChange={e => onChange(Number(e.target.value))}
        className="h-11 w-full cursor-pointer accent-foreground"
      />
    </label>
  )
}

/**
 * The browser's own words for a picture it will not let us read back.
 *
 * It says "Tainted canvases may not be exported", which means nothing to
 * anybody. It happens when the file server does not allow the page to read
 * the pixels, and there is nothing a scheduler can do about it — so the
 * message says who can.
 */
function securityWords(message: string): string {
  return /taint|SecurityError|cross-origin/i.test(message)
    ? 'This picture cannot be edited here — the place it is stored will not let the page read it. Send it to us and we will switch that on.'
    : friendlyError(message, 'Schedule')
}
