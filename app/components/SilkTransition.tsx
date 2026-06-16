'use client'

import { useRef, useEffect } from 'react'

const STRIPS = 150

// Seeded RNG so the random layout is stable across renders
const seededRand = (seed: number) => {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}
const rng = seededRand(42)

// Randomized strip widths — mix of thin / medium / wide
const WEIGHTS = Array.from({ length: STRIPS }, () => {
  const r = rng()
  if (r < 0.18) return 0.22 + rng() * 0.18
  if (r < 0.30) return 1.4  + rng() * 0.5
  return 0.6 + rng() * 0.7
})
const TOTAL_W = WEIGHTS.reduce((a, b) => a + b, 0)

// tiny per-strip lightness jitter so the gradient still has subtle texture
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

// ── timeline (ms) ──────────────────────────────────────────────
const RISE      = 640    // strips sweep up to cover the screen
const HOLD      = 80     // brief beat at full cover
const DISSOLVE  = 900    // centre-out reveal of the next section
const FADE_W    = 0.18   // per-strip vanish softness
const EXIT_BEAT = 420    // header-exit pause before the reverse (up) curtain closes

type Lenis = { stop: () => void; start: () => void; scrollTo: (target: number, opts?: { immediate?: boolean }) => void }

export default function SilkTransition() {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Deterministic start: this section is scroll-jacked and stateful, so never
    // let the browser restore a mid-page scroll position on refresh — it would
    // re-fire the transition and yank the user into the video/shaders section.
    // Start every load at the top with the transition in its fresh 'before' state.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    let W = 0, H = 0
    const xs    = new Float32Array(STRIPS)
    const ws    = new Float32Array(STRIPS)
    const order = new Float32Array(STRIPS)  // 0..1 — centre-out disappearance order

    const layout = () => {
      W = window.innerWidth
      H = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width  = W * dpr
      canvas.height = H * dpr
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

    // ── HARD scroll lock ──────────────────────────────────────────────────
    // Block scroll at the INPUT layer (preventDefault on wheel/touch/keys) so
    // scrollY never moves from user input during a transition — this is what
    // makes the lock device- and speed-agnostic. We do NOT use overflow:hidden
    // (it would block our own programmatic teleport) and we do NOT snap-back via
    // scrollTo in the scroll handler (that reactive approach fought momentum and
    // caused the jitter). Our teleport at full-cover is the only scrollY change.
    const block = (e: Event) => e.preventDefault()
    const blockKeys = (e: KeyboardEvent) => {
      const k = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']
      if (k.includes(e.key)) e.preventDefault()
    }
    let locked = false
    const lock = () => {
      if (locked) return
      locked = true
      getLenis()?.stop()
      window.addEventListener('wheel', block, { passive: false })
      window.addEventListener('touchmove', block, { passive: false })
      window.addEventListener('keydown', blockKeys, { passive: false })
    }
    const unlock = () => {
      if (!locked) return
      locked = false
      getLenis()?.start()
      window.removeEventListener('wheel', block)
      window.removeEventListener('touchmove', block)
      window.removeEventListener('keydown', blockKeys)
    }

    // ── state ─────────────────────────────────────────────────────────────
    let raf = 0
    let startTime = -1                        // -1 ⇒ not animating
    let targetY = 0
    let jumped = false
    let reverse = false                       // play the timeline backwards (closing)
    let side: 'before' | 'after' = 'before'   // which section the user is in
    let pendingSide: 'before' | 'after' = 'after'
    let pending = false                        // in the header-exit beat before a reverse play
    let cooldownUntil = 0                      // brief guard after a play lands
    let lastY = window.scrollY
    let lastScrollTime = performance.now()

    // ── momentum catch ──
    let caught = false                         // arrested at the seam, absorbing a flick's glide
    let lastFlickAt = 0                        // last significant input while caught
    let caughtStart = 0                        // when the catch began (for the hard cap)
    let caughtPoll = 0                         // interval id: releases the catch once glide goes quiet
    const CATCH_QUIET = 160                    // ms of no input before releasing
    const CATCH_MAX   = 550                    // hard cap so an active drag is never frozen

    const isBusy = () => startTime !== -1 || pending || caught

    // A "fast" arrival at the seam = a flick / inertial glide rather than a
    // deliberate reading-pace scroll. Either of these qualifies:
    //   • high instantaneous velocity  (smooth trackpad throw)
    //   • a big single-event jump       (coalesced flick / touch fling)
    // Mouse-wheel notches and reading-pace scrolling stay BELOW both, so they
    // flow straight through and fire immediately.
    const FLICK_VELOCITY = () => H / 280       // ~px per ms — genuinely fast
    const FLICK_JUMP     = () => H * 0.55      // moved over half a screen in one event

    // absolute document Y of the video section's top edge
    const getVideoTop = () => {
      const el = canvas.nextElementSibling as HTMLElement | null
      return el
        ? el.getBoundingClientRect().top + window.scrollY
        : (sentinelRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY
    }

    const draw = (now: number) => {
      const elapsed = now - startTime
      const total   = RISE + HOLD + DISSOLVE

      if (elapsed >= total) {
        canvas.style.opacity = '0'
        unlock()
        startTime = -1
        side = pendingSide
        lastY = window.scrollY
        lastScrollTime = now
        cooldownUntil = now + 220      // brief settle, then crossing can re-trigger
        // header appears only after the shades have fully opened on the black side
        if (pendingSide === 'after') window.dispatchEvent(new Event('diag-show'))
        return
      }

      // reverse runs the exact same timeline backwards → the curtain closes
      // (strips converge edges→centre) then drops away to reveal the section
      const fe    = reverse ? total - elapsed : elapsed
      const riseP = easeInOut(clamp01(fe / RISE))
      const dissP = easeInOut(clamp01((fe - RISE - HOLD) / DISSOLVE))

      // jump to the target behind the curtain at full cover (one time)
      if (!jumped) {
        const covered = reverse ? elapsed >= DISSOLVE : elapsed >= RISE
        if (covered) {
          jumped = true
          window.scrollTo(0, targetY)
          // sync Lenis's internal position so it doesn't snap back on resume
          getLenis()?.scrollTo(targetY, { immediate: true })
          // force the browser to recalculate sticky positions immediately
          // (programmatic scrollTo skips the reflow sticky needs on some engines)
          void document.documentElement.getBoundingClientRect()
        }
      }

      const drawY = (1 - riseP) * H
      const cx    = W / 2
      const zoom  = 1 + dissP * 0.55              // subtle zoom while opening/closing
      const wipe  = dissP * (1 + FADE_W)          // centre-out vanish front

      ctx.clearRect(0, 0, W, H)
      const t = now / 1000

      for (let i = 0; i < STRIPS; i++) {
        const alpha = 1 - clamp01((wipe - order[i]) / FADE_W)
        if (alpha <= 0) continue

        // one smooth flowing colour field — layered drifting waves give organic
        // black valleys and bright cyan-white peaks that blend cleanly across
        // neighbouring strips, like Sui's light streaks.
        const nx    = (xs[i] + ws[i] / 2) / W
        const drift = t * 0.16                     // slow, sleek horizontal flow
        const n =
          Math.sin((nx * 2.2 + drift)             * 6.2832) * 0.55 +
          Math.sin((nx * 5.7 - drift * 1.3 + 0.7) * 6.2832) * 0.30 +
          Math.sin((nx * 11.0 + drift * 0.8 + 2.1) * 6.2832) * 0.15
        const v = clamp01(0.5 + n * 0.5 + (JITTER[i] - 0.5) * 0.03)
        const light = 0.02 + Math.pow(v, 1.35) * 0.80   // deep black → bright
        const hue   = 218 - v * 20                      // deep blue → cyan
        const sat   = 1 - Math.pow(v, 3) * 0.5          // brightest peaks → white-blue
        const c = hsl(hue, sat, light)

        const x = cx + (xs[i] - cx) * zoom
        const w = ws[i] * zoom

        ctx.globalAlpha = alpha
        ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
        ctx.fillRect(x, drawY, w, H)
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(draw)
    }

    const startAnim = (target: number, nextSide: 'before' | 'after', isReverse: boolean) => {
      jumped = false
      reverse = isReverse
      targetY = target
      pendingSide = nextSide
      canvas.style.opacity = '1'
      lock()
      startTime = performance.now()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(draw)
    }

    // Reduced-motion / fallback: no shader — just hand the user across the seam
    // instantly and flip the video gate. Keeps the experience coherent without
    // the animation for users who opt out of motion.
    const crossInstant = (dir: 'down' | 'up') => {
      const videoTop = getVideoTop()
      const target = dir === 'down' ? videoTop + 2 : videoTop - H
      side = dir === 'down' ? 'after' : 'before'
      window.scrollTo(0, target)
      getLenis()?.scrollTo(target, { immediate: true })
      window.dispatchEvent(new Event(dir === 'down' ? 'diag-show' : 'diag-hide'))
      lastY = window.scrollY
      lastScrollTime = performance.now()
      cooldownUntil = performance.now() + 400
    }

    // ── fire (one-shot, immediate on crossing) ─────────────────────────────
    // Down: cover, then land with the video section filling the viewport.
    const fireDown = () => {
      if (reduceMotion) { crossInstant('down'); return }
      lock()
      // +2 so the video covers the very top (no cream sliver when the navbar hides)
      startAnim(getVideoTop() + 2, 'after', false)
    }
    // Up: the header scales out first (EXIT_BEAT), THEN the curtain closes and
    // lands with the video section sitting just off the bottom (Services fills).
    const fireUp = () => {
      if (reduceMotion) { crossInstant('up'); return }
      const target = getVideoTop() - H
      pending = true
      lock()
      window.dispatchEvent(new Event('diag-hide'))      // header scales back out
      window.setTimeout(() => {
        pending = false
        startAnim(target, 'before', true)
      }, EXIT_BEAT)
    }

    // While caught we keep the scroll input-blocked (no jitter — see lock()) and
    // simply watch for the glide to fade. The events are already prevented; this
    // listener only refreshes the "still gliding" timestamp.
    const onCaughtInput = (e: Event) => {
      if (e instanceof WheelEvent) { if (Math.abs(e.deltaY) >= 4) lastFlickAt = performance.now() }
      else lastFlickAt = performance.now()   // touchmove / keydown
    }
    const endCatch = () => {
      window.clearInterval(caughtPoll)
      window.removeEventListener('wheel', onCaughtInput)
      window.removeEventListener('touchmove', onCaughtInput)
      caught = false
      unlock()
      lastY = window.scrollY
      lastScrollTime = performance.now()
      // We stay parked at the seam-hold; the user's next deliberate scroll (from
      // rest, so low velocity) fires the curtain through the normal path.
    }
    // Arrest a fast/gliding arrival at the seam: snap to the hold position (the
    // other section stays fully hidden), hard-lock to kill the momentum, then
    // release once the glide goes quiet (~160ms of no significant input).
    const catchAtSeam = (dir: 'down' | 'up') => {
      caught = true
      const videoTop = getVideoTop()
      const holdY = dir === 'down' ? videoTop - H : videoTop
      window.scrollTo(0, holdY)
      getLenis()?.scrollTo(holdY, { immediate: true })
      lastY = holdY
      lock()
      const t0 = performance.now()
      lastFlickAt = t0
      caughtStart = t0
      window.addEventListener('wheel', onCaughtInput, { passive: true })
      window.addEventListener('touchmove', onCaughtInput, { passive: true })
      window.clearInterval(caughtPoll)
      caughtPoll = window.setInterval(() => {
        const now = performance.now()
        // release once the glide goes quiet, OR at the hard cap so an active
        // (finger-down) drag is never held frozen against the user's will
        if (now - lastFlickAt < CATCH_QUIET && now - caughtStart < CATCH_MAX) return
        endCatch()
      }, 80)
    }

    const onScroll = () => {
      // Never act while a play / pending beat / catch is running, or during the
      // settle cooldown right after one lands. (Our own teleport fires a scroll
      // event; this guard makes it a no-op instead of an immediate re-trigger.)
      if (isBusy() || performance.now() < cooldownUntil) {
        lastY = window.scrollY
        lastScrollTime = performance.now()
        return
      }

      const s = sentinelRef.current
      if (!s) return
      const now      = performance.now()
      const y        = window.scrollY
      const jump     = Math.abs(y - lastY)                                        // px this event
      const velocity = jump / Math.max(1, now - lastScrollTime)                   // px/ms
      const dir      = y > lastY ? 'down' : 'up'
      lastY = y
      lastScrollTime = now
      const top = s.getBoundingClientRect().top   // seam position relative to viewport

      // "Scroll to top" (iOS status-bar tap) is a programmatic scroll FAR faster
      // than any manual flick — let it pass straight through to the top with no
      // curtain, just flip the side + close the video gate.
      const SCROLL_TO_TOP = velocity > H / 90
      if (side === 'after' && dir === 'up' && top >= 0 && SCROLL_TO_TOP) {
        side = 'before'
        window.dispatchEvent(new Event('diag-hide'))
        cooldownUntil = now + 400
        return
      }

      // A flick / inertial glide into the seam gets ARRESTED (caught) instead of
      // firing, so a fast scroll can't fling the user through the transition. A
      // deliberate, reading-pace arrival fires immediately. Reduced-motion skips
      // the catch (it has no curtain to protect — it just crosses instantly).
      const fast = !reduceMotion && (velocity > FLICK_VELOCITY() || jump > FLICK_JUMP())

      // Direction-gating prevents ping-pong at the landings: after an up-play we
      // sit at top≈H (inside the down range) but only a fresh DOWNward scroll
      // fires; after a down-play we sit at top≈0 but only a fresh UPward scroll.
      if (side === 'before' && dir === 'down' && top <= H) {
        if (fast) catchAtSeam('down'); else fireDown()
      } else if (side === 'after' && dir === 'up' && top >= 0) {
        if (fast) catchAtSeam('up'); else fireUp()
      }
    }

    // Nav links (SiteNav) / hero CTA hand off in-page jumps so the transition
    // doesn't hijack them. Cancel any running play, settle onto the correct side,
    // then snap straight to the target section.
    const onNavGoto = (e: Event) => {
      const sel = (e as CustomEvent<string>).detail
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return
      const nextSide: 'before' | 'after' = sel === '#contact' ? 'after' : 'before'

      cancelAnimationFrame(raf)
      window.clearInterval(caughtPoll)
      window.removeEventListener('wheel', onCaughtInput)
      window.removeEventListener('touchmove', onCaughtInput)
      caught = false
      startTime = -1
      reverse = false
      pending = false
      canvas.style.opacity = '0'
      side = nextSide
      unlock()
      window.dispatchEvent(new Event(nextSide === 'after' ? 'diag-show' : 'diag-hide'))

      const targetY = Math.max(0, el.getBoundingClientRect().top + window.scrollY)
      const lenis = getLenis()
      if (lenis) lenis.scrollTo(targetY, { immediate: true })
      else window.scrollTo(0, targetY)

      lastY = window.scrollY
      lastScrollTime = performance.now()
      cooldownUntil = performance.now() + 600
    }
    window.addEventListener('nav-goto', onNavGoto)

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(caughtPoll)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('nav-goto', onNavGoto)
      window.removeEventListener('resize', layout)
      window.removeEventListener('wheel', onCaughtInput)
      window.removeEventListener('touchmove', onCaughtInput)
      unlock()
    }
  }, [])

  return (
    <>
      {/* tiny sentinel — no scroll gap; sits at the services / next-section seam */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      <canvas ref={canvasRef} className="silk-canvas" />
    </>
  )
}
