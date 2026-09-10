'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  firstStep, nextStep, shouldRunTour, stepCount, stepNumber, tourKey,
  type Tour as TourData, type TourId,
} from '@/app/lib/tour-core'
import type { Role } from '@/app/lib/identity-core'

/**
 * THE WALKTHROUGH, drawn.
 *
 * A dark overlay with a hole cut around the thing being talked about, and a
 * small card beside it with one sentence and four buttons. The words, the
 * order and the "have they seen it" rule all live in app/lib/tour-core.ts;
 * this file only measures, points and remembers.
 *
 * Three things it refuses to get wrong:
 *
 *  1. IT NEVER POINTS AT NOTHING. A target that is not on the screen (no
 *     channels connected yet, a button that only exists on a desktop) is
 *     walked past, in both directions, and a tour with no targets at all
 *     never opens.
 *  2. IT NEVER TRAPS ANYBODY. Escape leaves, Skip leaves, and leaving counts
 *     as seen: this is help, not a gate.
 *  3. ON A PHONE THERE IS NO SPOTLIGHT. A 44px hole and a card do not both
 *     fit in 390px, so the card sits at the bottom over a plain dim screen
 *     and the words carry it.
 */

/** Where the box being pointed at is, in viewport pixels. */
type Spot = { top: number; left: number; width: number; height: number }

const PAD = 6

/** The first element carrying this `data-tour` that is actually drawn. A
 *  hidden copy (the sidebar exists twice: the rail and the phone drawer) has
 *  no box, and a box of nothing cannot be spotlighted. */
function findTarget(target: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
  return all.find(el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }) ?? null
}

function boxOf(el: HTMLElement): Spot {
  const r = el.getBoundingClientRect()
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

export default function Tour({ tour, onClose }: {
  tour: TourData
  /** the tour is over, however it ended — the caller writes down that this
   *  person has now seen it */
  onClose: () => void
}) {
  const present = useCallback((target: string) => findTarget(target) !== null, [])
  const [index, setIndex] = useState<number | null>(() => null)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [narrow, setNarrow] = useState(false)
  const started = useRef(false)
  /** the card's own height, measured after it draws, so it can be kept on
   *  screen (the owner, 10 Sep 2026: "it's coming out of the screen") */
  const card = useRef<HTMLDivElement | null>(null)
  const [cardHeight, setCardHeight] = useState(200)
  useEffect(() => {
    const el = card.current
    if (!el) return
    const h = Math.round(el.getBoundingClientRect().height)
    if (h > 0 && h !== cardHeight) setCardHeight(h)
  })

  /** the phone rule, read once and then on every resize */
  useEffect(() => {
    const read = () => setNarrow(window.innerWidth < 768)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  // open on the first step that is really there; a tour with none is no tour
  useEffect(() => {
    if (started.current) return
    started.current = true
    const first = firstStep(tour.steps, present)
    if (first === null) { onClose(); return }
    setIndex(first)
  }, [tour.steps, present, onClose])

  const step = index === null ? null : tour.steps[index] ?? null

  const go = useCallback((direction: 1 | -1) => {
    setIndex(current => {
      if (current === null) return current
      const next = nextStep(tour.steps, current, direction, present)
      if (next === null) {
        // forward past the last step is "Done"; back past the first stays put
        if (direction === 1) onClose()
        return current
      }
      return next
    })
  }, [tour.steps, present, onClose])

  /** measure the current step's element, and keep measuring while the page
   *  settles: a scroll that has not finished reports the old box */
  useEffect(() => {
    if (!step) return
    const el = findTarget(step.target)
    if (!el) { go(1); return }
    // instant: the page scrolls smoothly by default (globals.css), and a
    // spotlight measured mid-glide sits where the box WAS
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
    const measure = () => {
      const live = findTarget(step.target)
      const next = live ? boxOf(live) : null
      // only a real move re-renders: a scroll fires this dozens of times
      setSpot(prev => (prev && next && prev.top === next.top && prev.left === next.left
        && prev.width === next.width && prev.height === next.height) ? prev : next)
    }
    measure()
    const frames = [0, 60, 180, 400].map(ms => window.setTimeout(measure, ms))
    window.addEventListener('resize', measure)
    // capture: the scroller is the page, a grid or a dialog's own panel
    window.addEventListener('scroll', measure, true)
    return () => {
      for (const f of frames) window.clearTimeout(f)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step, go])

  /** Escape leaves, Enter and the right arrow move on, the left arrow goes
   *  back — keyboard first, because the mouse is already busy */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); go(1); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    // capture, so the dialog behind this does not close on the same Escape
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose])

  const total = stepCount(tour.steps, present)
  const shownNumber = index === null ? 0 : stepNumber(tour.steps, index, present)
  const last = index !== null && nextStep(tour.steps, index, 1, present) === null
  const first = index !== null && nextStep(tour.steps, index, -1, present) === null

  if (!step || index === null) return null

  /** the card: under the hole when there is room, over it when there is not,
   *  and always inside the window */
  const cardStyle: React.CSSProperties = (() => {
    if (narrow || !spot) return {}
    const width = 320
    const vh = window.innerHeight
    const vw = window.innerWidth
    const left = Math.min(
      Math.max(12, spot.left + spot.width / 2 - width / 2),
      Math.max(12, vw - width - 12),
    )
    // under the box when the whole card fits there, above it when it fits
    // there, and otherwise beside it — always clamped inside the window
    const below = spot.top + spot.height + 12
    const above = spot.top - 12 - cardHeight
    const top = below + cardHeight <= vh - 12 ? below
      : above >= 12 ? above
      : Math.min(Math.max(12, spot.top), vh - cardHeight - 12)
    const beside = !(below + cardHeight <= vh - 12) && !(above >= 12)
    const sideLeft = beside
      ? (spot.left + spot.width + 12 + width <= vw - 12 ? spot.left + spot.width + 12 : Math.max(12, spot.left - 12 - width))
      : left
    return { top: Math.max(12, top), left: sideLeft, width }
  })()

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`${tour.name}: a quick walkthrough`}
      className="pointer-events-none fixed inset-0 z-[70]"
    >
      {/* the dim. On a phone (or before the box is known) it is the whole
          screen; otherwise it is a shadow big enough to cover any screen,
          cast outward from the hole. */}
      {narrow || !spot ? (
        <div className="pointer-events-auto absolute inset-0 bg-ink/55" onClick={onClose} />
      ) : (
        <div
          aria-hidden
          className="absolute rounded-[12px] ring-2 ring-cream/70 transition-all duration-150"
          style={{
            top: spot.top, left: spot.left, width: spot.width, height: spot.height,
            boxShadow: '0 0 0 9999px rgba(20, 20, 20, 0.55)',
          }}
        />
      )}

      <div
        ref={card}
        className={cn(
          'pointer-events-auto rounded-card border border-border bg-popover p-4 shadow-xl',
          narrow || !spot
            ? 'absolute inset-x-3 bottom-3'
            : 'absolute',
        )}
        style={cardStyle}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {tour.name} · {shownNumber} of {total}
        </p>
        <p className="mt-1.5 text-[15px] font-semibold text-foreground">{step.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-3.5 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
          <div className="ml-auto flex items-center gap-2">
            {!first && (
              <button
                type="button"
                onClick={() => go(-1)}
                className="min-h-11 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted"
              >
                Back
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (last ? onClose() : go(1))}
              className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:opacity-90"
            >
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * "Has this person seen this tour?", and the once-only run.
 *
 * Remembered in this browser, keyed on the user id, wrapped in try/catch:
 * private mode has no localStorage and a walkthrough is not worth a blank
 * page. A second browser shows it once more, which is a cheap loss next to a
 * database write on the page whose whole job is to open fast.
 */
export function useTourOnce(
  tourId: TourId,
  { userId, role, ready }: { userId: string | null; role: Role | null; ready: boolean },
) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!ready || !userId || open) return
    let seen = true
    try { seen = window.localStorage.getItem(tourKey(userId, tourId)) === '1' } catch { seen = true }
    if (!shouldRunTour(role, seen)) return
    // one beat, so the page has drawn the things being pointed at
    const t = window.setTimeout(() => setOpen(true), 450)
    return () => window.clearTimeout(t)
    // `open` is deliberately out: closing the tour must not re-open it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId, role, tourId])

  const close = useCallback(() => {
    setOpen(false)
    if (!userId) return
    try { window.localStorage.setItem(tourKey(userId, tourId), '1') } catch { /* private mode */ }
  }, [userId, tourId])

  /** "Show me the tour" — from the toolbar, or the Getting started panel */
  const start = useCallback(() => setOpen(true), [])

  return { open, close, start }
}
