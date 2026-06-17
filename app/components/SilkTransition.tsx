'use client'

import { useRef, useEffect } from 'react'

// Master switch for the scroll transition. While false, the drawer/cover/reveal
// is skipped, no .silk-canvas is rendered (so SiteNav scrolls normally), and we
// only emit diag-show/diag-hide so the horizontal-section videos still play.
const ENABLED = false

const STRIPS = 150

const seededRand = (seed: number) => {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}
const rng = seededRand(42)
const WEIGHTS = Array.from({ length: STRIPS }, () => {
  const r = rng()
  if (r < 0.18) return 0.22 + rng() * 0.18
  if (r < 0.30) return 1.4  + rng() * 0.5
  return 0.6 + rng() * 0.7
})
const TOTAL_W = WEIGHTS.reduce((a, b) => a + b, 0)
const JITTER = Array.from({ length: STRIPS }, () => rng())

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 255
  }
  return [f(0), f(8), f(4)]
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeInOut = (p: number) => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2

// Two "shaders", one per direction:
//  - down → entering the dark HORIZONTAL section: deep blue silk
//  - up   → returning to the white SERVICES section: light, desaturated silk
type Theme = {
  hueBase: number; hueShift: number
  lightBase: number; lightRange: number
  satBase: number; satRange: number
}
const SILK: Theme = { hueBase: 214, hueShift: 18, lightBase: 0.30, lightRange: 0.54, satBase: 0.88, satRange: 0.45 }
const THEMES: Record<'down' | 'up', Theme> = {
  down: SILK,   // entering the horizontal section
  up:   SILK,   // returning to the services section
}

type Lenis = { stop: () => void; start: () => void; resize?: () => void; scrollTo: (t: number, o?: { immediate?: boolean }) => void }

export default function SilkTransition() {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    // ── DISABLED: skip the transition and let the page scroll normally. No
    // .silk-canvas is rendered, so SiteNav handles its own anchor scrolling.
    // Still emit diag-show/diag-hide from the seam so the videos play/pause.
    if (!ENABLED) {
      let raf = 0
      let vOn: boolean | null = null
      const tick = () => {
        raf = requestAnimationFrame(tick)
        const on = sentinel.getBoundingClientRect().top < 0
        if (on !== vOn) { vOn = on; window.dispatchEvent(new Event(on ? 'diag-show' : 'diag-hide')) }
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const isTouch =
      window.matchMedia('(hover: none), (pointer: coarse)').matches || 'ontouchstart' in window

    // px of scroll/swipe to lift the drawer from 0 → fully covered. We snap to
    // full cover once the drawer passes SNAP_AT, so only the first slice is manual.
    const DRAG_FULL = isTouch ? 800 : 1100
    const SNAP_AT   = 0.20
    const DRAG_EASE = 0.16   // drawer eases toward the scrolled target (smooths discrete wheel deltas)
    // fling carry-through cap. Touch flings spike hard, so cap them low → the
    // eased rise keeps up and the snap fires from ~SNAP_AT (not from a low d),
    // matching desktop pacing instead of jumping straight to a fast cover.
    const MOM_CAP   = isTouch ? 55 : 150
    const SNAP_MS   = reduceMotion ? 0   : 260   // auto-complete the cover after snap
    const HOLD      = reduceMotion ? 0   : 110
    const DISSOLVE  = reduceMotion ? 160 : 760   // silk dissolves away (the reveal)
    // land this far into the next section so it can't instantly re-fire.
    const MARGIN    = isTouch ? 0.12 : 0.05

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    let W = 0, H = 0
    const xs = new Float32Array(STRIPS)
    const ws = new Float32Array(STRIPS)
    const order = new Float32Array(STRIPS)

    const layout = () => {
      W = window.innerWidth
      H = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = W * dpr; canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      let x = 0
      const cx = W / 2
      for (let i = 0; i < STRIPS; i++) {
        xs[i] = x
        ws[i] = i < STRIPS - 1 ? Math.ceil((WEIGHTS[i] / TOTAL_W) * W) : W - x
        const mid = x + ws[i] / 2
        order[i] = clamp01((Math.abs(mid - cx) / cx) * 0.82 + JITTER[i] * 0.18)
        x += ws[i]
      }
    }
    layout()
    window.addEventListener('resize', layout)

    const getLenis = () => (window as unknown as { __lenis?: Lenis }).__lenis

    const stripColor = (i: number, t: number, th: Theme): string => {
      const nx = (xs[i] + ws[i] / 2) / W
      const drift = t * 0.16
      const n =
        Math.sin((nx * 2.2 + drift)             * 6.2832) * 0.55 +
        Math.sin((nx * 5.7 - drift * 1.3 + 0.7) * 6.2832) * 0.30 +
        Math.sin((nx * 11.0 + drift * 0.8 + 2.1) * 6.2832) * 0.15
      const v = clamp01(0.5 + n * 0.5 + (JITTER[i] - 0.5) * 0.03)
      const light = th.lightBase + Math.pow(v, 1.2) * th.lightRange
      const hue   = th.hueBase - v * th.hueShift
      const sat   = th.satBase - Math.pow(v, 2.5) * th.satRange
      const c = hsl(hue, sat, light)
      return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    }
    const paintFull = (t: number, th: Theme) => {
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        ctx.fillStyle = stripColor(i, t, th)
        ctx.fillRect(xs[i], 0, ws[i], H)
      }
    }
    const paintReveal = (dissP: number, t: number, th: Theme) => {
      const cx = W / 2
      const zoom = 1 + dissP * 0.55
      const wipe = dissP * (1 + 0.18)
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < STRIPS; i++) {
        const alpha = 1 - clamp01((wipe - order[i]) / 0.18)
        if (alpha <= 0) continue
        ctx.globalAlpha = alpha
        ctx.fillStyle = stripColor(i, t, th)
        ctx.fillRect(cx + (xs[i] - cx) * zoom, 0, ws[i] * zoom, H)
      }
      ctx.globalAlpha = 1
    }

    // drawer position: d=0 fully off-screen, d=1 fully covering.
    // down → slides up from the bottom; up → drops down from the top.
    const setDrawer = (d: number) => {
      canvas.style.opacity = d > 0 ? '1' : '0'
      const off = (1 - d) * 100
      canvas.style.transform = `translateY(${dir === 'up' ? -off : off}%)`
    }
    const hideCanvas = () => {
      canvas.style.opacity = '0'
      canvas.style.transform = dir === 'up' ? 'translateY(-100%)' : 'translateY(100%)'
      ctx.clearRect(0, 0, W, H)
    }

    // ── scroll input (drives the drawer while locked) ──
    const blockKeys = (e: KeyboardEvent) => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) e.preventDefault()
    }
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY }
    const onWheel = (e: WheelEvent) => {
      if (!locked) return
      e.preventDefault()
      if (phase === 'drag') addDrag(e.deltaY)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!locked) return
      e.preventDefault()
      if (phase === 'drag') {
        const y = e.touches[0].clientY
        addDrag(touchY - y)   // finger up = scroll-down intent = positive
        touchY = y
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('keydown', blockKeys, { passive: false })

    let locked = false
    const lock = () => { if (!locked) { locked = true; getLenis()?.stop() } }
    const unlock = () => { if (locked) { locked = false; getLenis()?.start() } }

    // Hard scroll freeze: pin the page with position:fixed instead of reactively
    // yanking scrollY back every frame (which fights Lenis / native momentum and
    // shows up as a 1px vibration on the exposed section during the drawer rise).
    let frozen = false
    let frozenAt = -1
    const freeze = (y: number) => {
      const b = document.body.style
      if (!frozen) {
        frozen = true
        const sbw = window.innerWidth - document.documentElement.clientWidth
        b.position = 'fixed'; b.left = '0'; b.right = '0'; b.width = '100%'
        if (sbw > 0) b.paddingRight = sbw + 'px'   // keep content from shifting when scrollbar vanishes
      }
      if (frozenAt !== y) { frozenAt = y; b.top = `-${y}px` }
    }
    const unfreeze = (y: number) => {
      if (!frozen) return
      frozen = false; frozenAt = -1
      const b = document.body.style
      b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = ''; b.paddingRight = ''
      window.scrollTo(0, y)
    }
    // restore scroll + Lenis to a settled position once a transition ends
    const release = (y: number) => {
      unfreeze(y)                                  // restore body flow + window.scrollTo(y)
      void document.documentElement.offsetHeight   // flush layout before Lenis re-measures
      unlock()                                     // lenis.start()
      const l = getLenis()
      l?.resize?.()                                // body was position:fixed → Lenis limits went stale; recompute so scrollTo doesn't clamp to top
      l?.scrollTo(y, { immediate: true })
    }

    // ── state ──
    let side: 'before' | 'after' = 'before'
    let phase: 'idle' | 'drag' | 'snap' | 'hold' | 'reveal' = 'idle'
    let dir: 'down' | 'up' = 'down'
    let drag = 0            // px accumulated during the manual rise
    let d = 0              // drawer progress 0..1
    let rose = false       // drawer has actually lifted (so 0 = retracted, not initial)
    let snapStart = 0, snapFromD = 0
    let phaseStart = 0
    let dragStart = 0      // when the drag phase began (stall guard)
    let lastInputAt = 0    // last time scroll/swipe/momentum moved the drawer
    let momentum = 0       // fling velocity carried into the drawer (px/frame, signed by scroll dir)
    let prevY = window.scrollY
    let scrollVel = 0      // px/frame, measured while idle
    let pinDrag = 0        // scroll Y held while the drawer rises (section frozen)
    let pinTarget = 0      // scroll Y jumped to behind full cover (next section)
    let cooldownUntil = 0
    let armedDown = true, armedUp = true
    let videoOn: boolean | null = null
    let rafId = 0

    const sign = () => dir === 'down' ? 1 : -1
    const addDrag = (rawDownDelta: number) => {
      drag = Math.max(0, drag + rawDownDelta * sign())
      if (drag > 0) rose = true
      lastInputAt = performance.now()
    }

    const setVideo = (on: boolean) => {
      if (on === videoOn) return
      videoOn = on
      window.dispatchEvent(new Event(on ? 'diag-show' : 'diag-hide'))
    }

    const startDrag = (dd: 'down' | 'up') => {
      const seamY = sentinel.getBoundingClientRect().top + window.scrollY
      dir = dd
      pinDrag = window.scrollY
      pinTarget = dd === 'down'
        ? seamY + H * MARGIN
        : Math.max(0, seamY - H - H * MARGIN)
      drag = 0; d = 0; rose = false
      // carry the fling: Lenis is about to stop, so its momentum won't arrive as
      // wheel events — seed it here so a fast scroll still lifts the drawer.
      momentum = Math.max(-MOM_CAP, Math.min(MOM_CAP, scrollVel))
      dragStart = performance.now()
      lastInputAt = dragStart
      phase = 'drag'
      lock()
      if (dd === 'down') armedDown = false; else armedUp = false
    }

    const beginSnap = (now: number) => {
      snapStart = now; snapFromD = d; phase = 'snap'
    }

    const finishReveal = (now: number) => {
      hideCanvas()
      phase = 'idle'
      release(pinTarget)
      cooldownUntil = now + 160
      if (dir === 'down') { side = 'after';  armedUp = false }
      else                { side = 'before'; armedDown = false }
    }

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)
      const t = now / 1000
      const th = THEMES[dir]

      // ── manual rise: scroll lifts the drawer, section stays pinned ──
      if (phase === 'drag') {
        freeze(pinDrag)
        if (Math.abs(momentum) >= 0.5) {    // fling carries the rise after Lenis stops
          drag = Math.max(0, drag + momentum * sign())
          if (drag > 0) rose = true
          momentum *= 0.92
          lastInputAt = now
        } else momentum = 0
        // never sit locked & invisible: if nothing lifted it shortly, release
        if (!rose && now - dragStart > 600) {
          hideCanvas(); phase = 'idle'; release(pinDrag); cooldownUntil = now + 200
          return
        }
        // lifted but stalled below the snap point (slow drag + release) → don't
        // leave the page frozen; cancel and let it fall back
        if (rose && d < SNAP_AT && momentum === 0 && now - lastInputAt > 500) {
          hideCanvas(); phase = 'idle'; release(pinDrag); cooldownUntil = now + 200
          return
        }
        const target = clamp01(drag / DRAG_FULL)
        d += (target - d) * DRAG_EASE       // inertial follow → smooth, not stepped
        if (rose && target <= 0 && d < 0.004) {   // lifted then fully retracted → cancel
          hideCanvas(); phase = 'idle'; release(pinDrag); cooldownUntil = now + 200
          return
        }
        setDrawer(d); paintFull(t, th)
        if (d >= SNAP_AT) beginSnap(now)
        return
      }

      // ── snap: auto-complete the cover, then jump behind it ──
      if (phase === 'snap') {
        freeze(pinDrag)
        const p = SNAP_MS <= 0 ? 1 : clamp01((now - snapStart) / SNAP_MS)
        d = snapFromD + (1 - snapFromD) * easeInOut(p)
        setDrawer(d); paintFull(t, th)
        if (p >= 1) {
          freeze(pinTarget)                 // jump behind the full cover to the target
          setVideo(dir === 'down')
          phase = 'hold'; phaseStart = now
        }
        return
      }

      if (phase === 'hold') {
        freeze(pinTarget)
        setDrawer(1); paintFull(t, th)
        if (now - phaseStart >= HOLD) { phase = 'reveal'; phaseStart = now }
        return
      }

      // ── reveal: silk dissolves away to uncover the section ──
      if (phase === 'reveal') {
        freeze(pinTarget)
        const dissP = easeInOut(clamp01((now - phaseStart) / DISSOLVE))
        if (now - phaseStart >= DISSOLVE) { finishReveal(now); return }
        canvas.style.opacity = '1'
        canvas.style.transform = 'translateY(0)'
        paintReveal(dissP, t, th)
        return
      }

      // ── idle: arm + fire when the seam reaches the viewport edge ──
      const yNow = window.scrollY
      scrollVel = yNow - prevY            // px/frame, drives fling carry-through
      prevY = yNow
      // arm every frame — even during cooldown — so a fast reversal past the
      // seam isn't missed while Lenis is still settling.
      const top = sentinel.getBoundingClientRect().top
      setVideo(top < 0)
      if (top > H + 4) armedDown = true            // scrolled away above → re-arm down
      if (top < -4)    armedUp = true              // scrolled away below → re-arm up
      if (now < cooldownUntil) return              // gate firing only, not arming
      if (side === 'before' && armedDown && top <= H) startDrag('down')
      else if (side === 'after' && armedUp && top >= 0) startDrag('up')
    }
    rafId = requestAnimationFrame(frame)

    const onNavGoto = (e: Event) => {
      const sel = (e as CustomEvent<string>).detail
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return
      phase = 'idle'
      hideCanvas()
      side = sel === '#contact' ? 'after' : 'before'
      armedDown = true; armedUp = true
      const y = Math.max(0, el.getBoundingClientRect().top + (frozen ? frozenAt : window.scrollY))
      unfreeze(y)
      void document.documentElement.offsetHeight
      unlock()
      const lenis = getLenis()
      if (lenis) { lenis.resize?.(); lenis.scrollTo(y, { immediate: true }) }
      else window.scrollTo(0, y)
      cooldownUntil = performance.now() + 500
    }
    window.addEventListener('nav-goto', onNavGoto)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', layout)
      window.removeEventListener('nav-goto', onNavGoto)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('keydown', blockKeys)
      if (frozen) unfreeze(frozenAt)
      unlock()
    }
  }, [])

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      {ENABLED && <canvas ref={canvasRef} className="silk-canvas" />}
    </>
  )
}
