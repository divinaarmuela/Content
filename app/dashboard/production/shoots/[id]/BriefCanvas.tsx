'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGesture } from '@use-gesture/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  ExternalLink, ImagePlus, Link2, ListTodo, Maximize2, Minimize2, Minus, MoveUpRight,
  Plus, Scan, Smartphone, StickyNote, Trash2, Type, Undo2,
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
/** cards settle onto an 8px grid on drop, so layouts line up without effort */
const snap = (n: number) => Math.round(n / 8) * 8

/** the "add a post" menu, grouped the way people think — by platform */
const MOCKUP_MENU: { group: string; items: { pf: NonNullable<CanvasCard['platform']>; label: string; w: number }[] }[] = [
  { group: 'Instagram', items: [
    { pf: 'ig_post', label: 'Post', w: 280 }, { pf: 'ig_carousel', label: 'Carousel', w: 280 },
    { pf: 'ig_reel', label: 'Reel', w: 200 }, { pf: 'ig_story', label: 'Story', w: 200 },
  ] },
  { group: 'YouTube', items: [
    { pf: 'youtube', label: 'Video', w: 300 }, { pf: 'yt_short', label: 'Short', w: 200 },
  ] },
  { group: 'TikTok', items: [{ pf: 'tiktok', label: 'Video', w: 200 }] },
  { group: 'LinkedIn', items: [{ pf: 'linkedin', label: 'Post', w: 280 }] },
  { group: 'Facebook', items: [{ pf: 'facebook', label: 'Post', w: 280 }] },
]

/**
 * The board: a Milanote-style freeform canvas. Hand-rolled DOM cards on one
 * transformed "world" div — @use-gesture normalises wheel/pinch/pan, raw
 * pointer events drag cards. Camera lives in a ref and is painted straight
 * onto the world during gestures; React state commits on gesture end, so a
 * hundred cards pan at 60fps without a single re-render.
 */
export default function BriefCanvas({
  cards: savedCards, references, canEdit, clientName, onOp,
}: {
  cards: CanvasCard[]
  references: ReferenceMedia[]
  canEdit: boolean
  clientName?: string
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
  /** The one card allowed to be a live player.
   *
   *  One, deliberately. A board of ten embedded Reels is ten players, and the
   *  strip components in this app already learned what that costs — see
   *  VideoTile, which is a picture of a clip and never the clip. Playing one
   *  card in place is the useful half of that idea without the bill: watching
   *  a reference next to the concept beside it is the entire reason it is on
   *  the board, and a lightbox that covers the board loses the comparison. */
  const [playing, setPlaying] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [sheetCard, setSheetCard] = useState<CanvasCard | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [linkPrompt, setLinkPrompt] = useState(false)
  const [mockupMenu, setMockupMenu] = useState(false)
  /** when set, the next file upload lands INSIDE this mockup frame */
  const mockupTargetRef = useRef<string | null>(null)
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

  // undo: every persisted change records its inverse; Ctrl+Z replays them.
  // cardsRef lags one render behind setCards, which is exactly the "before"
  // state at the moment a handler calls persist() after upsertLocal()
  const cardsRef = useRef(cards)
  useEffect(() => { cardsRef.current = cards }, [cards])
  const historyRef = useRef<CanvasOp[]>([])

  /** Persist one changed card (plus the whole seed set the first time). */
  const persist = useCallback((changed: CanvasCard[], removed: string[] = [], record = true) => {
    if (record && !seedPendingRef.current) {
      const before = cardsRef.current
      const restore = new Map<string, CanvasCard>()
      const drop: string[] = []
      for (const c of changed) {
        const prev = before.find(x => x.id === c.id)
        if (prev) restore.set(prev.id, prev)
        else drop.push(c.id)
      }
      for (const id of removed) {
        // a deleted card takes its arrows with it server-side — restore those too
        for (const prev of before) {
          if (prev.id === id || (prev.kind === 'arrow' && (prev.from === id || prev.to === id))) restore.set(prev.id, prev)
        }
      }
      if (restore.size || drop.length) {
        historyRef.current = [...historyRef.current.slice(-49), {
          ...(restore.size ? { upsert: [...restore.values()] } : {}),
          ...(drop.length ? { remove: drop } : {}),
        }]
      }
    }
    const upsert = seedPendingRef.current
      ? [...cards.filter(c => !changed.some(u => u.id === c.id)), ...changed]
      : changed
    seedPendingRef.current = false
    pendingOpsRef.current += 1
    void onOp({ ...(upsert.length ? { upsert } : {}), ...(removed.length ? { remove: removed } : {}) })
      .finally(() => { pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1) })
  }, [cards, onOp])

  /** Ctrl+Z: pop the last inverse op, apply it locally, persist unrecorded. */
  const undo = useCallback(() => {
    const op = historyRef.current.pop()
    if (!op) return
    setCards(prev => {
      const ups = op.upsert ?? []
      const gone = new Set([...(op.remove ?? []), ...ups.map(u => u.id)])
      return [...prev.filter(c => !gone.has(c.id)), ...ups]
    })
    setSelected(null)
    pendingOpsRef.current += 1
    void onOp(op).finally(() => { pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1) })
  }, [onOp])

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
    // measured width, not stored: a label shrink-wraps its text and ignores
    // c.w entirely, so arrows anchored on c.w/2 floated off resized labels
    const w = el?.offsetWidth || c.w
    return { cx: (liveX ?? c.x) + w / 2, cy: (liveY ?? c.y) + h / 2 }
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
        // background drag pans; card drags are handled on the cards themselves,
        // and toolbar buttons are UI, not background
        if ((target as HTMLElement).closest?.('[data-card], button, input, textarea, a')) return
        if (event.type.startsWith('pointer')) {
          camRef.current.x += dx
          camRef.current.y += dy
          paint()
        }
      },
      onDragEnd: ({ target }) => {
        // a press on a toolbar button registers here as a zero-length "drag" —
        // deselecting unmounted the mini toolbar between pointerup and click,
        // so the browser never fired the click and "Add image" did nothing
        if ((target as HTMLElement).closest?.('[data-card], button, input, textarea, a')) return
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
  const dragState = useRef<{
    id: string; startX: number; startY: number; ox: number; oy: number
    moved: boolean; el: HTMLElement | null
    /** measured once at pointerdown — reading it per move forced a reflow */
    half: { w: number; h: number }
    /** the arrow endpoints this card owns, resolved once at pointerdown */
    ends: { line: SVGLineElement; end: 'from' | 'to' }[]
    raf: number; nx: number; ny: number
  } | null>(null)
  /* ── corner resize: width only — height follows content ── */
  const resizeState = useRef<{
    id: string; startX: number; ow: number; live: number
    el: HTMLElement | null; raf: number
  } | null>(null)
  /* ── Milanote-style line drag: pull from a card's dot onto another card ── */
  const lineDrag = useRef<{ from: string } | null>(null)
  const draftLineRef = useRef<SVGLineElement>(null)

  const toWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect()
    const cam = camRef.current
    return { x: (clientX - rect.left - cam.x) / cam.s, y: (clientY - rect.top - cam.y) / cam.s }
  }

  const connectCards = (from: string, to: string) => {
    if (from === to) return
    const arrow: CanvasCard = { id: mint(), kind: 'arrow', x: 0, y: 0, w: 240, z: 0, from, to }
    upsertLocal(arrow)
    persist([arrow])
    setSelected(arrow.id)
  }

  const onCardPointerDown = (e: React.PointerEvent, card: CanvasCard) => {
    if (viewOnly || editing === card.id) return
    if (e.button !== 0) return
    e.stopPropagation()
    const el = (e.currentTarget as HTMLElement)
    // EVERYTHING the drag loop needs is measured and looked up ONCE, here.
    // Doing it per pointermove (a DOM query + offsetWidth/offsetHeight, which
    // force synchronous layout) was the board's lag: pointer events outrun
    // frames, so every move paid for a reflow the browser had to redo.
    const half = { w: (el.offsetWidth || card.w) / 2, h: el.offsetHeight / 2 || 50 }
    const ends: { line: SVGLineElement; end: 'from' | 'to' }[] = []
    for (const c of cards) {
      if (c.kind !== 'arrow' || (c.from !== card.id && c.to !== card.id)) continue
      const g = viewportRef.current?.querySelector(`[data-arrow="${c.id}"]`)
      if (!g) continue
      for (const line of Array.from(g.querySelectorAll('line'))) {
        if (c.from === card.id) ends.push({ line, end: 'from' })
        if (c.to === card.id) ends.push({ line, end: 'to' })
      }
    }
    dragState.current = {
      id: card.id, startX: e.clientX, startY: e.clientY,
      ox: card.x, oy: card.y, moved: false, el, half, ends, raf: 0, nx: card.x, ny: card.y,
    }
    el.setPointerCapture(e.pointerId)
  }

  /** One visual update per FRAME, from whatever the latest pointer position
   *  was — a high-rate mouse can fire several moves between two frames. */
  const paintDrag = () => {
    const d = dragState.current
    if (!d) return
    d.raf = 0
    if (d.el) d.el.style.transform = `translate(${d.nx}px, ${d.ny}px)`
    const cx = d.nx + d.half.w
    const cy = d.ny + d.half.h
    for (const { line, end } of d.ends) {
      if (end === 'from') { line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy)) }
      else { line.setAttribute('x2', String(cx)); line.setAttribute('y2', String(cy)) }
    }
  }

  // A drag moves the card by writing transform straight to the DOM, but React
  // owns that same inline style and re-applies the card's SAVED position on
  // any re-render — a parent poll, a realtime ping, a camera commit. That is
  // the card "running away from the cursor": it snapped home every render and
  // the next frame dragged it back. Re-assert the live drag after each commit.
  useLayoutEffect(() => {
    const d = dragState.current
    if (!d?.moved || !d.el) return
    d.el.style.transform = `translate(${d.nx}px, ${d.ny}px)`
    d.el.style.zIndex = '9999'
    const r = resizeState.current
    if (r?.el) r.el.style.width = `${r.live}px`
  })

  const onCardPointerMove = (e: React.PointerEvent, card: CanvasCard) => {
    const d = dragState.current
    if (!d || d.id !== card.id) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      interactingRef.current = true
      // bump to front visually — committing z through React here would
      // re-render every card at the exact moment the drag begins
      if (d.el) { d.el.style.willChange = 'transform'; d.el.style.zIndex = '9999' }
    }
    const s = camRef.current.s
    d.nx = d.ox + dx / s
    d.ny = d.oy + dy / s
    if (!d.raf) d.raf = requestAnimationFrame(paintDrag)
  }

  /** Let go of a drag WITHOUT saving — the inline styles are cleared so the
   *  card falls back to its committed position on the next paint. */
  const abortDrag = useCallback(() => {
    const d = dragState.current
    if (d) {
      dragState.current = null
      if (d.raf) cancelAnimationFrame(d.raf)
      if (d.el) { d.el.style.willChange = ''; d.el.style.zIndex = ''; d.el.style.transform = `translate(${d.ox}px, ${d.oy}px)` }
    }
    const r = resizeState.current
    if (r) {
      resizeState.current = null
      if (r.raf) cancelAnimationFrame(r.raf)
      if (r.el) r.el.style.width = `${r.ow}px`
    }
    if (d || r) { interactingRef.current = false; forceRender(n => n + 1) }
  }, [])

  // A drag that never gets its pointerup — the browser taking over the
  // gesture, a lost pointer capture, the tab going away mid-move — used to
  // leave the card pinned to the abandoned position on every later render.
  // Anything that ends a pointer anywhere ends the drag here too.
  useEffect(() => {
    const onCancel = () => abortDrag()
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    return () => {
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
    }
  }, [abortDrag])

  const onCardPointerUp = (e: React.PointerEvent, card: CanvasCard) => {
    const d = dragState.current
    if (!d || d.id !== card.id) return
    dragState.current = null
    if (d.raf) cancelAnimationFrame(d.raf)
    if (d.el) { d.el.style.willChange = ''; d.el.style.zIndex = '' }
    interactingRef.current = false
    if (!d.moved) { setSelected(card.id); return }
    const s = camRef.current.s
    const next: CanvasCard = {
      ...card,
      x: snap(d.ox + (e.clientX - d.startX) / s),
      y: snap(d.oy + (e.clientY - d.startY) / s),
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
    if (card.kind === 'link' && card.url) void resolveLink(card.id, card.url)
  }

  /**
   * Ask what is at the end of a link, and put it on the card.
   *
   * Fire-and-forget on purpose: the card exists and is usable the instant it
   * is dropped, and the picture arrives a moment later or never. A link whose
   * provider tells servers nothing — Instagram and Facebook both refuse —
   * simply stays the chip it was, and the card says to drop an image on it
   * for a cover. Never blocks, never throws, never leaves a spinner behind.
   */
  const resolveLink = async (id: string, url: string) => {
    try {
      const res = await fetch('/api/link-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) return
      const { preview, provider } = await res.json() as {
        preview: Partial<CanvasCard> | null; provider?: string | null
      }
      // a provider with no preview is still worth knowing — it is what turns
      // the chip's second line into an instruction instead of a hostname
      const patch = preview ?? (provider ? { provider } : null)
      if (!patch) return
      // the card may have been moved, edited or deleted while we were away
      const live = cardsRef.current.find(c => c.id === id)
      if (!live) return
      const merged = { ...live, ...patch }
      upsertLocal(merged)
      persist([merged])
    } catch { /* a preview is a bonus; its failure is not the user's problem */ }
  }

  const addImages = async (files: FileList) => {
    // an upload aimed at a mockup frame fills THAT frame, not the canvas
    const target = mockupTargetRef.current
    mockupTargetRef.current = null
    if (target) {
      const card = cards.find(c => c.id === target)
      if (card && files.length > 0) {
        try {
          if (card.platform === 'ig_carousel') {
            // every selected file becomes a slide, appended in order
            const uploaded: string[] = []
            for (const file of Array.from(files).slice(0, 10)) {
              const { url } = await uploadMedia(file, { purpose: 'production' })
              uploaded.push(url)
            }
            const urls = [...(card.urls ?? (card.url ? [card.url] : [])), ...uploaded].slice(0, 10)
            const next = { ...card, url: urls[0], urls }
            upsertLocal(next); persist([next])
          } else {
            const { url } = await uploadMedia(files[0], { purpose: 'production' })
            const next = { ...card, url }
            upsertLocal(next); persist([next])
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Upload failed')
        } finally {
          if (fileRef.current) fileRef.current.value = ''
        }
        return
      }
    }
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
    const trimmed = text.slice(0, card.kind === 'label' ? 120 : card.kind === 'mockup' ? 500 : 4000)
    if (trimmed === (card.text ?? '')) return
    const next = { ...card, text: trimmed }
    upsertLocal(next)
    persist([next])
  }

  /**
   * Per-card callbacks that keep their identity between renders.
   *
   * CanvasCardView is React.memo'd, but inline `onCommitText={t => …}` props
   * minted a new function every render — so the memo never held and all two
   * hundred cards re-rendered whenever anything moved. These close over the
   * card ID only and read the live handlers from a ref, so they are created
   * once per card and stay referentially equal.
   */
  const liveRef = useRef({ cards, commitText, upsertLocal, persist })
  liveRef.current = { cards, commitText, upsertLocal, persist }
  const cbCache = useRef(new Map<string, {
    onCommitText: (text: string) => void
    onUpdate: (next: CanvasCard) => void
  }>())
  const cardCallbacks = (id: string) => {
    let entry = cbCache.current.get(id)
    if (!entry) {
      entry = {
        onCommitText: (text: string) => {
          const c = liveRef.current.cards.find(x => x.id === id)
          if (c) liveRef.current.commitText(c, text)
        },
        onUpdate: (next: CanvasCard) => {
          liveRef.current.upsertLocal(next)
          liveRef.current.persist([next])
        },
      }
      cbCache.current.set(id, entry)
    }
    return entry
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
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault(); undo(); return
      }
      const card = cards.find(c => c.id === selected)
      if (e.key.toLowerCase() === 'n') { addCard({ kind: 'note', text: '', color: 'yellow' }); return }
      if (e.key.toLowerCase() === 'f') { setFullscreen(v => !v); return }
      if (e.key === '1') { fitToCards(); return }
      if (e.key === '+' || e.key === '=') { zoomBy(1.2); return }
      if (e.key === '-') { zoomBy(1 / 1.2); return }
      if (!card) return
      if (e.key === 'Delete' || e.key === 'Backspace') { removeCard(card); return }
      if (e.key === 'Enter' || e.key === 'F2') {
        if (card.kind === 'note' || card.kind === 'label' || card.kind === 'mockup') setEditing(card.id)
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
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-foreground/[0.04]' : 'relative'}>
      {fullscreen && (
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <span className="text-body-15 font-semibold">Board</span>
          <span className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">Esc to exit</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setFullscreen(false)}>
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        ref={viewportRef}
        className={`relative overflow-hidden rounded-card border border-border bg-foreground/[0.04] ${
          fullscreen ? 'flex-1 rounded-none border-0' : coarse ? 'h-[70vh]' : 'h-[60vh] min-h-[420px]'
        }`}
        style={{
          touchAction: 'none',
          overscrollBehavior: 'contain',
          backgroundImage: 'radial-gradient(circle, rgba(113,113,122,0.25) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        // a click on bare canvas puts the player back to a still, so the board
        // never carries a running video somebody has walked away from
        onPointerDown={e => {
          if (e.target === viewportRef.current || e.target === worldRef.current) {
            setSelected(null)
            setPlaying(null)
          }
        }}
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
          {/* maxWidth must be inline: the preflight's svg{max-width:100%} against this
              0-width parent collapses the svg to 0px, and Chrome skips painting
              zero-width svgs entirely — every arrow drew invisibly until this */}
          <svg className="absolute left-0 top-0" width={1} height={1}
            style={{ overflow: 'visible', maxWidth: 'none' }} aria-hidden>
            <defs>
              {/* open chevron, not a filled triangle — reads finer at any zoom */}
              <marker id="brief-arrowhead" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M2,1.5 L8.5,5 L2,8.5" fill="none" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round"
                  className="stroke-muted-foreground" />
              </marker>
              <marker id="brief-arrowhead-sel" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M2,1.5 L8.5,5 L2,8.5" fill="none" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-blue" />
              </marker>
            </defs>
            {/* the line being dragged out — driven by raw DOM, no re-renders */}
            <line ref={draftLineRef} x1={0} y1={0} x2={0} y2={0} visibility="hidden"
              className="stroke-accent-blue" strokeWidth={1.5} strokeDasharray="4 3"
              strokeLinecap="round" markerEnd="url(#brief-arrowhead-sel)"
              style={{ pointerEvents: 'none' }} />
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
                    className={isSel ? 'stroke-accent-blue' : 'stroke-muted-foreground'}
                    strokeWidth={isSel ? 1.75 : 1.25}
                    strokeLinecap="round"
                    markerEnd={isSel ? 'url(#brief-arrowhead-sel)' : 'url(#brief-arrowhead)'}
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
                selected === card.id ? 'rounded-inner ring-2 ring-accent-blue/25 ring-offset-2 ring-offset-background' : ''
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
                  connectCards(connectFrom, card.id)
                  setConnectFrom(null)
                  return
                }
                if (card.kind === 'link' && (e.ctrlKey || e.metaKey) && card.url) window.open(card.url, '_blank')
                setSelected(card.id)
              }}
              onDoubleClick={e => {
                e.stopPropagation()
                if (!viewOnly && (card.kind === 'note' || card.kind === 'label' || card.kind === 'mockup')) {
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
                clientName={clientName}
                onCommitText={cardCallbacks(card.id).onCommitText}
                onUpdate={viewOnly ? undefined : cardCallbacks(card.id).onUpdate}
                playing={playing === card.id}
                onPlay={() => setPlaying(card.id)}
              />
              {selected === card.id && !viewOnly && !editing && card.kind !== 'arrow' && (
                <div
                  className="absolute -right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-accent-blue/25 bg-surface shadow"
                  title="Drag onto another card to connect"
                  onPointerDown={e => {
                    e.stopPropagation()
                    interactingRef.current = true
                    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                    lineDrag.current = { from: card.id }
                    const { cx, cy } = centreOf(card)
                    const line = draftLineRef.current
                    if (line) {
                      line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy))
                      line.setAttribute('x2', String(cx)); line.setAttribute('y2', String(cy))
                      line.setAttribute('visibility', 'visible')
                    }
                  }}
                  onPointerMove={e => {
                    if (!lineDrag.current || lineDrag.current.from !== card.id) return
                    const p = toWorld(e.clientX, e.clientY)
                    draftLineRef.current?.setAttribute('x2', String(p.x))
                    draftLineRef.current?.setAttribute('y2', String(p.y))
                  }}
                  onPointerUp={e => {
                    if (!lineDrag.current || lineDrag.current.from !== card.id) return
                    lineDrag.current = null
                    interactingRef.current = false
                    draftLineRef.current?.setAttribute('visibility', 'hidden')
                    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-cid]') as HTMLElement | null
                    const to = hit?.getAttribute('data-cid')
                    if (to && to !== card.id) connectCards(card.id, to)
                  }}
                />
              )}
              {selected === card.id && !viewOnly && !editing && card.kind !== 'label' && card.kind !== 'arrow' && (
                <div
                  className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-ew-resize rounded-full border-2 border-white bg-accent-blue shadow"
                  onPointerDown={e => {
                    e.stopPropagation()
                    interactingRef.current = true
                    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                    // the width lives on the card's own box (the positioned
                    // wrapper is zero-width), so grab it once to write to
                    const box = (e.currentTarget.parentElement?.firstElementChild ?? null) as HTMLElement | null
                    resizeState.current = { id: card.id, startX: e.clientX, ow: card.w, live: card.w, el: box, raf: 0 }
                  }}
                  onPointerMove={e => {
                    const r = resizeState.current
                    if (!r || r.id !== card.id) return
                    const w = Math.min(1200, Math.max(120, Math.round(r.ow + (e.clientX - r.startX) / camRef.current.s)))
                    if (w === r.live) return
                    r.live = w
                    // width straight to the DOM, one write per frame: routing
                    // it through React re-rendered every card on the board on
                    // every pixel of the drag, which is what made it crawl
                    if (!r.raf) {
                      r.raf = requestAnimationFrame(() => {
                        const cur = resizeState.current
                        if (!cur) return
                        cur.raf = 0
                        if (cur.el) cur.el.style.width = `${cur.live}px`
                      })
                    }
                  }}
                  onPointerUp={() => {
                    const r = resizeState.current
                    if (!r || r.id !== card.id) return
                    if (r.raf) cancelAnimationFrame(r.raf)
                    resizeState.current = null
                    interactingRef.current = false
                    if (r.live !== r.ow) { upsertLocal({ ...card, w: r.live }); persist([{ ...card, w: r.live }]) }
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* empty states */}
        {cards.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-body-15 text-muted-foreground">
              {viewOnly
                ? 'Nothing on the board yet.'
                : 'Your board. Drop images, paste links, or double-click anywhere to write a note.'}
            </p>
            {!viewOnly && (
              <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                N note · drag to pan · Ctrl+scroll to zoom · Ctrl+Z undo
              </p>
            )}
          </div>
        )}

        {connectFrom !== null && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-accent-blue/25 bg-tint-blue px-3 py-1 text-secondary-13 text-foreground shadow-sm">
            {connectFrom === ''
              ? 'Click the first card the arrow starts from — Esc cancels'
              : 'Now click the card it points to — Esc cancels'}
          </div>
        )}
        {coarse && (
          <span className="absolute right-3 top-2 font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
            View only on mobile
          </span>
        )}

        {/* toolbar */}
        {!viewOnly && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-inner border border-border bg-surface/90 p-1 shadow-sm backdrop-blur">
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13"
              onClick={() => addCard({ kind: 'note', text: '', color: 'yellow' })}>
              <StickyNote className="h-3.5 w-3.5" /> Note
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13"
              onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-3.5 w-3.5" /> Image
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13"
              onClick={() => { setLinkPrompt(true); setTimeout(() => linkInputRef.current?.focus(), 50) }}>
              <Link2 className="h-3.5 w-3.5" /> Link
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13"
              onClick={() => addCard({ kind: 'label', text: '' })}>
              <Type className="h-3.5 w-3.5" /> Label
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13"
              onClick={() => addCard({ kind: 'todo', w: 224, items: [{ id: mint(), text: 'New task', done: false }] })}>
              <ListTodo className="h-3.5 w-3.5" /> To-do
            </Button>
            <Button size="sm" variant={connectFrom !== null ? 'default' : 'ghost'} className="h-7 gap-1.5 px-2 text-secondary-13"
              onClick={() => setConnectFrom(v => (v === null ? '' : null))}>
              <MoveUpRight className="h-3.5 w-3.5" /> Arrow
            </Button>
            <Button size="sm" variant={mockupMenu ? 'default' : 'ghost'} className="h-7 gap-1.5 px-2 text-secondary-13"
              onClick={() => setMockupMenu(v => !v)}>
              <Smartphone className="h-3.5 w-3.5" /> Post
            </Button>
            <span className="mx-0.5 h-4 w-px bg-foreground/[0.08]" />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={undo}
              aria-label="Undo" title="Undo (Ctrl+Z)">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {mockupMenu && (
          <div className="absolute left-3 top-14 z-10 grid w-64 grid-cols-2 gap-x-2 gap-y-0.5 rounded-inner border border-border bg-surface p-2 shadow-md">
            {MOCKUP_MENU.map(({ group, items }) => (
              <div key={group} className="flex flex-col gap-0.5">
                <span className="px-2 pt-1.5 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">{group}</span>
                {items.map(({ pf, label, w }) => (
                  <button key={pf} type="button"
                    className="rounded px-2 py-1 text-left text-secondary-13 hover:bg-foreground/[0.06]"
                    onClick={() => { addCard({ kind: 'mockup', platform: pf, w }); setMockupMenu(false) }}>
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {linkPrompt && (
          <div className="absolute left-3 top-14 flex items-center gap-1.5 rounded-inner border border-border bg-surface p-2 shadow-md">
            <input ref={linkInputRef} placeholder="https://…"
              className="w-64 bg-transparent font-mono text-secondary-13 outline-none placeholder:text-muted-foreground"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value.trim()
                  if (v.startsWith('https://')) { addCard({ kind: 'link', url: v }); setLinkPrompt(false) }
                  else toast.error('Links must start with https://')
                }
                if (e.key === 'Escape') setLinkPrompt(false)
              }} />
            <Button size="sm" variant="ghost" className="h-6 px-2 text-secondary-13" onClick={() => setLinkPrompt(false)}>Cancel</Button>
          </div>
        )}

        {/* selected-card mini toolbar */}
        {selectedCard && !viewOnly && !editing && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-inner border border-border bg-surface/95 p-1 shadow-md backdrop-blur">
            {selectedCard.kind === 'note' && (
              <>
                {CANVAS_NOTE_COLORS.map(c => (
                  <button key={c} type="button" aria-label={`Colour ${c}`}
                    onClick={() => { const next = { ...selectedCard, color: c }; upsertLocal(next); persist([next]) }}
                    className={`h-5 w-5 rounded-full border ${NOTE_COLORS[c].split(' ').slice(0, 1).join(' ')} ${selectedCard.color === c ? 'ring-2 ring-accent-blue/25' : 'border-border'}`} />
                ))}
                <span className="mx-1 h-4 w-px bg-foreground/[0.08]" />
              </>
            )}
            {selectedCard.kind === 'mockup' && (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13"
                onClick={() => { mockupTargetRef.current = selectedCard.id; fileRef.current?.click() }}>
                <ImagePlus className="h-3.5 w-3.5" />
                {selectedCard.platform === 'ig_carousel'
                  ? (selectedCard.url ? 'Add slides' : 'Add images')
                  : (selectedCard.url ? 'Swap image' : 'Add image')}
              </Button>
            )}
            {selectedCard.kind !== 'arrow' && (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13"
                onClick={() => { setConnectFrom(selectedCard.id); setSelected(null) }}>
                <MoveUpRight className="h-3.5 w-3.5" /> Arrow
              </Button>
            )}
            {selectedCard.kind === 'link' && selectedCard.url && (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-secondary-13" asChild>
                <a href={selectedCard.url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-accent-red hover:text-accent-red"
              onClick={() => removeCard(selectedCard)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* zoom pill */}
        <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-inner border border-border bg-surface/90 p-1 shadow-sm backdrop-blur">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            <Minus className="h-3 w-3" />
          </Button>
          <button type="button" onClick={() => { camRef.current.s = 1; paint(); commitCamera() }}
            className="min-w-11 font-mono text-[12px] tabular-nums text-muted-foreground">
            {scalePct}%
          </button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            <Plus className="h-3 w-3" />
          </Button>
          <span className="mx-0.5 h-4 w-px bg-foreground/[0.08]" />
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

      {/* visually hidden but PRESENT — a display:none file input often refuses
          to open the OS picker on a programmatic .click(); sr-only keeps it
          clickable so the toolbar Image + mockup "Add image" both work */}
      <input ref={fileRef} type="file" multiple accept="image/*" className="sr-only"
        onChange={e => e.target.files?.length && void addImages(e.target.files)} />

      {/* mobile / read-only card viewer */}
      <Sheet open={sheetCard !== null} onOpenChange={o => !o && setSheetCard(null)}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-body-15">
              {sheetCard?.kind === 'note' ? 'Note'
                : sheetCard?.kind === 'todo' ? (sheetCard.name || 'To-do')
                : sheetCard?.name || sheetCard?.kind}
            </SheetTitle>
          </SheetHeader>
          {sheetCard?.kind === 'note' && (
            <p className="whitespace-pre-wrap p-1 text-body-15 leading-relaxed">{sheetCard.text}</p>
          )}
          {sheetCard?.kind === 'todo' && (
            <div className="flex flex-col gap-1.5 p-1">
              {(sheetCard.items ?? []).map(t => (
                <span key={t.id} className="flex items-center gap-2 text-body-15">
                  <input type="checkbox" checked={t.done} readOnly disabled className="h-4 w-4 accent-[var(--dbx-blue)]" />
                  <span className={t.done ? 'text-muted-foreground line-through' : ''}>{t.text}</span>
                </span>
              ))}
              {(sheetCard.items ?? []).length === 0 && (
                <span className="text-body-15 text-muted-foreground">Nothing to do yet.</span>
              )}
            </div>
          )}
          {sheetCard?.kind === 'image' && sheetCard.url && (
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sheetCard.url} alt={sheetCard.name ?? 'reference'} className="w-full rounded-inner" />
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
