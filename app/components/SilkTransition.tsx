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
const RISE     = 640     // strips sweep up to cover the screen
const HOLD     = 80      // brief beat at full cover
const DISSOLVE = 900     // centre-out reveal of the next section
const FADE_W   = 0.18    // per-strip vanish softness

type Lenis = { stop: () => void; start: () => void; scrollTo: (target: number, opts?: { immediate?: boolean }) => void }

export default function SilkTransition() {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

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

    // ── scroll lock (works alongside Lenis + allows programmatic scrollTo) ──
    const block = (e: Event) => e.preventDefault()
    const blockKeys = (e: KeyboardEvent) => {
      const k = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']
      if (k.includes(e.key)) e.preventDefault()
    }
    const lock = () => {
      getLenis()?.stop()
      window.addEventListener('wheel', block, { passive: false })
      window.addEventListener('keydown', blockKeys, { passive: false })
      // NB: we do NOT block touchmove. On iOS, preventing the first touchmove of a
      // gesture commits it to "no scroll" for its whole life, so releasing the lock
      // mid-swipe leaves it dead until you re-touch. Instead the onScroll pin holds
      // the page during touch, and the curtain (opaque) masks any scroll mid-anim.
    }
    const unlock = () => {
      getLenis()?.start()
      window.removeEventListener('wheel', block)
      window.removeEventListener('keydown', blockKeys)
      // Always restore CSS scroll lock (set by arm() after the snap).
      document.documentElement.style.overflowY = ''
    }

    let raf = 0
    let startTime = -1
    let targetY = 0
    let jumped = false
    let reverse = false                       // play the timeline backwards (closing)
    let side: 'before' | 'after' = 'before'   // which side of the transition we're on
    let pendingSide: 'before' | 'after' = 'after'
    let lastY = window.scrollY
    let lastScrollTime = performance.now()     // for velocity (scroll-to-top detection)
    let cooldownUntil = 0                      // brief guard after an animation lands
    let pending = false                        // in the pre-reverse header-exit beat
    let armed: 'down' | 'up' | null = null     // reached the seam; waiting for a 2nd scroll
    let lastInputAt = 0                        // last armed-scroll time; resets the 0.5s hold each scroll
    let lockedScrollY = 0                      // where we pin the page while armed (beats mobile momentum)
    let touchStartY = 0                        // start of an armed touch gesture
    let touchEvaluating = false                // are we measuring a fresh armed swipe's direction?

    const draw = (now: number) => {
      const elapsed = now - startTime
      const total   = RISE + HOLD + DISSOLVE

      if (elapsed >= total) {
        canvas.style.opacity = '0'
        unlock()
        startTime = -1
        side = pendingSide
        lastY = window.scrollY
        cooldownUntil = now + 180      // brief settle, then the lock can re-engage
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

    // ── two-stage trigger: arm at the seam, fire on the NEXT scroll ────────
    // Crossing the seam (either direction) doesn't animate immediately — we lock
    // at the boundary so nothing peeks, then wait. A further scroll in the same
    // direction fires the curtain; a scroll the opposite way releases it. Applies
    // both entering (down → into video) and leaving (up → back to services).
    const fireDown = () => {
      clearArmedListeners()
      armed = null
      // Restore scrollability so the animation's window.scrollTo (jump behind the
      // curtain) can work — overflow:hidden would silently swallow it.
      document.documentElement.style.overflowY = ''
      const next   = canvas.nextElementSibling as HTMLElement | null
      // +2 so the video covers the very top (no cream sliver when the navbar hides)
      const target = next ? next.getBoundingClientRect().top + window.scrollY + 2 : window.scrollY + H
      startAnim(target, 'after', false)
    }
    const fireUp = () => {
      clearArmedListeners()
      armed = null
      // Restore scrollability before the animation's scrollTo runs (same reason).
      document.documentElement.style.overflowY = ''
      // Land so the video section sits exactly off the bottom edge (Services
      // fills). Use the video element's real top so the mobile overlap (which
      // pulls the video up over Services) doesn't leave a black band behind.
      const videoEl = canvas.nextElementSibling as HTMLElement | null
      const videoTop = videoEl ? videoEl.getBoundingClientRect().top + window.scrollY : (sentinelRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY
      const target = videoTop - H
      pending = true
      window.dispatchEvent(new Event('diag-hide'))      // header scales back out
      lock()                                            // (already locked) freeze while it exits
      window.setTimeout(() => {
        pending = false
        startAnim(target, 'before', true)               // now close the shades
      }, 480)
    }
    const releaseArmed = () => {
      clearArmedListeners()
      armed = null
      unlock()
      lastY = window.scrollY
    }
    // Act on a resolved direction: same as the armed direction fires the curtain,
    // the opposite releases the lock (lets the user go back the way they came).
    const decide = (intent: 'down' | 'up') => {
      const wantDir = armed === 'down' ? 'down' : 'up'
      if (intent === wantDir) (armed === 'down' ? fireDown : fireUp)()
      else releaseArmed()
    }

    // Wheel / keyboard: every SIGNIFICANT input restarts the 0.5s hold.
    // Sub-threshold wheel deltas (< 8px) are macOS trackpad momentum tail —
    // ignoring them lets the quiet window expire naturally once momentum decays,
    // so the next deliberate flick fires the curtain without a 1-3s wait.
    const onArmedWheelKey = (e: Event) => {
      if (e instanceof WheelEvent && Math.abs(e.deltaY) < 8) return
      const now = performance.now()
      const quiet = now - lastInputAt
      lastInputAt = now
      if (quiet < 500) return
      let intent: 'down' | 'up' | null = null
      if (e instanceof WheelEvent) intent = e.deltaY > 0 ? 'down' : e.deltaY < 0 ? 'up' : null
      else if (e instanceof KeyboardEvent) {
        if (['ArrowDown', 'PageDown', 'End', ' '].includes(e.key)) intent = 'down'
        else if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) intent = 'up'
      }
      if (intent) decide(intent)
    }

    // Touch: ignore everything for 0.5s after arming / between quick taps (so a
    // flick's momentum keeps it stuck). After that, a FRESH swipe's net direction
    // decides — swiping the armed way fires, swiping back releases. We read the
    // real finger direction (touchmove vs touchstart Y), not a wheel deltaY.
    const onArmedTouchStart = (e: TouchEvent) => {
      // Any fresh finger-down after arming is deliberate (inertial momentum never
      // fires a touchstart), so evaluate it right away — no 0.5s wait. The first
      // touch sticks at the seam; this next touch decides the direction.
      touchStartY = e.touches[0]?.clientY ?? 0
      touchEvaluating = true
    }
    const onArmedTouchMove = (e: TouchEvent) => {
      // No preventDefault — let iOS keep the gesture in scroll-mode (the onScroll
      // pin holds the page); a release then flows straight into scrolling.
      if (!touchEvaluating) return
      const cy = e.touches[0]?.clientY ?? touchStartY
      const delta = touchStartY - cy            // > 0: finger moved up = scroll-DOWN intent
      if (Math.abs(delta) < 14) return          // small, responsive threshold
      touchEvaluating = false
      decide(delta > 0 ? 'down' : 'up')
    }

    function clearArmedListeners() {
      window.removeEventListener('wheel', onArmedWheelKey)
      window.removeEventListener('keydown', onArmedWheelKey)
      window.removeEventListener('touchstart', onArmedTouchStart)
      window.removeEventListener('touchmove', onArmedTouchMove)
      touchEvaluating = false
    }
    const arm = (dir: 'down' | 'up') => {
      armed = dir
      lastInputAt = performance.now()
      lock()   // hold at the boundary; the next scroll input decides
      // Snap to the VIDEO section's real top edge so neither section leaves a
      // sliver at the boundary. up-arm → video top at the viewport top (video
      // fills, no cream/white bar above it); down-arm → video top at the viewport
      // bottom (Services fills, video hidden below). Using the video element's
      // top (not the 1px sentinel) avoids the thin light bar above the video.
      const videoEl = canvas.nextElementSibling as HTMLElement | null
      if (videoEl) {
        const videoTop = videoEl.getBoundingClientRect().top + window.scrollY
        // +2 / -2 buffer so sub-pixel rounding never leaves a sliver of the other
        // section at the boundary (the cream "white bar" above the video that
        // showed when the navbar auto-hid). The 2px trimmed off the full-bleed
        // video is imperceptible.
        const snapY = dir === 'up' ? videoTop + 2 : videoTop - H - 2
        window.scrollTo(0, snapY)
        getLenis()?.scrollTo(snapY, { immediate: true })
        lastY = snapY
      }
      lockedScrollY = window.scrollY   // pin point — held against momentum in onScroll
      // NOW safe to freeze the viewport: the snap already happened so scrollTo
      // returned the correct position. overflow:hidden stops macOS trackpad momentum
      // from nudging scrollY past lockedScrollY, eliminating the jitter/vibration.
      document.documentElement.style.overflowY = 'hidden'
      touchEvaluating = false
      window.addEventListener('wheel', onArmedWheelKey, { passive: false })
      window.addEventListener('keydown', onArmedWheelKey, { passive: false })
      window.addEventListener('touchstart', onArmedTouchStart, { passive: false })
      window.addEventListener('touchmove', onArmedTouchMove, { passive: false })
    }

    const onScroll = () => {
      // While armed, pin the page at the seam. preventDefault can't stop mobile
      // inertial scrolling (no touchmove fires once the finger lifts), so we snap
      // back on every scroll event — momentum can't carry the user through.
      if (armed !== null) {
        if (window.scrollY !== lockedScrollY) window.scrollTo(0, lockedScrollY)
        lastY = lockedScrollY
        return
      }
      if (startTime !== -1 || pending) { lastY = window.scrollY; lastScrollTime = performance.now(); return }   // busy
      if (performance.now() < cooldownUntil) { lastY = window.scrollY; lastScrollTime = performance.now(); return }
      const s = sentinelRef.current
      if (!s) return
      const now      = performance.now()
      const y        = window.scrollY
      const velocity = Math.abs(y - lastY) / Math.max(1, now - lastScrollTime)   // px per ms
      const dir      = y > lastY ? 'down' : 'up'
      lastY = y
      lastScrollTime = now
      const top = s.getBoundingClientRect().top   // seam position relative to viewport

      // "Scroll to top" (iOS status-bar tap) is a programmatic scroll FAR faster
      // than any manual flick. If we detect that velocity class crossing the seam
      // upward, let it pass straight through to the top — no lock, no shader.
      const SCROLL_TO_TOP = velocity > H / 90
      if (side === 'after' && dir === 'up' && top >= 0 && SCROLL_TO_TOP) {
        side = 'before'
        window.dispatchEvent(new Event('diag-hide'))
        cooldownUntil = now + 400
        return
      }

      // Reaching the seam ALWAYS sticks the user at the boundary (even on a fast
      // flick). They stay locked between the two sections; the curtain only fires
      // on a deliberate scroll made after the 0.5s hold (see onArmedInput).
      if (side === 'before' && dir === 'down' && top <= H * 1.05) {
        if (!armed) { arm('down'); lastY = y }
      } else if (side === 'after' && dir === 'up' && top >= 0) {
        if (!armed) { arm('up'); lastY = y }
      }
    }

    // Nav links (SiteNav) hand off in-page jumps so the transition doesn't
    // hijack them. We cancel any running animation, settle the transition into
    // the correct side, then snap straight to the target section.
    const onNavGoto = (e: Event) => {
      const sel = (e as CustomEvent<string>).detail
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return
      const nextSide: 'before' | 'after' = sel === '#contact' ? 'after' : 'before'

      cancelAnimationFrame(raf)
      startTime = -1
      reverse = false
      pending = false
      clearArmedListeners()
      armed = null
      canvas.style.opacity = '0'
      side = nextSide
      unlock()
      window.dispatchEvent(new Event(nextSide === 'after' ? 'diag-show' : 'diag-hide'))

      const targetY = Math.max(0, el.getBoundingClientRect().top + window.scrollY)
      const lenis = getLenis()
      if (lenis) lenis.scrollTo(targetY, { immediate: true })
      else window.scrollTo(0, targetY)

      lastY = window.scrollY
      cooldownUntil = performance.now() + 600
    }
    window.addEventListener('nav-goto', onNavGoto)

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('nav-goto', onNavGoto)
      window.removeEventListener('resize', layout)
      clearArmedListeners()
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
