'use client'

import { useEffect, useRef } from 'react'

/**
 * Two photographic hands rendered as live ASCII art on canvas, reaching in from
 * the left and right edges of the hero. On mount they slide in from off-screen;
 * moving the cursor drifts them (parallax) and "ignites" small clusters of
 * characters under the pointer; ambient sparkle clusters fire on their own so
 * the hands feel alive untouched. The hand emerges from a faint dot-matrix
 * field, and each character's brightness follows the photo's shading.
 *
 * Adapted from the CodeGrid / Luke Baffait animated-footer effect, recoloured
 * for the blue hero and rewritten without GSAP/Lenis (plain rAF). The full
 * ASCII layer is pre-rendered once to an offscreen canvas; each frame only
 * composites it and repaints the handful of currently-lit cells.
 */

const ASCII_CHARS = '........:::=+xX#0369'
const FONT_SIZE = 18
const CELL_SIZE = 20
const ASCII_COLUMNS = 100

const CHAR_RGB = '215, 230, 255' // icy white
const CHAR_ALPHA_MIN = 0.38 // darkest photo tone → dimmest char
const CHAR_ALPHA_MAX = 1 // brightest → full

const HOVER_COLOR = '#ffffff'
const HOVER_CHAR_COLOR = '#0a3299'
const SPARKLE_COLOR = '#ffffff'

const HOVER_RADIUS = 8
const CLUSTER_SIZE = 10
const HIGHLIGHT_LIFETIME = 300
const SPARKLE_LIFETIME = 500
const SPARKLE_MIN_GAP = 140 // ms between ambient sparkle bursts
const SPARKLE_MAX_GAP = 420

const PARALLAX_STRENGTH = 20
const PARALLAX_EASE = 0.05

const REVEAL_DELAY = 500 // ms — lets the hero bg/content fade start first
const REVEAL_DURATION = 1400 // ms

// photo tones at least this dark count as "background" → faint dot instead of
// a shaded character
const backgroundCharIndex = ASCII_CHARS.lastIndexOf('.')

type Cell = {
  col: number
  row: number
  char: string
  isBg: boolean
  highlightEndTime: number
  sparkleEndTime: number
}

type Hand = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  staticLayer: HTMLCanvasElement
  cells: Map<string, Cell>
  cellList: Cell[] // hand-silhouette cells only (interaction targets)
  litCells: Cell[] // currently highlighted/sparkling, pruned as they expire
  rows: number
  baselineOffset: number
  nextSparkleAt: number
}

const buildCells = (image: HTMLImageElement) => {
  const rows = Math.round(ASCII_COLUMNS / (image.naturalWidth / image.naturalHeight))

  const sample = document.createElement('canvas')
  sample.width = ASCII_COLUMNS
  sample.height = rows
  const sctx = sample.getContext('2d')!
  // white backing so transparent pixels read as background, not black
  sctx.fillStyle = '#fff'
  sctx.fillRect(0, 0, ASCII_COLUMNS, rows)
  sctx.drawImage(image, 0, 0, ASCII_COLUMNS, rows)
  const pixels = sctx.getImageData(0, 0, ASCII_COLUMNS, rows).data

  const cells = new Map<string, Cell>()
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < ASCII_COLUMNS; col++) {
      const o = (row * ASCII_COLUMNS + col) * 4
      const brightness =
        (pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114) / 255
      const charIndex = Math.min(
        ASCII_CHARS.length - 1,
        Math.floor((1 - brightness) * ASCII_CHARS.length),
      )
      const isBg = charIndex <= backgroundCharIndex
      cells.set(`${col},${row}`, {
        col,
        row,
        char: isBg ? '.' : ASCII_CHARS[charIndex],
        isBg,
        highlightEndTime: 0,
        sparkleEndTime: 0,
      })
    }
  }
  return { rows, cells }
}

/** Character alpha follows photo density so the hand keeps its shading. */
const cellAlpha = (char: string) => {
  const idx = ASCII_CHARS.indexOf(char)
  const t = (idx - backgroundCharIndex) / (ASCII_CHARS.length - 1 - backgroundCharIndex)
  return CHAR_ALPHA_MIN + (CHAR_ALPHA_MAX - CHAR_ALPHA_MIN) * t
}

const igniteCluster = (
  hand: Hand,
  startCell: Cell,
  kind: 'highlight' | 'sparkle',
  size: number,
) => {
  const now = Date.now()
  const lifetime = kind === 'highlight' ? HIGHLIGHT_LIFETIME : SPARKLE_LIFETIME
  const setEnd = (cell: Cell, t: number) => {
    if (kind === 'highlight') cell.highlightEndTime = t
    else cell.sparkleEndTime = t
    if (!hand.litCells.includes(cell)) hand.litCells.push(cell)
  }
  setEnd(startCell, now + lifetime)

  const steps = Math.floor(Math.random() * size) + 1
  const walked = [startCell]
  let current = startCell

  for (let step = 0; step < steps; step++) {
    const neighbours: Cell[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const neighbour = hand.cells.get(`${current.col + dx},${current.row + dy}`)
        if (neighbour && !neighbour.isBg && !walked.includes(neighbour))
          neighbours.push(neighbour)
      }
    }
    if (neighbours.length === 0) break
    const next = neighbours[Math.floor(Math.random() * neighbours.length)]
    setEnd(next, now + lifetime + step * 10)
    walked.push(next)
    current = next
  }
}

export default function AsciiHands() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches

    const wrappers = [...root.querySelectorAll<HTMLDivElement>('.ascii-hand-wrap')]
    const hands: Hand[] = []
    let disposed = false

    const setupHand = (image: HTMLImageElement) => {
      const { rows, cells } = buildCells(image)
      const width = ASCII_COLUMNS * CELL_SIZE
      const height = rows * CELL_SIZE

      const configureCtx = (c: HTMLCanvasElement) => {
        c.width = width
        c.height = height
        const ctx = c.getContext('2d')!
        ctx.font = `${FONT_SIZE}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        return ctx
      }

      const canvas = image.parentElement!.querySelector('canvas')!
      const ctx = configureCtx(canvas)

      const metrics = ctx.measureText('X')
      const glyphHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
      const baselineOffset =
        CELL_SIZE / 2 + glyphHeight / 2 - metrics.actualBoundingBoxDescent

      // full ASCII field drawn once — dot matrix + shaded hand
      const staticLayer = document.createElement('canvas')
      const sctx = configureCtx(staticLayer)
      const cellList: Cell[] = []
      for (const cell of cells.values()) {
        if (cell.isBg) continue
        sctx.fillStyle = `rgba(${CHAR_RGB}, ${cellAlpha(cell.char)})`
        sctx.fillText(
          cell.char,
          cell.col * CELL_SIZE + CELL_SIZE / 2,
          cell.row * CELL_SIZE + baselineOffset,
        )
        cellList.push(cell)
      }

      ctx.drawImage(staticLayer, 0, 0)
      hands.push({
        canvas,
        ctx,
        staticLayer,
        cells,
        cellList,
        litCells: [],
        rows,
        baselineOffset,
        nextSparkleAt: performance.now() + REVEAL_DELAY + Math.random() * 800,
      })
    }

    root.querySelectorAll<HTMLImageElement>('img.ascii-hand').forEach((image) => {
      const start = () => { if (!disposed) setupHand(image) }
      if (image.complete && image.naturalWidth) start()
      else image.addEventListener('load', start, { once: true })
    })

    const drawHand = (hand: Hand) => {
      const { ctx, baselineOffset } = hand
      const now = Date.now()
      ctx.clearRect(0, 0, hand.canvas.width, hand.canvas.height)
      ctx.drawImage(hand.staticLayer, 0, 0)

      hand.litCells = hand.litCells.filter(
        (c) => c.highlightEndTime > now || c.sparkleEndTime > now,
      )
      for (const cell of hand.litCells) {
        const x = cell.col * CELL_SIZE
        const y = cell.row * CELL_SIZE
        if (cell.highlightEndTime > now) {
          ctx.fillStyle = HOVER_COLOR
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
          ctx.fillStyle = HOVER_CHAR_COLOR
        } else {
          ctx.fillStyle = SPARKLE_COLOR
        }
        ctx.fillText(cell.char, x + CELL_SIZE / 2, y + baselineOffset)
      }
      return hand.litCells.length > 0
    }

    // ── slide-in reveal + cursor parallax, one transform per wrapper ──
    const parallaxScale = 1 + (PARALLAX_STRENGTH * 2) / 200
    const pointer = { x: 0, y: 0 }
    const drift = { x: 0, y: 0 }
    const reveal = { left: -125, right: 125 }
    const revealStart = performance.now() + (reduceMotion ? 0 : REVEAL_DELAY)

    let repaintNeeded = false

    const onMove = (event: MouseEvent) => {
      const rect = root.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * PARALLAX_STRENGTH * 2
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * PARALLAX_STRENGTH * 2

      for (const hand of hands) {
        const handRect = hand.canvas.getBoundingClientRect()
        if (
          event.clientX < handRect.left - 40 || event.clientX > handRect.right + 40 ||
          event.clientY < handRect.top - 40 || event.clientY > handRect.bottom + 40
        ) continue

        const mouseCol = ((event.clientX - handRect.left) / handRect.width) * ASCII_COLUMNS
        const mouseRow = ((event.clientY - handRect.top) / handRect.height) * hand.rows

        let closest: Cell | null = null
        let closestDist = Infinity
        for (const cell of hand.cellList) {
          const dx = mouseCol - cell.col
          const dy = mouseRow - cell.row
          const dist = dx * dx + dy * dy
          if (dist < closestDist) {
            closestDist = dist
            closest = cell
          }
        }
        if (closest && closestDist <= HOVER_RADIUS * HOVER_RADIUS) {
          igniteCluster(hand, closest, 'highlight', CLUSTER_SIZE)
          repaintNeeded = true
        }
      }
    }

    let raf = 0
    const tick = () => {
      const now = performance.now()

      if (!reduceMotion) {
        const t = Math.min(Math.max((now - revealStart) / REVEAL_DURATION, 0), 1)
        const eased = 1 - Math.pow(1 - t, 3) // power3.out
        reveal.left = -125 * (1 - eased)
        reveal.right = 125 * (1 - eased)
        drift.x += (pointer.x - drift.x) * PARALLAX_EASE
        drift.y += (pointer.y - drift.y) * PARALLAX_EASE
      } else {
        reveal.left = 0
        reveal.right = 0
      }

      wrappers.forEach((wrapper, i) => {
        const direction = i === 0 ? 1 : -1
        const revealX = i === 0 ? reveal.left : reveal.right
        const x = drift.x * direction
        const y = -drift.y
        wrapper.style.transform =
          `translate(calc(${x}px + ${revealX}%), ${y}px) scale(${parallaxScale})`
      })

      // ambient sparkles keep the hands alive without the cursor
      if (!reduceMotion) {
        for (const hand of hands) {
          if (now >= hand.nextSparkleAt && hand.cellList.length) {
            const cell = hand.cellList[Math.floor(Math.random() * hand.cellList.length)]
            igniteCluster(hand, cell, 'sparkle', 4)
            hand.nextSparkleAt =
              now + SPARKLE_MIN_GAP + Math.random() * (SPARKLE_MAX_GAP - SPARKLE_MIN_GAP)
            repaintNeeded = true
          }
        }
      }

      if (repaintNeeded) {
        let stillLit = false
        for (const hand of hands) {
          if (drawHand(hand)) stillLit = true
        }
        repaintNeeded = stillLit
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    if (finePointer) window.addEventListener('mousemove', onMove)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      if (finePointer) window.removeEventListener('mousemove', onMove)
    }
  }, [])

  return (
    <div ref={rootRef} className="ascii-hands" aria-hidden="true">
      <div className="ascii-hand-wrap">
        <img className="ascii-hand" src="/hands/hand-left.jpg" alt="" />
        <canvas />
      </div>
      <div className="ascii-hand-wrap">
        <img className="ascii-hand" src="/hands/hand-right.jpg" alt="" />
        <canvas />
      </div>
    </div>
  )
}
