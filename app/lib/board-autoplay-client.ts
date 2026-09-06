'use client'

/**
 * Reference clips play by themselves — the browser half.
 *
 * The decisions are in `board-autoplay-core.ts`; this file only feeds them
 * facts. Two IntersectionObservers shared by every card on the page: one
 * with a margin, answering "is this card within range of the screen" (and,
 * stickily, "has it ever been"), and one with no margin answering "is it on
 * screen right now", which is what the arbiter ranks. A pan or a zoom moves
 * every card at once, often without changing which are visible, so the
 * arbiter is also re-ranked on the frame after any intersection change —
 * cheap, because it only measures the visible few.
 *
 * Everything here is module-level on purpose: the cap on simultaneous
 * players is a fact about the machine, not about one board, so two boards
 * on one page share the same three seats.
 */

import { useEffect, useState, type RefObject } from 'react'
import { AutoplayArbiter, NEAR_MARGIN_PX, centreDistance } from './board-autoplay-core'

let arbiter: AutoplayArbiter | null = null
let nearIO: IntersectionObserver | null = null
let seenIO: IntersectionObserver | null = null
/** element → card id, for the observer callbacks */
const idOf = new Map<Element, string>()
/** card id → element, for the arbiter's measure */
const elOf = new Map<string, Element>()
/** id → "you are (not) within range of the screen" */
const rangeListeners = new Map<string, (inRange: boolean) => void>()
let rerank = 0

function viewportRect() {
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }
}

function ensure(): AutoplayArbiter | null {
  if (typeof window === 'undefined' || typeof IntersectionObserver !== 'function') return null
  if (arbiter) return arbiter
  const arb = new AutoplayArbiter(id => {
    const el = elOf.get(id)
    return el ? centreDistance(el.getBoundingClientRect(), viewportRect()) : Infinity
  })
  const scheduleRerank = () => {
    if (rerank) return
    rerank = window.requestAnimationFrame(() => { rerank = 0; arb.recompute() })
  }
  nearIO = new IntersectionObserver(entries => {
    for (const e of entries) {
      const id = idOf.get(e.target)
      if (id) rangeListeners.get(id)?.(e.isIntersecting)
    }
  }, { rootMargin: `${NEAR_MARGIN_PX}px` })
  seenIO = new IntersectionObserver(entries => {
    for (const e of entries) {
      const id = idOf.get(e.target)
      if (id) arb.setVisible(id, e.isIntersecting)
    }
    scheduleRerank()
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] })
  arbiter = arb
  return arb
}

/**
 * Does this viewer want less movement? Read live, so flipping the OS setting
 * while the board is open stops the clips without a reload.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    return () => mq.removeEventListener?.('change', sync)
  }, [])
  return reduced
}

/**
 * How a card sits at the arbiter's table.
 *  - `off`:   not observed at all — costs the page nothing
 *  - `watch`: told when it is within range of the screen, never ranked
 *             (Instagram: its frame goes up and down, it never plays itself)
 *  - `play`:  watched, and competing for one of the few seats
 */
export type SlotMode = 'off' | 'watch' | 'play'

/**
 * One card's seat.
 *
 * `near` is sticky — once true it stays true; `inRange` and `chosen` are
 * live.
 */
export function useAutoplaySlot(
  id: string,
  ref: RefObject<Element | null>,
  mode: SlotMode,
): { near: boolean; inRange: boolean; chosen: boolean } {
  const [near, setNear] = useState(false)
  const [inRange, setInRange] = useState(false)
  const [chosen, setChosen] = useState(false)

  useEffect(() => {
    if (mode === 'off') { setChosen(false); setInRange(false); return }
    const el = ref.current
    const arb = ensure()
    if (!el || !arb) return
    idOf.set(el, id)
    elOf.set(id, el)
    rangeListeners.set(id, r => { setInRange(r); if (r) setNear(true) })
    nearIO?.observe(el)
    if (mode === 'play') {
      arb.add(id, setChosen)
      seenIO?.observe(el)
    }
    return () => {
      nearIO?.unobserve(el)
      seenIO?.unobserve(el)
      idOf.delete(el)
      if (elOf.get(id) === el) { elOf.delete(id); rangeListeners.delete(id) }
      if (mode === 'play') arb.remove(id)
      setChosen(false)
      setInRange(false)
    }
  }, [id, ref, mode])

  const on = mode !== 'off'
  return { near: on && near, inRange: on && inRange, chosen: mode === 'play' && chosen }
}
