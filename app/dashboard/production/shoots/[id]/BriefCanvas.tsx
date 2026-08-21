'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGesture } from '@use-gesture/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  ExternalLink, ImagePlus, Link2, Maximize2, Minimize2, Minus, MoveUpRight, Plus,
  Scan, StickyNote, Trash2, Type,
} from 'lucide-react'
import { uploadMedia } from '../../../uploadMedia'
import { CanvasCardView, NOTE_COLORS } from './CanvasCard'
import {
  CANVAS_NOTE_COLORS, seedCardsFromReferences,
  type CanvasCard, type ReferenceMedia,
} from '../../../../lib/batch-brief-core'

type Camera = { x: number; y: number; s: number }
export type CanvasOp = { upsert?: CanvasCard[]; remove?: string[] }

const mint = () => Math.random().toString(36).slice(2, 10)
const clampScale = (s: number) => Math.min(2, Math.max(0.25, s))

/**
 * The board: a Milanote-style freeform canvas. Hand-rolled DOM cards on one
 * transformed "world" div — @use-gesture normalises wheel/pinch/pan, raw
 * pointer events drag cards. Camera lives in a ref and is painted straight
 * onto the world during gestures; React state commits on gesture end, so a
 * hundred cards pan at 60fps without a single re-render.
 */
export default function BriefCanvas({
  cards: savedCards, references, canEdit, onOp,
}: {
  cards: CanvasCard[]
  references: ReferenceMedia[]
  canEdit: boolean
  onOp: (op: CanvasOp) => Promise<boolean>
}) {
  // seed: an empty board with existing reference images shows them laid out;
  // nothing is written until the first real user action
  const seeded = useMemo(
    () => (savedCards.length === 0 && references.length > 0 ? seedCardsFromReferences(references) : null),
    [savedCards.length, references],
  )
  const [cards, setCards] = useState<CanvasCard[]>(savedCards.length ? savedCards : seeded ?? [])
  const seedPendingRef = useRef(Boolean(seeded && savedCards.length === 0))

  const interactingRef = useRef(false)
  const pendingOpsRef = useRef(0)
  useEffect(() => {
    // realtime reloads arrive as new savedCards — apply them ONLY when
    // nothing local is ahead of the server: not during a drag or edit, not
    // while a save is in flight (a stale parent render mid-save used to snap
    // the card back to its old spot, then forward again), and never when the
    // content is already identical (parent renders mint new array identities)
    if (interactingRef.current || pendingOpsRef.current > 0) return
    if (savedCards.length === 0) return
    setCards(prev =>
      JSON.stringify(prev) === JSON.stringify(savedCards) ? prev : savedCards)
    seedPendingRef.current = false
  }, [savedCards])

  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const camRef = useRef<Camera>({ x: 0, y: 0, s: 1 })
  const [, forceRender] = useState(0)
  const [scalePct, setScalePct] = useState(100)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [sheetCard, setSheetCard] = useState<CanvasCard | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [linkPrompt, setLinkPrompt] = useState(false)
  const linkInputRef = useRef<HTMLInputElement>(null)
  /** arrow-drawing mode: the card the next click will connect FROM */
  const [connectFrom, setConnectFrom] = useState<string | null>(null)

  const readOnly = !canEdit
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  const viewOnly = readOnly || coarse

  const paint = useCallback(() => {
    const { x, y, s } = camRef.current
    if (worldRef.current) worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${s})`
    if (viewportRef.current) {
      viewportRef.current.style.backgroundPosition = `${x}px ${y}px`
      viewportRef.current.style.backgroundSize = `${24 * s}px ${24 * s}px`
    }
  }, [])

  const commitCamera = useCallback(() => {
    setScalePct(Math.round(camRef.current.s * 100))
    forceRender(n => n + 1)
  }, [])

  /** Persist one changed card (plus the whole seed set the first time). */
  const persist = useCallback((changed: CanvasCard[], removed: string[] = []) => {
    const upsert = seedPendingRef.current
      ? [...cards.filter(c => !changed.some(u => u.id === c.id)), ...changed]
      : changed
    seedPendingRef.current = false
    pendingOpsRef.current += 1
    void onOp({ ...(upsert.length ? { upsert } : {}), ...(removed.length ? { remove: removed } : {}) })
      .finally(() => { pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1) })
  }, [cards, onOp])

  const upsertLocal = useCallback((card: CanvasCard) => {
    setCards(prev => {
      const rest = prev.filter(c => c.id !== card.id)
      return [...rest, card]
    })
  }, [])

  /** A card's centre in world space — height measured from the DOM by
   *  attribute query: NO callback refs (React 19 re-runs inline refs every
   *  commit, which hard-froze this subtree). */
  const centreOf = useCallback((c: CanvasCard, liveX?: number, liveY?: number) => {
    const el = viewportRef.current?.querySelector(`[data-cid="${c.id}"]`) as HTMLElement | null
    const h = el?.offsetHeight ?? 100
    return { cx: (liveX ?? c.x) + c.w / 2, cy: (liveY ?? c.y) + h / 2 }
  }, [])

  // arrow endpoints need measured heights — nudge one re-render after the
  // first paint so lines land on card centres, not estimates
  const measuredRef = useRef(false)
  useEffect(() => {
    if (!measuredRef.current && cards.length > 0) {
      measuredRef.current = true
      const t = window.setTimeout(() => forceRender(n => n + 1), 50)
      return () => window.clearTimeout(t)
    }
  }, [cards.length])

  /* ── viewport gestures: pan (wheel / drag背景) and zoom-to-cursor ── */
  useGesture(
    {
      onWheel: ({ event, delta: [dx, dy] }) => {
        event.preventDefault()
        const cam = camRef.current
        if (event.ctrlKey || event.metaKey) {
          const rect = viewportRef.current!.getBoundingClientRect()
          const cx = event.clientX - rect.left
          const cy = event.clientY - rect.top
          const next = clampScale(cam.s * (1 - dy * 0.01))
          const wx = (cx - cam.x) / cam.s
          const wy = (cy - cam.y) / cam.s
          cam.x = cx - wx * next
          cam.y = cy - wy * next
          cam.s = next
        } else {
          cam.x -= dx
          cam.y -= dy
        }
        paint()
      },
      onWheelEnd: () => commitCamera(),
      onPinch: ({ event, origin: [ox, oy], offset: [s] }) => {
        event.preventDefault()
        const cam = camRef.current
        const rect = viewportRef.current!.getBoundingClientRect()
        const cx = ox - rect.left
        const cy = oy - rect.top
        const next = clampScale(s)
        const wx = (cx - cam.x) / cam.s
        const wy = (cy - cam.y) / cam.s
        cam.x = cx - wx * next
        cam.y = cy - wy * next
        cam.s = next
        paint()
      },
      onPinchEnd: () => commitCamera(),
      onDrag: ({ event, delta: [dx, dy], target }) => {
        // background drag pans; card drags are handled on the cards themselves
        if ((target as HTMLElement).closest?.('[data-card]')) return
        if (event.type.startsWith('pointer')) {
          camRef.current.x += dx
          camRef.current.y += dy
          paint()
        }
      },
      onDragEnd: ({ target }) => {
        if ((target as HTMLElement).closest?.('[data-card]')) return
        commitCamera()
        setSelected(null)
      },
    },
    {
      target: viewportRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: 0.25, max: 2 }, from: () => [camRef.current.s, 0] },
      drag: { pointer: { buttons: [1, 4] } },
    },
  )

  /* ── card dragging: raw pointer events, 4px threshold, rAF paint ── */
  const dragState = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; moved: boolean; el: HTMLElement | null } | null>(null)

  const onCardPointerDown = (e: React.PointerEvent, card: CanvasCard) => {
    if (viewOnly || editing === card.id) return
    if (e.button !== 0) return
    e.stopPropagation()
    const el = (e.currentTarget as HTMLElement)
    dragState.current = { id: card.id, startX: e.clientX, startY: e.clientY, ox: card.x, oy: card.y, moved: false, el }
    el.setPointerCapture(e.pointerId)
  }
  const onCardPointerMove = (e: React.PointerEvent, card: CanvasCard) => {
    const d = dragState.current
    if (!d || d.id !== card.id) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      interactingRef.current = true
      // bump to front
      const maxZ = Math.max(0, ...cards.map(c => c.z))
      upsertLocal({ ...card, z: maxZ + 1 })
      if (d.el) d.el.style.willChange = 'transform'
    }
    const s = camRef.current.s
    const nx = d.ox + dx / s
    const ny = d.oy + dy / s
    if (d.el) d.el.style.transform = `translate(${nx}px, ${ny}px)`
    // arrows follow their card through the drag, not after it
    const { cx, cy } = centreOf(card, nx, ny)
    for (const c of cards) {
      if (c.kind !== 'arrow' || (c.from !== card.id && c.to !== card.id)) continue
      const g = viewportRef.current?.querySelector(`[data-arrow="${c.id}"]`)
      if (!g) continue
      for (const line of Array.from(g.querySelectorAll('line'))) {
        if (c.from === card.id) { line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy)) }
        if (c.to === card.id) { line.setAttribute('x2', String(cx)); line.setAttribute('y2', String(cy)) }
      }
    }
  }
  const onCardPointerUp = (e: React.PointerEvent, card: CanvasCard) => {
    const d = dragState.current
    if (!d || d.id !== card.id) return
    dragState.current = null
    if (d.el) d.el.style.willChange = ''
    interactingRef.current = false
    if (!d.moved) { setSelected(card.id); return }
    const s = camRef.current.s
    const next: CanvasCard = {
      ...card,
      x: Math.round(d.ox + (e.clientX - d.startX) / s),
      y: Math.round(d.oy + (e.clientY - d.startY) / s),
      z: Math.max(0, ...cards.map(c => c.z)) + 1,
    }
    upsertLocal(next)
    persist([next])
  }

  /* ── creation ── */
  const centerWorld = () => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const cam = camRef.current
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.round((rect.width / 2 - cam.x) / cam.s - 100 + (Math.random() * 40 - 20)),
      y: Math.round((rect.height / 2 - cam.y) / cam.s - 40 + (Math.random() * 40 - 20)),
    }
  }
  const addCard = (partial: Omit<CanvasCard, 'id' | 'x' | 'y' | 'z' | 'w'> & { w?: number }) => {
    const at = centerWorld()
    const card: CanvasCard = {
      id: mint(), x: at.x, y: at.y,
      z: Math.max(0, ...cards.map(c => c.z)) + 1,
      w: partial.w ?? (partial.kind === 'note' ? 208 : 240),
      ...partial,
    }
    upsertLocal(card)
    persist([card])
    setSelected(card.id)
    if (card.kind === 'note' || card.kind === 'label') setEditing(card.id)
  }

  const addImages = async (files: FileList) => {
    try {
      for (const file of Array.from(files)) {
        const { url } = await uploadMedia(file, { purpose: 'production' })
        addCard({ kind: 'image', url, name: file.name })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeCard = (card: CanvasCard) => {
    setCards(prev => prev.filter(c => c.id !== card.id))
    setSelected(null)
    persist([], [card.id])
    toast('Card deleted', {
      action: { label: 'Undo', onClick: () => { upsertLocal(card); persist([card]) } },
      duration: 5000,
    })
  }

  const commitText = (card: CanvasCard, text: string) => {
    setEditing(null)
    interactingRef.current = false
    const trimmed = text.slice(0, card.kind === 'label' ? 120 : 4000)
    if (trimmed === (card.text ?? '')) return
    const next = { ...card, text: trimmed }
    upsertLocal(next)
    persist([next])
  }

  /* ── fit + zoom controls ── */
  const fitToCards = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect || cards.length === 0) return
    const xs = cards.map(c => c.x); const ys = cards.map(c => c.y)
    const minX = Math.min(...xs) - 64
    const minY = Math.min(...ys) - 64
    const maxX = Math.max(...cards.map(c => c.x + c.w)) + 64
    const maxY = Math.max(...ys) + 64 + 240
    const s = clampScale(Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY), 1))
    camRef.current = {
      s,
      x: (rect.width - (maxX - minX) * s) / 2 - minX * s,
      y: (rect.height - (maxY - minY) * s) / 2 - minY * s,
    }
    paint(); commitCamera()
  }, [cards, paint, commitCamera])

  const zoomBy = (factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const cam = camRef.current
    const cx = rect.width / 2; const cy = rect.height / 2
    const next = clampScale(cam.s * factor)
    const wx = (cx - cam.x) / cam.s; const wy = (cy - cam.y) / cam.s
    camRef.current = { s: next, x: cx - wx * next, y: cy - wy * next }
    paint(); commitCamera()
  }

  const fitDoneRef = useRef(false)
  useEffect(() => {
    if (!fitDoneRef.current && cards.length > 0) { fitDoneRef.current = true; fitToCards() }
    else paint()
  }, [cards.length, fitToCards, paint])

  /* ── keyboard ── */
  const nudgeTimer = useRef<number | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === 'Escape') {
        if (connectFrom) setConnectFrom(null)
        else if (editing) setEditing(null)
        else if (selected) setSelected(null)
        else if (fullscreen) setFullscreen(false)
        return
      }
      if (viewOnly) return
      const card = cards.find(c => c.id === selected)
      if (e.key.toLowerCase() === 'n') { addCard({ kind: 'note', text: '', color: 'yellow' }); return }
      if (e.key.toLowerCase() === 'f') { setFullscreen(v => !v); return }
      if (e.key === '1') { fitToCards(); return }
      if (e.key === '+' || e.key === '=') { zoomBy(1.2); return }
      if (e.key === '-') { zoomBy(1 / 1.2); return }
      if (!card) return
      if (e.key === 'Delete' || e.key === 'Backspace') { removeCard(card); return }
      if (e.key === 'Enter' || e.key === 'F2') {
        if (card.kind === 'note' || card.kind === 'label') setEditing(card.id)
        return
      }
      const step = e.shiftKey ? 1 : 10
      const move: Record<string, [number, number]> = {
        ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      }
      if (move[e.key]) {
        e.preventDefault()
        const [dx, dy] = move[e.key]
        const next = { ...card, x: card.x + dx, y: card.y + dy }
        upsertLocal(next)
        if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
        nudgeTimer.current = window.setTimeout(() => persist([next]), 500)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, selected, editing, fullscreen, viewOnly])

  const selectedCard = cards.find(c => c.id === selected) ?? null
  const ordered = useMemo(() => [...cards].sort((a, b) => a.z - b.z), [cards])

  const board = (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-zinc-50 dark:bg-zinc-950' : 'relative'}>
      {fullscreen && (
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <span className="text-sm font-semibold">Board</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">Esc to exit</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setFullscreen(false)}>
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        ref={viewportRef}
        className={`relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 ${
          fullscreen ? 'flex-1 rounded-none border-0' : coarse ? 'h-[70vh]' : 'h-[60vh] min-h-[420px]'
        }`}
        style={{
          touchAction: 'none',
          overscrollBehavior: 'contain',
          backgroundImage: 'radial-gradient(circle, rgba(113,113,122,0.25) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onPointerDown={e => { if (e.target === viewportRef.current || e.target === worldRef.current) setSelected(null) }}
        onDoubleClick={e => {
          if (viewOnly) return
          if ((e.target as HTMLElement).closest('[data-card]')) return
          const rect = viewportRef.current!.getBoundingClientRect()
          const cam = camRef.current
          const x = Math.round((e.clientX - rect.left - cam.x) / cam.s)
          const y = Math.round((e.clientY - rect.top - cam.y) / cam.s)
          const card: CanvasCard = {
            id: mint(), kind: 'note', x, y, w: 208,
            z: Math.max(0, ...cards.map(c => c.z)) + 1, text: '', color: 'yellow',
          }
          upsertLocal(card); persist([card]); setSelected(card.id); setEditing(card.id)
        }}
      >
        <div ref={worldRef} className="absolute left-0 top-0" style={{ transformOrigin: '0 0' }}>
          <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
            <defs>
              <marker id="brief-arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="fill-zinc-400 dark:fill-zinc-500" />
              </marker>
            </defs>
            {ordered.filter(c => c.kind === 'arrow').map(arrow => {
              const fromCard = cards.find(c => c.id === arrow.from)
              const toCard = cards.find(c => c.id === arrow.to)
              if (!fromCard || !toCard) return null
              const a = centreOf(fromCard)
              const b = centreOf(toCard)
              const isSel = selected === arrow.id
              return (
                <g key={arrow.id} data-arrow={arrow.id}>
                  {/* wide invisible hit line so the arrow is clickable */}
                  <line x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy}
                    stroke="transparent" strokeWidth={14}
                    style={{ pointerEvents: viewOnly ? 'none' : 'stroke', cursor: 'pointer' }}
                    onClick={e => { e.stopPropagation(); setSelected(arrow.id) }} />
                  <line x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy}
                    className={isSel ? 'stroke-blue-500' : 'stroke-zinc-400 dark:stroke-zinc-500'}
                    strokeWidth={isSel ? 2.5 : 1.5}
                    markerEnd="url(#brief-arrowhead)"
                    style={{ pointerEvents: 'none' }} />
                </g>
              )
            })}
          </svg>
          {ordered.filter(c => c.kind !== 'arrow').map(card => (
            <div
              key={card.id}
              data-card
              data-cid={card.id}
              tabIndex={0}
              aria-label={`${card.kind}${card.text ? `: ${card.text.slice(0, 40)}` : ''}`}
              className={`absolute left-0 top-0 outline-none ${viewOnly ? '' : 'cursor-grab active:cursor-grabbing'} ${
                selected === card.id ? 'rounded-lg ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-zinc-950' : ''
              }`}
              style={{ transform: `translate(${card.x}px, ${card.y}px)` }}
              onPointerDown={e => viewOnly ? undefined : onCardPointerDown(e, card)}
              onPointerMove={e => onCardPointerMove(e, card)}
              onPointerUp={e => onCardPointerUp(e, card)}
              onClick={e => {
                e.stopPropagation()
                if (viewOnly) { setSheetCard(card); return }
                if (connectFrom === '') { setConnectFrom(card.id); return }
                if (connectFrom && connectFrom !== card.id) {
                  const arrow: CanvasCard = {
                    id: mint(), kind: 'arrow', x: 0, y: 0, w: 240, z: 0,
                    from: connectFrom, to: card.id,
                  }
                  upsertLocal(arrow); persist([arrow])
                  setConnectFrom(null); setSelected(arrow.id)
                  return
                }
                if (card.kind === 'link' && (e.ctrlKey || e.metaKey) && card.url) window.open(card.url, '_blank')
                setSelected(card.id)
              }}
              onDoubleClick={e => {
                e.stopPropagation()
                if (!viewOnly && (card.kind === 'note' || card.kind === 'label')) {
                  interactingRef.current = true
                  setEditing(card.id)
                }
              }}
              onFocus={() => setSelected(card.id)}
            >
              <CanvasCardView
                card={card}
                selected={selected === card.id}
                editing={editing === card.id}
                onCommitText={text => commitText(card, text)}
              />
            </div>
          ))}
        </div>

        {/* empty states */}
        {cards.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              {viewOnly
                ? 'Nothing on the board yet.'
                : 'Your board. Drop images, paste links, or double-click anywhere to write a note.'}
            </p>
            {!viewOnly && (
              <p className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-300 dark:text-zinc-600">
                N note · drag to pan · Ctrl+scroll to zoom
              </p>
            )}
          </div>
        )}

        {connectFrom !== null && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 shadow-sm dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300">
            {connectFrom === ''
              ? 'Click the first card the arrow starts from — Esc cancels'
              : 'Now click the card it points to — Esc cancels'}
          </div>
        )}
        {coarse && (
          <span className="absolute right-3 top-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            View only on mobile
          </span>
        )}

        {/* toolbar */}
        {!viewOnly && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-lg border border-zinc-200 bg-white/90 p-1 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => addCard({ kind: 'note', text: '', color: 'yellow' })}>
              <StickyNote className="h-3.5 w-3.5" /> Note
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-3.5 w-3.5" /> Image
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => { setLinkPrompt(true); setTimeout(() => linkInputRef.current?.focus(), 50) }}>
              <Link2 className="h-3.5 w-3.5" /> Link
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => addCard({ kind: 'label', text: '' })}>
              <Type className="h-3.5 w-3.5" /> Label
            </Button>
            <Button size="sm" variant={connectFrom !== null ? 'default' : 'ghost'} className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setConnectFrom(v => (v === null ? '' : null))}>
              <MoveUpRight className="h-3.5 w-3.5" /> Arrow
            </Button>
          </div>
        )}
        {linkPrompt && (
          <div className="absolute left-3 top-14 flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white p-2 shadow-md dark:border-zinc-800 dark:bg-zinc-900">
            <input ref={linkInputRef} placeholder="https://…"
              className="w-64 bg-transparent font-mono text-xs outline-none placeholder:text-zinc-400"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value.trim()
                  if (v.startsWith('https://')) { addCard({ kind: 'link', url: v }); setLinkPrompt(false) }
                  else toast.error('Links must start with https://')
                }
                if (e.key === 'Escape') setLinkPrompt(false)
              }} />
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setLinkPrompt(false)}>Cancel</Button>
          </div>
        )}

        {/* selected-card mini toolbar */}
        {selectedCard && !viewOnly && !editing && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-zinc-200 bg-white/95 p-1 shadow-md backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
            {selectedCard.kind === 'note' && (
              <>
                {CANVAS_NOTE_COLORS.map(c => (
                  <button key={c} type="button" aria-label={`Colour ${c}`}
                    onClick={() => { const next = { ...selectedCard, color: c }; upsertLocal(next); persist([next]) }}
                    className={`h-5 w-5 rounded-full border ${NOTE_COLORS[c].split(' ').slice(0, 1).join(' ')} ${selectedCard.color === c ? 'ring-2 ring-blue-500' : 'border-zinc-300 dark:border-zinc-600'}`} />
                ))}
                <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
              </>
            )}
            {selectedCard.kind !== 'arrow' && (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => { setConnectFrom(selectedCard.id); setSelected(null) }}>
                <MoveUpRight className="h-3.5 w-3.5" /> Arrow
              </Button>
            )}
            {selectedCard.kind === 'link' && selectedCard.url && (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" asChild>
                <a href={selectedCard.url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600"
              onClick={() => removeCard(selectedCard)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* zoom pill */}
        <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white/90 p-1 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            <Minus className="h-3 w-3" />
          </Button>
          <button type="button" onClick={() => { camRef.current.s = 1; paint(); commitCamera() }}
            className="min-w-11 font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
            {scalePct}%
          </button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            <Plus className="h-3 w-3" />
          </Button>
          <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={fitToCards} aria-label="Fit to cards">
            <Scan className="h-3 w-3" />
          </Button>
          {!fullscreen && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setFullscreen(true)} aria-label="Fullscreen">
              <Maximize2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" multiple accept="image/*" className="hidden"
        onChange={e => e.target.files?.length && void addImages(e.target.files)} />

      {/* mobile / read-only card viewer */}
      <Sheet open={sheetCard !== null} onOpenChange={o => !o && setSheetCard(null)}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-sm">
              {sheetCard?.kind === 'note' ? 'Note' : sheetCard?.name || sheetCard?.kind}
            </SheetTitle>
          </SheetHeader>
          {sheetCard?.kind === 'note' && (
            <p className="whitespace-pre-wrap p-1 text-sm leading-relaxed">{sheetCard.text}</p>
          )}
          {sheetCard?.kind === 'image' && sheetCard.url && (
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sheetCard.url} alt={sheetCard.name ?? 'reference'} className="w-full rounded-lg" />
              <Button variant="outline" size="sm" asChild>
                <a href={sheetCard.url} target="_blank" rel="noreferrer noopener">Open full size</a>
              </Button>
            </div>
          )}
          {sheetCard?.kind === 'link' && sheetCard.url && (
            <Button size="sm" asChild>
              <a href={sheetCard.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-3.5 w-3.5" /> Open link
              </a>
            </Button>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )

  return board
}
