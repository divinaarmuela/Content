'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { loadBuf } from './bufLoader'
import { computeRanges } from './ranges'
import { createGlassShards, type GlassShards } from './glassShards'
import { createDiamonds, type Diamonds } from './diamonds'
import { createWhiteTunnel, type WhiteTunnel } from './whiteTunnel'
import { createBlackTunnel, type BlackTunnel } from './blackTunnel'
import { createFftBloom } from './fftBloom'
import { noBloom } from './selectiveBloom'
import { createAstronautShared, createAstronautMaterial } from './astronautMaterial'
import { createStickers, createLedCard, type Stickers, type LedCard } from './finaleExtras'
import { createFrameOverlay } from './frameOverlay'
import {
  FRAMES,
  loadSkeleton,
  loadFlightPath,
  samplePath,
  makeSkinnedPart,
  poseAtFrame,
  skinPart,
  type SkinnedPart,
  type Skeleton,
  type FlightPath,
} from './skinning'

/**
 * PRIVATE TEST — replication of lusion.co's astronaut sequence using Lusion's
 * own assets (© Lusion — never publish). Staged against a frame-by-frame
 * analysis of their live site:
 *
 *   monitor card (earth) → close-up → scattered title words → black greeble
 *   tunnel graded silver→red→green/yellow → PINK VORTEX warp → royal-blue
 *   sticker corridor → glass-screen break → black finale: diamonds sparkling
 *   around the astronaut as he waves goodbye.
 */

const ASSET = '/lusion-test'
// their EndCameraDepthToFrame = 2; laptop sits just behind the glass plane
const GLASS_DEPTH = 2
const LAPTOP_DEPTH = 2.06
// their domFrameHeight / viewportHeight. measured off lusion.co:
// #home-goal-image-out is 815px tall at a 945px viewport = 0.862. this feeds
// BOTH the glass pane size (GoalTunnelGlass.update) and the derived camera fov
// (goalTunnels.frameHeight). at my old 0.62 the pane was far too small for the
// astronaut, so his legs hung out below it before the break.
const SCREEN_FRACTION = 815 / 945
// their CSS custom properties
// surround outside the frame: MD Media charcoal instead of lusion off-white
const OFF_WHITE = '#1a1c1c'

// frame height that also fits portrait viewports: the natural vh-based size,
// clamped so the 1.768-aspect frame never overflows the width
// lusion's own mobile answer: portrait viewports swap the landscape monitor
// for a portrait TABLET frame (3:4), which fills the screen instead of
// letterboxing a wide device into a narrow viewport
const isPortrait = () => window.innerHeight > window.innerWidth
// 0.62 ≈ phone-screen aspect: at ~94% width the frame stands ~75% of the
// viewport height, so the bands above/below shrink to a slim margin
const frameAspect = () => (isPortrait() ? 0.62 : 1.768)
const cardAspect = () => (isPortrait() ? 0.62 : 817 / 571)

const fitFrameH = (vhPx: number) =>
  Math.min(SCREEN_FRACTION * vhPx, (window.innerWidth * 0.94) / frameAspect())

// single shrink factor for portrait: EVERYTHING (frame, card, world scale)
// shrinks by this same ratio so the astronaut stays proportioned to both
const frameShrink = (vhPx: number) => fitFrameH(vhPx) / (SCREEN_FRACTION * vhPx)
const BLACK = '#000000'
const BLUE = '#1a2ffb'
const GLOBAL_RADIUS = 20

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
const easeInOut = (t: number) => t * t * (3 - 2 * t)
const fit = (v: number, a: number, b: number, o0: number, o1: number) =>
  o0 + (o1 - o0) * clamp01((v - a) / (b - a))

/**
 * Phase table. These literals are only a pre-measurement fallback — `syncT()`
 * overwrites every one of them from Lusion's own GoalSectionRanges maths
 * against the real card/laptop DOM on each resize. Their weights (1, 5, 12, 2,
 * 1, 1.5) give the black tunnel over HALF the tunnel span; my hand-set numbers
 * gave it a third, which is why so much downstream had to be fudged.
 */
const T: Record<string, [number, number]> = {
  show: [0, 0.075],
  in: [0.075, 0.115],
  title: [0.115, 0.3],
  black: [0.3, 0.62],
  vortex: [0.62, 0.745],
  corridor: [0.745, 0.835],
  break: [0.835, 0.885],
  drop: [0.885, 0.925],
  wait: [0.925, 1],
  finale: [0.885, 1],
}
/** our phase name → their range id */
const T_MAP: [string, string][] = [
  ['show', 'blackFrameShow'], ['in', 'blackFrameIn'], ['title', 'blackTitle'],
  ['black', 'blackTunnel'], ['vortex', 'whiteTunnel'], ['corridor', 'whiteFrameOut'],
  ['break', 'whiteFrameBreak'], ['drop', 'astronautDrop'], ['wait', 'astronautWait'],
]

// their #home-goal-tunnel-title: lines of words, justified apart on scroll
const TITLE_LINES = [['LET', 'IMAGINATION', 'RUN'], ['INTO', 'A', 'NEW', 'WORLD']]
const TITLE_RATIO_FROM = 0.25
const TITLE_RATIO_TO = 1
const cubicIn = (t: number) => t * t * t
const sineOut = (t: number) => Math.sin((t * Math.PI) / 2)
const quartIn = (t: number) => t * t * t * t
// their ease.backInOut — anticipates UP, overshoots DOWN, settles. this is
// what makes the drop read as a jump rather than a slide.
const backInOut = (t: number) => {
  const c = 1.70158 * 1.525
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2
}
const cubicOut = (t: number) => 1 - Math.pow(1 - t, 3)
const cubicInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const sineInOut = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
const smoothstep01 = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
const fitE = (v: number, a: number, b: number, o0: number, o1: number, e: (t: number) => number) =>
  o0 + (o1 - o0) * e(Math.min(Math.max((v - a) / (b - a), 0), 1))

export default function VoidScene() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const cardUiRef = useRef<HTMLDivElement>(null)
  const fadeRef = useRef<HTMLDivElement>(null)
  const haloRef = useRef<HTMLDivElement>(null)
  const laptopRef = useRef<HTMLDivElement>(null)
  // their domImgIn / domImgOut: real IN-FLOW elements that mark where the
  // sequence starts and ends. our .vt-card and .vt-laptop are absolutely
  // positioned inside .vt-sticky, so they are pinned to the viewport and
  // useless as scroll anchors — these markers stand in for them.
  const rangeInRef = useRef<HTMLDivElement>(null)
  const rangeOutRef = useRef<HTMLDivElement>(null)
  const wordsRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    let disposed = false
    let raf = 0
    const ph = (p: number, k: string) => clamp01((p - T[k][0]) / (T[k][1] - T[k][0]))
    /**
     * their getRange(a, b).ratio — a ratio measured across a SPAN of ranges.
     * nearly every ratio GoalTunnels exposes is one of these, not a single
     * range, which is what I had wrong:
     *   astronautDropRatio = getRange("whiteFrameBreak", "astronautDrop")
     *   whiteTunnelRatio   = getRange("whiteTunnel",     "whiteFrameOut")
     *   whiteFrameRatio    = getRange("whiteTunnel")            <- single
     */
    const phSpan = (p: number, a: string, b: string) =>
      clamp01((p - T[a][0]) / Math.max(1e-6, T[b][1] - T[a][0]))

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // clearColor must NOT be multiplied by clearAlpha: their clearAlpha is
      // 0 (background contributes no bloom mask) while the background colour
      // itself must survive — white has to stay white
      premultipliedAlpha: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1

    const scene = new THREE.Scene()
    const bgColor = new THREE.Color('#000000')
    // their clearAlpha = 0: the background must contribute NO bloom mask
    // (alpha is the mask in this pipeline), so clear manually instead of
    // using scene.background, which three clears with alpha 1
    renderer.setClearColor(bgColor, 0)
    // their GoalTunnels/GoalBlackTunnel/GoalWhiteTunnel use NO fog. ours was an
    // invention, and worse, an inconsistent one: the tunnel shaders are raw
    // ShaderMaterials that ignore scene.fog, so only the standard materials
    // mixed in (helmet glass, diamonds) got hazed — ~79% at the grid's distance.

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600)
    // their _perspectiveCamera: same camera, but the astronaut's projection
    // gets extraCameraViewportOffsetY added on top of the shared view offset
    const astroCam = new THREE.PerspectiveCamera(55, 1, 0.1, 600)
    camera.position.set(0, 0.6, 5)

    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    const ambient = new THREE.AmbientLight('#252a33', 0.4)
    scene.add(ambient)
    const key = new THREE.DirectionalLight('#ffffff', 0.5)
    key.position.set(3, 4, 6)
    scene.add(key)
    const rim = new THREE.DirectionalLight('#8fa3b8', 1.2)
    rim.position.set(-4, -2, -6)
    scene.add(rim)
    const shaftLight = new THREE.PointLight('#aac4e8', 60, 60, 1.8)
    scene.add(shaftLight)

    // ── their post stack: FFT convolution bloom (star-flare kernel, halo,
    // alpha mask) + live feedback texture ──
    const bloom = createFftBloom(renderer)

    // ── glass two-pass plumbing ──
    const bgTarget = new THREE.WebGLRenderTarget(1, 1, { samples: 4 })
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quadMat = new THREE.MeshBasicMaterial({ map: bgTarget.texture })
    const quadScene = new THREE.Scene()
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat))
    const glassScene = new THREE.Scene()
    const glassRig = new THREE.Group()
    glassScene.add(glassRig)

    const texLoader = new THREE.TextureLoader()

    // ── their GoalTunnelsBackground: earth_card mesh with their shader
    // (vert$e flattens z by 0.1; frag$i is a plain texture read, alpha 0 so
    // it never blooms) ──
    const globe = new THREE.Group()
    const earthMap = texLoader.load(`${ASSET}/textures/earth_landscape.jpg`)
    earthMap.colorSpace = THREE.SRGBColorSpace
    earthMap.minFilter = THREE.LinearFilter
    const earthMat = new THREE.ShaderMaterial({
      uniforms: { u_earthTexture: { value: earthMap } },
      vertexShader: /* glsl */ `
varying vec2 v_uv;
void main() {
  vec3 pos = position;
  pos.z *= 0.1;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.);
  gl_Position = projectionMatrix * mvPosition;
  v_uv = uv;
}`,
      fragmentShader: /* glsl */ `
uniform sampler2D u_earthTexture;
varying vec2 v_uv;
void main() {
  gl_FragColor.rgb = texture2D(u_earthTexture, v_uv).rgb;
  gl_FragColor.a = 0.0;
}`,
      side: THREE.DoubleSide,
    })
    const earthMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> =
      new THREE.Mesh(new THREE.PlaneGeometry(1, 1), earthMat)
    earthMesh.renderOrder = -1
    earthMesh.frustumCulled = false
    globe.add(earthMesh)
    scene.add(globe)

    // ── their black tunnel (GoalBlackTunnel port) ──
    let blackTunnel: BlackTunnel | null = null
    let prevP = 0
    let prevBTOffsetZ = 0
    let prevWtRatio = 0
    // their click-to-slow (freezeRatio) + tunnel time accumulator
    let freeze = 0
    let isPointerDown = false
    let tunnelTime = 0
    // finale dressing + astronaut clones
    let stickers: Stickers | null = null
    let ledCard: LedCard | null = null
    const clones: THREE.Group[] = []

    // ── the 4D passage: their GoalWhiteTunnel (16 twisted tunnel blocks,
    // scroll unwinds the spiral into the straight corridor) ──
    let whiteTunnel: WhiteTunnel | null = null

    // ── their frameBgMesh: fullscreen overlay with a rounded-rect hole
    // (the device frame). Drawn AFTER the scene, in the over-layer. ──
    const frameOverlay = createFrameOverlay()
    // the over-layer scene their preUfxContainer provides: once the drop
    // starts the astronaut renders HERE, on top of the frame
    const overScene = new THREE.Scene()

    // ── astronaut ──
    const astronaut = new THREE.Group()
    scene.add(astronaut)
    // their astronaut material (astronautMaterial.ts — fragment verbatim)
    const astroShared = createAstronautShared(ASSET)

    let skel: Skeleton | null = null
    let glass: GlassShards | null = null
    let diamonds: Diamonds | null = null
    let inPath: FlightPath | null = null
    let outPath: FlightPath | null = null
    const parts: SkinnedPart[] = []
    // their clip ranges inside the 288-frame bake:
    // 0–89 floating loop · 90–139 the dive · 140–287 landing + wave
    let loopTime = 0
    let landTime = 0
    let lastT = 0

    const build = async () => {
      // materials load CONCURRENTLY with geometry — they used to wait for the
      // whole first batch, which is why the astronaut appeared late
      const materialsPromise = Promise.all([
        createAstronautMaterial(ASSET, 'astronaut_helmet', astroShared),
        createAstronautMaterial(ASSET, 'astronaut_glove_shoes', astroShared),
        createAstronautMaterial(ASSET, 'astronaut_wearpack', astroShared),
      ])
      const [skeleton, helmet, glassBuf, gloves, wearpack, bt, shards, gems, wt, inAnim, outAnim, earthCard] =
        await Promise.all([
          loadSkeleton(`${ASSET}/models/astronaut_animations.buf`),
          loadBuf(`${ASSET}/models/astronaut_helmet.buf`),
          loadBuf(`${ASSET}/models/astronaut_helmet_glass.buf`),
          loadBuf(`${ASSET}/models/astronaut_glove_shoes.buf`),
          loadBuf(`${ASSET}/models/astronaut_wearpack.buf`),
          createBlackTunnel(ASSET),
          createGlassShards(ASSET),
          createDiamonds(ASSET, 60, 9),
          createWhiteTunnel(ASSET),
          loadFlightPath(`${ASSET}/models/astronaut_in_animation.buf`),
          loadFlightPath(`${ASSET}/models/astronaut_out_animation.buf`),
          loadBuf(`${ASSET}/models/earth_card.buf`).catch(() => null),
        ])
      if (disposed) return
      skel = skeleton

      inPath = inAnim
      outPath = outAnim

      // their earth_card geometry
      if (earthCard) earthMesh.geometry = earthCard.geometry
      // their black tunnel: infinite scroll past a (near-)static camera
      blackTunnel = bt
      bt.container.visible = false
      scene.add(bt.container)

      whiteTunnel = wt
      // their camera is at z=25 with the tube at the origin; ours sits at
      // ≈2.8, so shift the tube by (2.8 − 25) to reproduce their exact
      // camera-inside-tube placement (mouth ≈ +39, tail ≈ −300 from us)
      wt.container.position.set(0, 0, 2.8 - 25)
      wt.container.visible = false
      scene.add(wt.container)

      glass = shards
      shards.mesh.position.set(0, 0, -3.2)
      shards.mesh.scale.setScalar(1.9)
      glassRig.add(shards.mesh)

      diamonds = gems
      gems.mesh.visible = false
      gems.uniforms.u_aspect.value = 1.1 // tighter vertical wrap for the finale
      scene.add(gems.mesh)

      const [helmetMat, glovesMat, wearpackMat] = await materialsPromise
      if (disposed) return
      // their shader needs the per-vertex ao stream
      for (const b of [helmet, gloves, wearpack]) {
        if (b.streams.ao)
          b.geometry.setAttribute('ao', new THREE.BufferAttribute(b.streams.ao as Float32Array, 1))
      }
      parts.push(
        makeSkinnedPart(helmet, helmetMat),
        makeSkinnedPart(gloves, glovesMat),
        makeSkinnedPart(wearpack, wearpackMat),
        makeSkinnedPart(
          glassBuf,
          new THREE.MeshPhysicalMaterial({
            color: '#0a1020', roughness: 0.05, metalness: 0,
            transparent: true, opacity: 0.3, envMapIntensity: 2.5,
          }),
        ),
      )
      // their meshes sit at the container origin — updateTransforms does ALL
      // the placing via v.position.copy(trackPoint). the -1 y offset here was
      // a leftover from my old camZ/lead rig and, against their (0,0,25) camera,
      // dropped him a full world unit: body below the frame, only the helmet
      // showing at the bottom edge.
      parts.forEach((p) => astronaut.add(p.mesh))

      // their CLONES_COUNT = 4, ghostly (their IS_CLONE branch renders only
      // the tunnel reflection, faded by u_alpha = clonesShowRatio)
      for (let i = 0; i < 4; i++) {
        const g = new THREE.Group()
        for (const part of parts) {
          // their IS_CLONE branch is reflection-only and fresnel-weighted
          // (× (0.5 + fresnel*0.9)) — dim body, brighter rim — not a flat glow
          const ghost = new THREE.MeshBasicMaterial({
            color: '#43536b',
            transparent: true,
            opacity: 0,
            depthWrite: false,
            // RGB adds scaled by opacity; ALPHA (the bloom mask) is preserved
            // from the destination, so clones glow without feeding the bloom
            blending: THREE.CustomBlending,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
          })
          const m = new THREE.Mesh(part.mesh.geometry, ghost)
          m.frustumCulled = false
          m.position.set(0, -1, 0)
          g.add(m)
        }
        g.visible = false
        scene.add(g)
        clones.push(g)
      }

      stickers = createStickers(ASSET)
      stickers.group.visible = false
      scene.add(stickers.group)
      ledCard = createLedCard(ASSET)
      ledCard.mesh.visible = false
      astronaut.add(ledCard.mesh)
      ledCard.mesh.position.set(0, 0.1, 0.55)

      setStatus('ready')
    }
    build().catch((e) => {
      console.error('[void-test]', e)
      setStatus('error')
    })

    // ── scroll / pointer / resize ──
    let progress = 0
    let targetProgress = 0
    const readScroll = () => {
      const rect = wrap.getBoundingClientRect()
      const total = rect.height - window.innerHeight
      targetProgress = total > 0 ? clamp01(-rect.top / total) : 0
    }
    window.addEventListener('scroll', readScroll, { passive: true })
    readScroll()

    const pointer = { x: 0, y: 0 }
    const onMove = (e: MouseEvent) => {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', onMove)
    const onDown = () => { isPointerDown = true }
    const onUp = () => { isPointerDown = false }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      const dpr = renderer.getPixelRatio()
      bgTarget.setSize(w * dpr, h * dpr)
      bloom.setSize(w * dpr, h * dpr)
      if (glass) glass.uniforms.u_resolution.value.set(w * dpr, h * dpr)
      syncT(h)
    }

    /**
     * their GoalSectionRanges.resize — the phase boundaries are MEASURED, not
     * declared. the card and laptop each claim (viewportHeight + ownHeight)/2
     * of scroll; whatever is left is divided by their tunnel weights.
     */
    let frameShiftPx = 0
    let astroLatched = false
    let ceP = 0
    let RANGES: ReturnType<typeof computeRanges> | null = null
    let inDocRect = { top: 0, height: 0 }
    let outDocRect = { top: 0, height: 0 }
    const syncT = (vhPx: number) => {
      const card = rangeInRef.current
      const laptop = rangeOutRef.current
      if (!card || !laptop) return
      // their astronautWait runs to the end of the footer; ours is the outro
      const outro = document.querySelector('.vt-outro') as HTMLElement | null
      const wrapRect = wrap.getBoundingClientRect()
      const footerBottom = outro
        ? outro.getBoundingClientRect().bottom + window.scrollY
        : wrapRect.bottom + window.scrollY
      const R = computeRanges(wrap, card, laptop, footerBottom, vhPx)
      if (!(R.total > 0)) return
      RANGES = R
      const cr = card.getBoundingClientRect()
      const lr = laptop.getBoundingClientRect()
      inDocRect = { top: cr.top + window.scrollY, height: cr.height }
      outDocRect = { top: lr.top + window.scrollY, height: lr.height }
      for (const [ours, theirs] of T_MAP) {
        const it = R.items[theirs as keyof typeof R.items]
        T[ours] = [it.from / R.total, it.to / R.total]
      }
      // finale spans their drop + wait
      T.finale = [T.drop[0], T.wait[1]]
      ;(window as any).__T = JSON.parse(JSON.stringify(T))
    }
    window.addEventListener('resize', resize)
    // mobile URL-bar show/hide changes the visual viewport without always
    // firing window resize — track it so the canvas never renders stretched
    window.visualViewport?.addEventListener('resize', resize)
    resize()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const clock = new THREE.Clock()
    const lookTarget = new THREE.Vector3()
    let rollVel = 0
    const UPRIGHT = new THREE.Quaternion()
    const cloneOffset = new THREE.Vector3()
    // their cameraLookX/Y state
    let camLookX = 0
    let camLookY = 0
    const camLookEuler = new THREE.Euler()
    const camLookQ = new THREE.Quaternion()
    // black-tunnel colour grading: silver → red → green/yellow
    const bgById: Record<string, THREE.Color> = {
      black: new THREE.Color('#000000'),
      white: new THREE.Color('#ffffff'),
      blue: new THREE.Color(0.102, 0.184, 0.984), // their wall colour, linear
      tunnelBg: new THREE.Color(),
    }

    let errLogged = false
    const tick = () => {
      raf = requestAnimationFrame(tick)
      try {
      tickBody()
      } catch (e) {
        // a throw here would otherwise silently freeze the whole sequence
        if (!errLogged) { errLogged = true; console.error('[void-test] render loop error:', e) }
      }
    }
    const tickBody = () => {
      const t = clock.getElapsedTime()
      progress += (targetProgress - progress) * (reduceMotion ? 1 : 0.08)
      const p = progress

      const pShow = ph(p, 'show')
      const pIn = easeInOut(ph(p, 'in'))
      const pTitle = ph(p, 'title')
      const pBlack = ph(p, 'black')
      const pVortex = ph(p, 'vortex')
      const pCorr = ph(p, 'corridor')
      const pBreak = ph(p, 'break')
      const pFinale = ph(p, 'finale')
      // their astronautDropRatio: begins at the BREAK's start, so his descent
      // overlaps the shatter instead of waiting for it to finish
      const dropR = phSpan(p, 'break', 'drop')
      // their whiteFrameRatio — the whiteTunnel range ALONE (our vortex)
      const whiteFrameRatio = ph(p, 'vortex')
      const pFade = clamp01((ph(p, 'wait') - 0.85) / 0.15)
      const wtRatio = clamp01((p - T.vortex[0]) / (T.break[0] - T.vortex[0]))
      const vW = T.vortex[1] - T.vortex[0]
      const cW = T.corridor[1] - T.corridor[0]
      const bW = T.break[1] - T.break[0]
      const wtGate = easeInOut(clamp01((p - (T.vortex[0] - 0.16 * vW)) / (0.48 * vW))) *
        (dropR > 0.57 ? 0 : 1)
      // their out-frame approach: tilted −0.3 rad, straightening at the break
      const oaFrom = T.corridor[1] - 0.56 * cW
      const outApproach = clamp01((p - oaFrom) / Math.max(1e-6, T.break[0] + 0.30 * bW - oaFrom))
      // their f = E × −0.3, E = the same ratio as domFrameScale. E hits 0 as
      // the frame reaches natural size, so the LAPTOP itself is never tilted —
      // the rotation only exists while the frame is still zoomed past screen.
      const outTilt = 0
      // their domFrameScale: mix(1, viewportDiagonal / min(frameW, frameH), E)
      // E runs 1→0 through whiteFrameOut, so the frame ZOOMS OUT from
      // full-screen to the real laptop size just before the break
      // their E = fit(offsetY, whiteFrameOut.pixelFrom, whiteFrameOut.pixelTo,
      // 1, 0) — it runs across the WHOLE whiteFrameOut range, so the frame
      // shrinks from full-screen (pure corridor) down to the real laptop over
      // that entire phase. my ramp only started near the corridor's end, so
      // the reveal never played and the overlay snapped in late.
      const outE = 1 - ph(p, 'corridor')
      // their `te` = getRange("astronautDrop").ratio — the drop RANGE alone,
      // distinct from astronautDropRatio (the break→drop span)
      const te = ph(p, 'drop')
      const vw = window.innerWidth
      const vhPx = Math.max(1, window.innerHeight)
      const diag = Math.sqrt(vw * vw + vhPx * vhPx)
      const frameHpx = fitFrameH(vhPx)
      const frameWpx = frameHpx * frameAspect()
      const domFrameScale = 1 + (diag / Math.min(frameWpx, frameHpx) - 1) * outE

      // the CSS card is retired: their frameBgMesh overlay is the card
      const card = cardRef.current
      if (card) card.style.opacity = '0'
      const cardUi = cardUiRef.current
      if (cardUi) cardUi.style.opacity = `${1 - clamp01(pIn * 1.6)}`

      // ── their HomeGoalSectionTunnelTitle.update(), verbatim ──
      const wordsEl = wordsRef.current
      if (wordsEl) {
        const r = fit(pTitle, TITLE_RATIO_FROM, TITLE_RATIO_TO, 0, 1)
        const show = r > 0 && r < 1
        wordsEl.style.visibility = show ? 'visible' : 'hidden'
        if (show) {
          let n = fitE(r, 0.5, 1, 1, 12, cubicIn)          // scale rush 1 → 12
          let a = fit(r, 0.9, 1, 1, 0)                      // fade at the end
          const l = fitE(r, 0.4, 0.6, 0, 1, cubicInOut)     // word spread
          n *= fitE(r, 0, 0.15, 0.85, 1, cubicOut)
          a *= fit(r, 0, 0.05, 0, 1)
          wordsEl.style.transform = `translate(-50%, -50%) scale(${n})`
          wordsEl.style.opacity = `${a}`
          const lines = wordsEl.children
          for (let li = 0; li < lines.length; li++) {
            const spans = lines[li].children
            for (let wi = 0; wi < spans.length; wi++) {
              const el = spans[wi] as HTMLElement & { _offsetX?: number }
              if (el._offsetX === undefined) {
                // justify: spread words to fill the line, their _offsetX
                const total = spans.length - 1
                el._offsetX = total > 0 ? (wi / total - 0.5) * wordsEl.clientWidth * 0.9 : 0
              }
              el.style.transform = `translateX(${l * el._offsetX}px)`
            }
          }
        }
      }

      // rainbow halo — their syncProperties curve, fed into the bloom's
      // high-pass (that's where their halo actually lives)
      let haloStrength = pIn * (0.15 * pTitle + fit(pBlack, 0.2, 0.4, 0, 0.25))
      haloStrength = fit(pBlack, 0.65, 0.75, haloStrength, 0.08)
      if (wtGate > 0.001) haloStrength = 0   // their isWhiteTunnelActive → 0
      bloom.haloStrength.value = haloStrength
      const halo = haloRef.current
      if (halo) halo.style.opacity = '0'

      // ── their clip system (GoalTunnelAstronauts.updateAnimation):
      // frames 0–89 loop while floating, 90–139 scrub through the dive,
      // 140–287 play the landing + wave in the finale ──
      const dt = Math.min(t - lastT, 0.1)
      lastT = t
      if (skel && parts.length) {
        // their updateAnimation, structurally: ONE base clip plus ONE blend
        // target, mixed by u_loopLinearBlend. the 90–139 dive frames are ONLY
        // ever reached through that blend — there is no separate scrub of them.
        const wfOut = ph(p, 'corridor')          // their whiteFrameOutRatio
        // their g = fit(r,0,.1,0,1) * fit(r,.9,1,1,0)
        const blendG = fit(dropR, 0, 0.1, 0, 1) * fit(dropR, 0.9, 1, 1, 0)
        // their v = fit(whiteFrameOutRatio + astronautDropRatio, .9, 2, 90, 139,
        // quartIn) — flat at 90 until the very end of whiteFrameOut, so he does
        // NOT dive during the corridor or the break, only through the drop.
        const diveFrame = fitE(wfOut + dropR, 0.9, 2, 90, 139, quartIn)
        let frame: number
        if (dropR > 0.5) {
          // their l=140, c=287 with speed fit(r,.9,1,0,1): frozen on 140 until
          // the last 10% of the drop, then the landing plays at full speed
          landTime += dt * fit(dropR, 0.9, 1, 0, 1)
          frame = 140 + Math.min(landTime * 60, 287 - 140)
        } else {
          // their l=0, c=89 float loop at S = smoothstep(-.3,1,blackTitle)*.75
          loopTime += dt * 0.75 * smoothstep01(-0.3, 1, pTitle)
          frame = (loopTime * 60) % 90
        }
        ;(window as any).__frame = frame
        ;(window as any).__blend = blendG
        // their two-pose blend: skin with the clip pose AND the dive pose,
        // then mix the vertex positions by u_loopLinearBlend
        const matrices = poseAtFrame(skel, Math.min(frame, FRAMES - 1.01), 0)
        const matricesB = blendG > 0
          ? poseAtFrame(skel, Math.min(diveFrame, FRAMES - 1.01), 1)
          : undefined
        for (const part of parts) skinPart(part, matrices, matricesB, blendG)
      }

      // ── their camera rig (GoalTunnels + cameraControls), ported ──
      // syncProperties:
      //   r = mix(frameHeight, viewportHeight,
      //           blackFrameInRatio < 1 ? blackFrameInRatio : 1 - whiteFrameRatio)
      //   l = tan(expectedFov/180*PI / 2) * a * 2 * viewportHeight / r
      //   cameraFov = atan(l/2/a) * 2/PI * 180
      const A_DIST = 1                    // |(0,0,25) - (0,0,24)|
      const EXPECTED_FOV = 45
      const vhPxC = Math.max(1, window.innerHeight)
      // fov mapping uses the DESIGN frame height (their geometry, ~86% vh) —
      // feeding the width-clamped mobile height in here drove the fov past
      // 110° and blew the astronaut up with wide-angle distortion. The
      // portrait shrink is applied as camera.zoom below instead: a uniform
      // projection scale with no perspective change.
      const designFrameH = SCREEN_FRACTION * vhPxC
      // their blackFrameInRatio is the RAW range ratio — pIn is eased, which
      // skewed the card-zoom fov ramp
      const blackFrameInRatio = ph(p, 'in')
      const rMix = blackFrameInRatio < 1 ? blackFrameInRatio : 1 - whiteFrameRatio
      const rPx = designFrameH + (vhPxC - designFrameH) * clamp01(rMix)
      const lC = Math.tan((EXPECTED_FOV / 180) * Math.PI / 2) * A_DIST * 2 * vhPxC / Math.max(1, rPx)
      const baseFov = (Math.atan(lC / 2 / A_DIST) * 2 / Math.PI) * 180
      camera.position.set(0, 0, 25)
      camera.lookAt(0, 0, 24)
      const camZ = 25
      // their cameraFov = 30 for the card/tunnel rig, widening only as the
      // sequence pushes in
      // their cameraFov is a flat 30; the widening through the tunnel is
      // GoalWhiteTunnel.update's dolly zoom:
      //   cameraDollyZoomFovOffset = math.fit(whiteTunnelRatio, 0, 1, 60, 0)
      // I had an invented `+25 * easeInOut(pTitle)` instead, which is far
      // narrower — so the corridor was framed down the barrel at the bright
      // far end rather than across the blue walls.
      // GoalWhiteTunnel.update: cameraDollyZoomFovOffset = fit(whiteTunnelRatio,0,1,60,0)
      const dollyZoomFov = wtGate > 0 ? fit(wtRatio, 0, 1, 60, 0) : 0
      let blackFovWobble = 0
      camera.fov = baseFov
      // portrait: shrink the projection to match the width-clamped frame —
      // but ONLY while the frame is on screen. rMix already tracks frame→
      // fullscreen (0 framed, 1 in the tunnels); inside the tunnels the zoom
      // eases back to 1 so the tube fills the view (zoomed out, the black
      // beyond the tube walls was glimpsed on mobile)
      camera.zoom = 1 + (frameShrink(vhPxC) - 1) * (1 - clamp01(rMix))
      // their freezeRatio: hold the pointer down to slow tunnel time
      freeze += ((isPointerDown ? 1 : 0) - freeze) * 0.1
      const tdt = dt * (1 - 0.7 * freeze)
      tunnelTime += tdt

      // their black-tunnel dolly wobble + tunnel scroll update
      if (blackTunnel) {
        const scrollDir = p >= prevP ? 1 : -1
        // their GoalBlackTunnel writes the SAME cameraDollyZoomFovOffset
        // property, so it must go through the dolly compensation too
        // their flags are mutually exclusive — no overlap, no cross-fade:
        //   isBlackTitleActive  = blackTitleRatio < 1
        //   isBlackTunnelActive = blackTunnelRatio < 1 && !isBlackTitleActive
        //   goalBlackTunnel.container.visible = isBlackTunnelActive
        // my 0.32 overlap window kept half-dissolved greebles alive into the
        // vortex — the broken pink rings.
        const isBlackTitleActive = pTitle < 1
        const isBlackTunnelActive = pBlack < 1 && !isBlackTitleActive
        blackFovWobble = blackTunnel.update(
          tdt, pBlack, tunnelTime, scrollDir, isBlackTunnelActive,
        )
        ;(blackTunnel.uniforms.u_resolution.value as THREE.Vector2).set(
          renderer.domElement.width, renderer.domElement.height,
        )
      }
      // their cameraViewportOffsetY, applied as a view offset so EVERY 3D
      // element (astronaut, glass shards, tunnel) shifts with the frame
      {
        // their cameraControls: widen the fov by the dolly offset, then
        // translateZ so the point at cameraDistance keeps its apparent size
        //   n = dist * tan(r/360*PI/2) / tan(fov/360*PI/2) - dist
        //   camera.translateZ(n)
        const rBase = camera.fov
        camera.fov = rBase + dollyZoomFov + blackFovWobble
        const dist = 1                              // their cameraDistance
        const nDolly = dist * Math.tan((rBase / 360) * Math.PI / 2)
          / Math.tan((camera.fov / 360) * Math.PI / 2) - dist
        camera.translateZ(nDolly)
        camera.updateMatrixWorld()
        const W = renderer.domElement.width, H = renderer.domElement.height
        const dpr = renderer.getPixelRatio()
        if (frameShiftPx !== 0) camera.setViewOffset(W, H, 0, frameShiftPx * dpr, W, H)
        else camera.clearViewOffset()
        camera.updateProjectionMatrix()
        // their _onBeforeRender: copy the shared view, then ADD -ce
        astroCam.position.copy(camera.position)
        astroCam.quaternion.copy(camera.quaternion)
        astroCam.fov = camera.fov
        astroCam.zoom = camera.zoom
        astroCam.aspect = camera.aspect
        astroCam.near = camera.near
        astroCam.far = camera.far
        const astroOffset = frameShiftPx - ceP
        if (astroOffset !== 0) astroCam.setViewOffset(W, H, 0, astroOffset * dpr, W, H)
        else astroCam.clearViewOffset()
        astroCam.updateProjectionMatrix()
        astroCam.updateMatrixWorld()
      }

      // ── their GoalTunnelEfx feed: black tunnel scroll delta + white tunnel
      // scroll-velocity smear/roll, motion blur active only in the tunnels ──
      {
        const inBlack = pTitle >= 1 && pBlack < 1
        const inWhite = wtGate > 0.5
        bloom.motionAmount.value = inBlack ? 1 : inWhite ? fit(wtRatio, 0.75, 1, 1, 0) : 0
        let offZ = 0
        if (blackTunnel && inBlack) {
          const cur = blackTunnel.uniforms.u_offsetZ.value as number
          offZ = (cur - prevBTOffsetZ) * fit(pBlack, 0, 0.2, 0, 1)
          prevBTOffsetZ = cur
        } else if (blackTunnel) {
          prevBTOffsetZ = blackTunnel.uniforms.u_offsetZ.value as number
        }
        if (inWhite) {
          const dW = wtRatio - prevWtRatio
          offZ += Math.max(-1, Math.min(1, -dW * fit(wtRatio, 0, 0.9, 500, 0)))
          bloom.motionRotZ.value = Math.max(-1, Math.min(1, -dW * fit(wtRatio, 0, 0.8, 45, 0)))
        } else {
          bloom.motionRotZ.value = 0
        }
        prevWtRatio = wtRatio
        bloom.motionOffset.set(0, 0, offZ)
      }
      prevP = p

      // ── astronaut root: their in/out flight tracks (GoalTunnelAstronauts
      // .updateTransforms), applied relative to my camera rail, with their
      // brownian tumble ramping through the black tunnel ──
      const stand = easeInOut(clamp01(pFinale * 1.6))
      const rootQ = new THREE.Quaternion()
      const rootP = new THREE.Vector3()
      const wtR = clamp01((p - T.vortex[0]) / (T.break[0] - T.vortex[0]))
      if (inPath && outPath && p >= T.vortex[0]) {
        // white tunnel onward: out-track 0→79, then 79→99 through the drop
        // their updateTransforms: M = whiteTunnelRatio<1 ? fit(n,0,1,0,79)
        // : fit(astronautDropRatio,0,1,79,99). the second leg is keyed to the
        // DROP, not the whole finale — he reaches frame 99 and holds there
        // for the wait instead of drifting on.
        const m = wtR < 1
          ? fit(wtR, 0, 1, 0, 79 / 99)
          : fit(dropR, 0, 1, 79 / 99, 1)
        samplePath(outPath, m, rootQ, rootP)
      } else if (inPath) {
        // approach: in-track scrubbed by cubicIn(titleRatio)
        const m = pTitle * pTitle * pTitle
        samplePath(inPath, m, rootQ, rootP)
      }
      // track z runs 23→13 (approaching); re-anchor: he drifts nearer through
      // the title, holds a lead through the run, settles for the wave
      const lead = 25 - rootP.z          // kept only for probes/glass sizing
      // punch-through: he starts BEHIND the screen plane (laptop at 2.06,
      // glass at 2.0) and crosses to 1.35 — in FRONT — during the break
      // approach: he sits behind the glass plane (2.0) and stays visible
      // through it, then crosses to the front during the shatter
      // sway dies completely by the finale — he PLANTS in front of the
      // broken laptop (broke through), only the landing/wave clip moves
      // their brownian amplitude through the white phase is fit(whiteFrameRatio,
      // 0, .75, 5, 0) — it decays on its OWN ratio and owes nothing to the
      // break. planting likewise belongs to the drop, not the break.
      const sway = (wtGate > 0 ? fit(whiteFrameRatio, 0, 0.75, 5, 0) : pBlack * 5) *
        (1 - easeInOut(dropR))
      const planted = 0
      // their drop, verbatim — world units, correct by construction now that
      // the camera sits where theirs does
      const dropY = 0.4 * backInOut(dropR)
      // their v.position = sampled track point, plus brownian, minus the drop
      // portrait: the flight path's x offsets were measured against the wide
      // landscape frame — compress them toward centre so he stays centred
      // inside the narrow tablet frame and through the vortex
      const xComp = isPortrait() ? frameAspect() / 1.768 : 1
      astronaut.position.set(
        (rootP.x + Math.sin(t * 0.4) * 0.12 * sway * 0.02) * xComp,
        rootP.y + Math.sin(t * 0.7) * 0.1 * sway * 0.02 - dropY,
        rootP.z,
      )
      astronaut.quaternion.copy(rootQ)
      // brownian-style tumble, amplitude ramping like theirs (up to ~60°)
      const tumble = (wtGate > 0 ? fit(wtRatio, 0, 0.75, 1, 0) : pBlack) *
        (1 - easeInOut(clamp01(pBreak + pFinale)))
      // their branch has NO constant roll — only brownian rotation whose
      // amplitude decays to 0 by 75% of the white phase. My pVortex × 1.1 term
      // was a permanent 1.1 rad twist: the rightward spin in the corridor.
      astronaut.rotateZ(Math.sin(t * 0.5) * 0.5 * tumble)
      astronaut.rotateX(Math.sin(t * 0.33 + 2) * 0.6 * tumble)
      astronaut.rotateY(Math.sin(t * 0.41 + 4) * 0.5 * tumble)
      // their finale: he PLANTS — no float, no spin, facing the viewer
      if (stand > 0.001) astronaut.quaternion.slerp(UPRIGHT, stand)
      // their scroll-velocity roll: scrubbing fast through the warp spins the lens
      rollVel += ((targetProgress - progress) * 30 * clamp01(pVortex * 3) * (1 - easeInOut(pBreak)) - rollVel) * 0.06
      camera.up.set(Math.sin(rollVel), Math.cos(rollVel), 0)
      lookTarget.set(0, camera.position.y - 0.05, astronaut.position.z - 3)
      camera.lookAt(lookTarget)
      // their eased mouse LOOK (rotation, not translation)
      // their syncProperties, exactly:
      //   cameraLookStrength  = .08 * smoothstep(.5,1,blackTitleRatio) + .02
      //   cameraLookStrength *= whiteTunnelRatio > 0
      //        ? fit(whiteTunnelAstronautOutRatio, .75, 1, 0, .5) : 1
      //   cameraLookStrength  = fit(whiteTunnelWaitRatio, 0, .1, ..., .05)
      // whiteTunnelAstronautOutRatio spans whiteFrameBreak → astronautWait.
      // (our old `|| 1` also defeated the zero case: 0 || 1 === 1, so the
      // look damping never actually reached zero.)
      const outRatio = phSpan(p, 'break', 'wait')
      let lookStrength = 0.08 * smoothstep01(0.5, 1, pTitle) + 0.02
      if (wtRatio > 0) lookStrength *= fit(outRatio, 0.75, 1, 0, 0.5)
      lookStrength = fit(ph(p, 'wait'), 0, 0.1, lookStrength, 0.05)
      camLookX += (Math.max(-1, Math.min(1, pointer.y)) * lookStrength - camLookX) * 0.1
      camLookY += (Math.max(-1, Math.min(1, -pointer.x)) * lookStrength - camLookY) * 0.1
      camLookEuler.set(camLookX, camLookY, 0)
      camera.quaternion.multiply(camLookQ.setFromEuler(camLookEuler))
      shaftLight.position.set(0, 0, camZ - 8)

      // ── their GoalTunnelsBackground.update(), verbatim ──
      earthMesh.visible = pIn < 1
      globe.visible = earthMesh.visible
      if (globe.visible) {
        // their camera sits 25 units from the card's origin — match that
        globe.position.set(0, 0, camera.position.z - 25)
        earthMesh.position.y = -(10 * (1 - pShow) + 2.5 + 30 * pIn)
        earthMesh.scale.setScalar(fit(pIn, 0, 0.5, 40, 70))
        globe.rotation.x = fit(pIn, 0, 0.5, 0, -1)
      }

      // ── the white tunnel: one system from vortex to corridor, scroll
      // unwinds the twist (their whiteTunnelRatio) ──
      // their update(): bg is BLACK through title+black tunnel, pure WHITE the
      // moment the white tunnel takes over, black again after the drop
      {
        // their exact branch: white the moment the white tunnel is active,
        // black again once the astronaut drops out of it
        const whiteTunnelActive = wtGate > 0.001
        const dropRatio = dropR
        if (whiteTunnelActive && dropRatio < 1) bgColor.setStyle('#ffffff')
        else bgColor.setStyle('#000000')
      }
      // their clearAlpha = fit(whiteTunnelWaitRatio, 0, .1, .3, 0) inside the
      // white tunnel, 0 elsewhere
      renderer.setClearColor(bgColor, wtGate > 0.001 ? fit(ph(p, 'wait'), 0, 0.1, 0.3, 0) : 0)

      // their exact syncProperties curves
      // their syncProperties, verbatim
      // their whiteTunnelWaitRatio = getRange("astronautWait").ratio
      const waitRatio = ph(p, 'wait')
      if (wtGate > 0.001) {
        bloom.amount.value = dropR < 1
          ? fit(whiteFrameRatio, 0, 0.05, 4, 2)  // their whiteFrameRatio 4 → 2
          : fit(waitRatio, 0, 0.1, 0, 20)        // their wait ramp 0 → 20
      } else {
        bloom.amount.value = fit(pTitle, 0, 0.25, 30, 6)
      }
      bloom.saturation.value = pBlack < 1 ? fit(pBlack, 0, 0.7, 1, 3) : 1
      if ((window as any).__noBloom) bloom.amount.value = 0
      // live feedback → the black tunnel's reflections
      if (blackTunnel) blackTunnel.uniforms.u_feedbackTexture.value = bloom.feedbackTexture

      // their astronaut material inputs
      astroShared.u_blackTunnelTexture.value = bloom.feedbackTexture
      astroShared.u_blackTunnelRatio.value = pBlack
      astroShared.u_frameIn.value = pIn
      astroShared.u_time.value = t
      astroShared.u_debugFlat.value = (window as any).__flat ? 1 : 0
      astroShared.u_bgColor.value.copy(bgColor)
      if (blackTunnel) astroShared.u_offsetZ.value = blackTunnel.uniforms.u_offsetZ.value as number

      if (whiteTunnel) {
        whiteTunnel.container.visible = wtGate > 0.001
        if (whiteTunnel.container.visible) {
          // their isWhiteTunnelActive = whiteTunnelRatio <= 1
          //   && !isBlackTunnelActive && !isBlackTitleActive
          const isWhiteTunnelActive = pTitle >= 1 && pBlack >= 1
          whiteTunnel.container.visible = isWhiteTunnelActive && dropR < 1
          whiteTunnel.uniforms.u_ratio.value = wtRatio
          whiteTunnel.uniforms.u_ratioInverse.value = 1 - wtRatio
          whiteTunnel.uniforms.u_time.value = tunnelTime
          // fbm drift for their roaming sphere-occlusion shadow
          whiteTunnel.uniforms.u_fbm.value.set(
            Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.7) * 0.25,
            Math.cos(t * 0.9) * 0.5 + Math.sin(t * 1.3) * 0.2,
            0,
          )
        }
      }
      // their dolly-zoom: +60° fov at full twist, easing to 0 as it unwinds
      camera.fov += 55 * (1 - wtRatio) * wtGate
      camera.updateProjectionMatrix()

      // diamonds sparkle around him in the finale
      if (diamonds) {
        const active = easeInOut(clamp01(pFinale * 2.2)) * (1 - pFade)
        diamonds.mesh.visible = active > 0.001
        if (diamonds.mesh.visible) {
          diamonds.mesh.position.set(astronaut.position.x, astronaut.position.y, astronaut.position.z - 2)
          diamonds.uniforms.u_time.value = t
          diamonds.uniforms.u_activeRatio.value = active
          diamonds.uniforms.u_bgColor.value.copy(bgColor)
          diamonds.mesh.updateMatrixWorld()
          diamonds.uniforms.u_normalMatrix.value.getNormalMatrix(
            new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, diamonds.mesh.matrixWorld),
          )
        }
      }

      // the glass screen break — their GoalTunnelGlass.update() maths:
      // pane parked EndCameraDepthToFrame=2 units ahead, scaled to the DOM
      // frame's fraction of the viewport, shards shrinking away as he drops
      if (glass) {
        // their exact gate:
        //   goalTunnelGlass.container.visible &&= goalTunnelGlass.ratio > 0
        //   goalTunnelGlass.container.visible &&= astronautDropRatio < 1
        // ratio = sineOut(astronautDropRatio), so the pane only EXISTS from the
        // break's start. ours switched it on back in the corridor (measured
        // visible at corr 60%), which is why he read as already through it.
        const glassRatio = sineOut(dropR)
        const visible = glassRatio > 0 && dropR < 1
        glassRig.visible = visible
        if (visible) {
          glassRig.position.copy(camera.position)
          glassRig.quaternion.copy(camera.quaternion)
          glass.mesh.position.set(0, 0, -GLASS_DEPTH)
          const zoomExcessG = clamp01((domFrameScale - 1) / Math.max(0.001, diag / Math.min(frameWpx, frameHpx) - 1))
          glass.mesh.rotation.z = zoomExcessG * 0.3
          // their formula: scale = (frameHeight / viewportHeight) × worldH,
          // valid because their pane is UNIT HEIGHT (measured 1.750 × 0.990).
          // divide by the pane's HEIGHT — not its width — to normalise.
          const worldH = Math.tan((camera.fov * Math.PI) / 360) * 2 * GLASS_DEPTH
          // portrait tablet frame is NARROWER than the landscape pane — fit
          // the pane by WIDTH there so the shards never spill past the frame
          const paneScale = isPortrait()
            ? (worldH * SCREEN_FRACTION * frameAspect() * domFrameScale) / glass.paneSize.x
            : (worldH * SCREEN_FRACTION * domFrameScale) / glass.paneSize.y
          glass.mesh.scale.setScalar(paneScale)
          // their ratio = fit(q.ratio, 0, 1, 0, 1, ease.sineOut) where q spans
          // whiteFrameBreak THROUGH astronautDrop — the shatter keeps opening
          // out while he drops. ours completed inside the break alone.
          // their q = getRange("whiteFrameBreak", "astronautDrop")
          glass.setProgress(sineOut(clamp01((p - T.break[0]) / Math.max(1e-6, T.drop[1] - T.break[0]))))
          // their fragmentScale: fit(astronautDropRatio, .75, 1, 1, 0)
          glass.uniforms.u_fragmentScale.value = fit(dropR, 0.75, 1, 1, 0)
        }
      }

      // girders exist only past the title — the card/title scenes stay clean

      // ── their clone transform (updateTransforms, g > 0), verbatim:
      //   v.position.copy(main.position); v.rotation.copy(main.rotation)
      //   m = v.matrix × brownianMatrix          (wander RELATIVE to him)
      //   T = fit(clonesShowRatio, i*.3, .7+i*.3, 1, 0, sineInOut)
      //   pos.lerp(mainPos, T)                   (T=1 → sitting inside him)
      // amplitudes are theirs: position 12, rotation 10, freq .2 / .6
      const clonesShow = smoothstep01(0.18, 0.62, pBlack) * (wtGate > 0.5 ? 0 : 1)
      for (let i = 0; i < clones.length; i++) {
        const g = clones[i]
        g.visible = clonesShow > 0.001
        if (!g.visible) continue
        const n = i / Math.max(1, clones.length - 1)
        const T2 = fitE(clonesShow, n * 0.3, 0.7 + n * 0.3, 1, 0, sineInOut)
        // brownian offset in HIS local frame (their motion._matrix)
        const f = 0.2, s = i * 7.3
        // their amplitude 12 at a 25-unit camera distance ≈ 0.48 × distance;
        // scale to ours so the clones stay in frame as they peel off him
        const amp = camera.position.distanceTo(astronaut.position) * 0.48
        cloneOffset.set(
          (Math.sin(t * f + s) * 0.6 + Math.sin(t * f * 2.3 + s * 1.7) * 0.4) * amp,
          (Math.cos(t * f * 1.3 + s) * 0.6 + Math.sin(t * f * 1.9 + s * 2.1) * 0.4) * amp,
          (Math.sin(t * f * 0.8 + s * 1.4) * 0.6 + Math.cos(t * f * 2.7 + s) * 0.4) * amp,
        )
        cloneOffset.applyQuaternion(astronaut.quaternion)
        // start AT him, wander out, then lerp back by T
        g.position.copy(astronaut.position).add(cloneOffset).lerp(astronaut.position, T2)
        g.quaternion.copy(astronaut.quaternion)
        const rf = 0.6
        g.rotateX(Math.sin(t * rf + s) * (10 * Math.PI / 180) * (1 - T2))
        g.rotateY(Math.cos(t * rf * 1.2 + s) * (10 * Math.PI / 180) * (1 - T2))
        g.rotateZ(Math.sin(t * rf * 0.7 + s) * (10 * Math.PI / 180) * (1 - T2))
        for (const m of g.children) {
          ;((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
            Math.min(1, clonesShow * 3) * 0.32
        }
      }

      // finale dressing
      if (stickers) stickers.update(t, easeInOut(clamp01(pFinale * 1.8)) * (1 - pFade))
      if (stickers && stickers.group.visible) {
        stickers.group.position.set(astronaut.position.x, astronaut.position.y + 0.6, astronaut.position.z)
      }
      if (ledCard) {
        // their flicker: noisy light while the card message plays
        const flicker = Math.max(0, Math.sin(t * 23.0) * 0.3 + Math.sin(t * 7.7) * 0.3 + 0.6)
        // their _ = fit(astronautDropRatio, .9, 1, 0, 1, ease.cubicIn)
        const cardIn = cubicIn(fit(dropR, 0.9, 1, 0, 1))
        ledCard.update(t, cardIn * flicker * (1 - pFade))
      }

      // the drop: he falls out of the sequence toward the page below
      astronaut.position.y -= easeInOut(pFade) * 7

      // ── their frameBg drive. ONE overlay serves both the opening card
      // (blackFrameIn branch) and the closing laptop (whiteFrameOut branch),
      // exactly as their GoalSection.update() does. ──
      const inPhase = pIn < 1
      if (inPhase) {
        const vwPx = window.innerWidth
        const vhPx2 = Math.max(1, window.innerHeight)
        // their K: the rect slides up as blackFrameShow completes
        const K = vhPx2 * 0.2 * (1 - pShow)
        // their #home-goal-image-in measures 817 x 571 at a 1920 x 945 viewport
        // — height 0.604 of the viewport, aspect 1.432. my 560px width cap
        // squashed it to ~1.02 (nearly square), so the astronaut never fit.
        // card shrinks by the SAME factor as the frame/world, so the
        // astronaut's flight path stays proportioned to it on portrait —
        // and goes portrait-aspect there, like the frame
        const cardH = vhPx2 * (571 / 945) * frameShrink(vhPx2)
        const cardW = cardH * cardAspect()
        frameOverlay.setRect((vwPx - cardW) / 2, (vhPx2 - cardH) / 2 + K, cardW, cardH)
        frameOverlay.setViewport(vwPx, vhPx2)
        const u = frameOverlay.uniforms
        const E = pIn
        // their p = mix(1, diagonal / min(w,h), E): the card GROWS to fill
        // the screen as you fly into it
        const diagIn = Math.sqrt(vwPx * vwPx + vhPx2 * vhPx2)
        u.u_frameScale.value = 1 + (diagIn / Math.min(cardW, cardH) - 1) * E
        u.u_frameRotate.value = E * 0.4                    // their f = E × +0.4
        u.u_radiusScale.value = 1                          // their I = 1
        u.u_globalRadius.value = GLOBAL_RADIUS
        u.u_glowRadius.value = fit(E, 0, 1, 0.11, -0.5)    // their F
        u.u_glowUpperBound.value = fit(E, 0, 1, 0.25, 2)   // their k
        u.u_glowPow.value = fit(E, 0, 1, 0.06, 0.3)        // their L
        u.u_glowTint.value = 0
        ;(u.u_glowColor.value as THREE.Color).setStyle(BLACK)
          .lerp(new THREE.Color(OFF_WHITE), E)
        // their bgColor: the PAGE is off-white early, black once you are in
        ;(u.u_bgColor.value as THREE.Color).setStyle(p < 0.5 ? OFF_WHITE : BLACK)
        frameOverlay.visible = E < 1
      } else {
        const vwPx = window.innerWidth
        const vhPx2 = Math.max(1, window.innerHeight)
        // device rect: centred, their natural size
        const fH = fitFrameH(vhPx2)
        const fW = fH * frameAspect()
        // measured on lusion.co: xe = -1515, baseY = 7312, so their
        //   u = offsetY + xe            = scrollPixel - 8827
        //   v = -(imgOut.top + K - scrollPixel + imgOut.h/2 - vh/2 + u) = -K
        // the scroll terms cancel EXACTLY. their frame and camera are both
        // stationary through the break and the drop — the monitor only looks
        // like it rises because the astronaut falls past it. a moving frame
        // here is what made him read as floating.
        const K = vhPx2 * 0.2 * (1 - ph(p, 'show'))
        // their ce = max(0, offsetY - astronautDrop.pixelFrom). during the drop
        // `u` is clamped, so it can no longer cancel scroll and v becomes +ce:
        // the world and the frame RISE by ce. the astronaut then gets -ce added
        // on top, which cancels it exactly — he holds still while the monitor
        // climbs. that cancellation is why their raw .4 drop needs no scaling.
        // their ce = max(0, offsetY - astronautDrop.pixelFrom). during the drop
        // `u` hits its clamp and can no longer cancel scroll, so v becomes +ce:
        // the world, glass and frame RISE. the astronaut gets -ce added on top,
        // cancelling it exactly — he holds while the monitor climbs.
        ceP = RANGES ? ph(p, 'drop') * RANGES.items.astronautDrop.count : 0
        // the frame quad is drawn in screen space (gl_Position = position.xy),
        // so the camera offset does not move it — it needs ce applied directly
        // the frame quad is drawn in screen space, so the camera offset does
        // not carry it — ce is applied to its rect directly (their
        // frameBgMesh.update(-scrollPixel + u) with u clamped)
        frameOverlay.setRect((vwPx - fW) / 2, (vhPx2 - fH) / 2 + K - ceP, fW, fH)
        // their properties.cameraViewportOffsetY = v * (1 - E)
        frameShiftPx = (ceP - K) * (1 - outE)
        frameOverlay.setViewport(vwPx, vhPx2)
        const u = frameOverlay.uniforms
        u.u_frameScale.value = domFrameScale
        u.u_frameRotate.value = outE * -0.3          // their f = E × −0.3
        // their two branches on `oe` (whiteFrameBreak→astronautDrop ratio):
        // BEFORE the drop they leave F=k=L=0 and D=0.8 with a black glow —
        // and L=0 matters, because pow(x, 0) == 1 keeps the glow term OFF.
        // I was always using the post-drop ramps, so glowPow=0.3 with
        // glowUpperBound=0 made linearStep divide by zero → 0 → the glow
        // colour (black) was painted over the whole frame: the black screen.
        // their oe = q.ratio, the same whiteFrameBreak→astronautDrop span
        const oe = clamp01((p - T.break[0]) / Math.max(1e-6, T.drop[1] - T.break[0]))
        if (oe <= 0) {
          u.u_glowRadius.value = 0
          u.u_glowUpperBound.value = 0
          u.u_glowPow.value = 0
          u.u_glowTint.value = 0.8
          ;(u.u_glowColor.value as THREE.Color).setStyle('#000000')
        } else {
          u.u_glowRadius.value = -0.5                          // their F
          let k2 = fit(oe, 0, 0.15, 0, 0.8)
          k2 = fit(oe, 0.15, 0.3, k2, 2)
          u.u_glowUpperBound.value = k2                        // their k
          let L2 = fit(oe, 0, 0.1, 0.3, 1)
          L2 = fit(oe, 0.1, 1, L2, 0.2)
          u.u_glowPow.value = L2                               // their L
          u.u_glowTint.value = 0.5                             // their D
          let ee = fit(oe, 0, 0.1, 1, 0)
          ee = fit(oe, 0.1, 0.8, ee, 0.85)
          ;(u.u_glowColor.value as THREE.Color).setStyle('#1a2ffb')
            .lerp(new THREE.Color('#000000'), ee)
        }
        // their u_bgColor = C < .5 ? offWhite : black, where C = saturate(
        // homeGoalSectionRanges.ratio) — the OVERALL sequence ratio. so past
        // halfway (the whole laptop phase) the surround is black. we were
        // copying the scene background, which is white in the white tunnel.
        ;(u.u_bgColor.value as THREE.Color).setStyle(p < 0.5 ? OFF_WHITE : BLACK)
        u.u_radiusScale.value = 0                        // their I = 0 out-phase
        // their rule: frame exists while E < 1, gone once the drop starts
        // their frameBgMesh.visible = E < 1 && te < 1
        frameOverlay.visible = outE < 1 && te < 1
        const W2 = window as unknown as { __noOverlay?: boolean; __noWhite?: boolean; __noGlass?: boolean }
        if (W2.__noOverlay) frameOverlay.visible = false
        ;(window as unknown as { __ov?: unknown }).__ov = frameOverlay
        if (whiteTunnel && W2.__noWhite) whiteTunnel.container.visible = false
      }

      // their GoalTunnels.update, verbatim:
      //   whiteTunnelRatio == 1 && astronautDropRatio < 1
      //     && preUfxContainer.add(goalTunnelAstronauts.container)
      // whiteTunnelRatio is the *whiteTunnel range* ratio — our 'vortex' — so
      // he joins the over-layer at the START of the corridor, not part-way
      // through the break. within that container their order is
      // frameBgMesh(-1) → astronaut(0) → card(100) → glass(1000), so the pane
      // still draws over him until it shatters.
      // their condition only ADDS to preUfxContainer — nothing takes him out
      // when it stops being true. resetAstronautLayer() is a separate call made
      // on stage teardown. so once he joins the over-layer he STAYS, keeping the
      // -ce cancellation through the whole wait. recomputing it per-frame (as I
      // did) dropped him out the instant dropR hit 1 and the world's +ce threw
      // him off the top of the screen.
      if (phSpan(p, 'vortex', 'corridor') >= 1 && dropR < 1) astroLatched = true
      if (phSpan(p, 'vortex', 'corridor') < 1 || pFade >= 1) astroLatched = false
      const overLayer = astroLatched
      if (overLayer && astronaut.parent !== overScene) overScene.add(astronaut)
      else if (!overLayer && astronaut.parent !== scene) scene.add(astronaut)

      ;(window as any).__paths = (() => {
        const b = (pp: FlightPath | null) => {
          if (!pp) return null
          let z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9
          for (const v of pp.pos) { z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y) }
          return { z: [+z0.toFixed(2), +z1.toFixed(2)], y: [+y0.toFixed(2), +y1.toFixed(2)], n: pp.pos.length }
        }
        return { inPath: b(inPath), outPath: b(outPath) }
      })()
      ;(window as any).__scaleDbg = (() => {
        astronaut.updateMatrixWorld(true)
        const cm = astronaut.parent === overScene ? astroCam : camera
        // how much NDC does ONE world unit of height occupy at his position?
        const a0 = astronaut.position.clone().project(cm)
        const a1 = astronaut.position.clone().add(new THREE.Vector3(0, 1, 0)).project(cm)
        // true world bbox from the live skinned buffer, through the part matrix
        let y0 = 1e9, y1 = -1e9
        const v = new THREE.Vector3()
        for (const part of parts) {
          const arr = (part.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
          for (let i = 0; i < arr.length; i += 3) {
            v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(part.mesh.matrixWorld)
            if (v.y < y0) y0 = v.y
            if (v.y > y1) y1 = v.y
          }
        }
        return {
          ndcPerWorldUnit: +(a1.y - a0.y).toFixed(4),
          groupScale: astronaut.scale.toArray(),
          partScale: parts[0] ? parts[0].mesh.scale.toArray() : null,
          worldBboxY: [+y0.toFixed(3), +y1.toFixed(3)],
          worldHeight: +(y1 - y0).toFixed(3),
          camPos: camera.position.toArray().map((n) => +n.toFixed(2)),
          fov: +camera.fov.toFixed(1),
          hasViewOffset: !!(camera as any).view && (camera as any).view.enabled,
        }
      })()
      ;(window as any).__lightDbg = {
        ambient: (astroShared.u_ambientColor.value as THREE.Color).toArray().map((v) => +v.toFixed(3)),
        ambientHex: '#' + (astroShared.u_ambientColor.value as THREE.Color).getHexString(),
        sunFactor: astroShared.u_sunFactor.value,
        blackTunnelRatio: astroShared.u_blackTunnelRatio.value,
        colorMgmt: THREE.ColorManagement.enabled,
        toneMapping: renderer.toneMapping,
      }
      ;(window as any).__ovDbg = {
        visible: frameOverlay.visible,
        bg: '#' + (frameOverlay.uniforms.u_bgColor.value as THREE.Color).getHexString(),
        scale: +(frameOverlay.uniforms.u_frameScale.value as number).toFixed(2),
        domWH: (frameOverlay.uniforms.u_domWH.value as THREE.Vector2).toArray().map((v) => Math.round(v)),
        radiusScale: frameOverlay.uniforms.u_radiusScale.value,
        glowPow: frameOverlay.uniforms.u_glowPow.value,
        glowUB: frameOverlay.uniforms.u_glowUpperBound.value,
        glowColor: '#' + (frameOverlay.uniforms.u_glowColor.value as THREE.Color).getHexString(),
      }
      ;(window as any).__astroDbg = {
        parent: astronaut.parent === overScene ? 'overScene' : (astronaut.parent === scene ? 'scene' : String(astronaut.parent && astronaut.parent.type)),
        astroVis: astronaut.visible,
        partsVis: parts.map((pp) => pp.mesh.visible),
        showRatio: astroShared.u_showRatio ? astroShared.u_showRatio.value : null,
        matOpacity: parts[0] ? (parts[0].mesh.material as THREE.Material).opacity : null,
        pos: [+astronaut.position.x.toFixed(2), +astronaut.position.y.toFixed(2), +astronaut.position.z.toFixed(2)],
      }
      ;(window as any).__local = (() => {
        // the SKINNED local positions, straight out of the geometry buffer —
        // compare against the bind pose (feet -0.015, head 1.845)
        let y0 = 1e9, y1 = -1e9
        for (const part of parts) {
          const a = part.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
          const arr = a.array as Float32Array
          for (let i = 1; i < arr.length; i += 3) { if (arr[i] < y0) y0 = arr[i]; if (arr[i] > y1) y1 = arr[i] }
        }
        return { skinnedLocalY: [+y0.toFixed(3), +y1.toFixed(3)], bindY: [-0.015, 1.845] }
      })()
      ;(window as any).__screen = (() => {
        // project the SKINNED mesh bounds — what is actually visible, rather
        // than the root transform I have been sampling all along
        const box = new THREE.Box3()
        for (const part of parts) box.expandByObject(part.mesh)
        if (!isFinite(box.min.y)) return null
        const cm = astronaut.parent === overScene ? astroCam : camera
        const pts: number[] = []
        for (const yy of [box.min.y, box.max.y]) {
          const v = new THREE.Vector3((box.min.x + box.max.x) / 2, yy, (box.min.z + box.max.z) / 2)
          v.project(cm); pts.push(v.y)
        }
        return { bottom: +Math.min(...pts).toFixed(2), top: +Math.max(...pts).toFixed(2) }
      })()
      ;(window as any).__size = (() => {
        const box = new THREE.Box3()
        for (const part of parts) box.expandByObject(part.mesh)
        const sz = new THREE.Vector3(); box.getSize(sz)
        const camDist = 25 - astronaut.position.z
        const visH = Math.tan((camera.fov * Math.PI) / 360) * 2 * Math.max(0.001, camDist)
        return {
          astroH: +sz.y.toFixed(3), astroW: +sz.x.toFixed(3),
          astroZ: +astronaut.position.z.toFixed(2), camDist: +camDist.toFixed(2),
          visHAtAstro: +visH.toFixed(3),
          astroFracOfScreen: +(sz.y / visH).toFixed(3),
          paneH: glass ? +(glass.mesh.scale.y * glass.paneSize.y).toFixed(3) : null,
          fov: +camera.fov.toFixed(1),
        }
      })()
      ;(window as any).__depth = {
        camZ: camera.position.z, astroZ: astronaut.position.z, lead,
        glassZ: glass ? glass.mesh.position.z : null,
        glassVis: glass ? glassRig.visible : false,
        rootZ: rootP.z,
      }
      const fade = fadeRef.current
      if (fade) fade.style.opacity = `${pFade}`

      const afterScene = () => {
        // must NOT clear: we are compositing on top of the scene already in
        // this render target
        const prevAuto = renderer.autoClear
        renderer.autoClear = false
        if (frameOverlay.visible) renderer.render(frameOverlay.scene, frameOverlay.camera)
        if (overScene.children.length) {
          renderer.clearDepth()
          renderer.render(overScene, astroCam)
        }
        renderer.autoClear = prevAuto
      }
      if (glass && glassRig.visible) {
        glass.uniforms.u_backgroundTexture.value = bloom.sceneTexture
        bloom.render(scene, camera, afterScene)
        renderer.autoClear = false
        renderer.clearDepth()
        renderer.render(glassScene, camera)
        renderer.autoClear = true
      } else {
        bloom.render(scene, camera, afterScene)
      }
    }
    tick()
    // DEBUG: lets an automated browser drive frames when rAF is throttled
    ;(window as unknown as { __step?: () => void }).__step = () => tickBody()
    ;(window as unknown as { __clones?: () => unknown }).__clones = () => ({
      visible: clones.map((g) => g.visible),
      distFromAstro: clones.map((g) => +g.position.distanceTo(astronaut.position).toFixed(2)),
      ndc: clones.map((g) => {
        const v = g.position.clone().project(camera)
        return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
      }),
      onScreen: clones.map((g) => {
        const v = g.position.clone().project(camera)
        return Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z > -1 && v.z < 1
      }),
      opacity: clones.map((g) => +((g.children[0] as THREE.Mesh)?.material as THREE.MeshBasicMaterial)?.opacity.toFixed(2)),
      astroPos: astronaut.position.toArray().map((v) => +v.toFixed(1)),
      parentIsScene: astronaut.parent === scene,
    })
    ;(window as unknown as { __bg?: () => string }).__bg = () =>
      '#' + bgColor.getHexString() + ' clearAlpha=' + renderer.getClearAlpha()
    ;(window as unknown as { __ndc?: () => { x: number; y: number } }).__ndc = () => {
      const v = new THREE.Vector3()
      astronaut.getWorldPosition(v)
      // he is drawn with astroCam once he is in the over-layer, so that is the
      // camera his on-screen position must be read through
      v.project(astronaut.parent === overScene ? astroCam : camera)
      return { x: +v.x.toFixed(3), y: +v.y.toFixed(3) }
    }

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      pmrem.dispose()
      bgTarget.dispose()
      bloom.dispose()
      renderer.dispose()
      for (const s of [glassScene, quadScene, scene]) {
        s.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose()
        })
      }
    }
  }, [])

  return (
    <div ref={wrapRef} className="vt-wrap">
      <div ref={rangeInRef} className="vt-range-in" aria-hidden="true" />
      <div ref={rangeOutRef} className="vt-range-out" aria-hidden="true" />
      <div className="vt-sticky">
        <canvas ref={canvasRef} className="vt-canvas" />
        <div ref={cardRef} className="vt-card">
          <div ref={cardUiRef} className="vt-card-ui">
            <span className="vt-card-tag">002 · INTO THE VOID</span>
            <span className="vt-card-hint">scroll</span>
          </div>
        </div>
        <div ref={wordsRef} className="vt-words" aria-hidden="true">
          {TITLE_LINES.map((line, i) => (
            <div key={i} className="vt-words-line">
              {line.map((w) => <span key={w}>{w}</span>)}
            </div>
          ))}
        </div>
        <div ref={haloRef} className="vt-halo" aria-hidden="true" />
        <div className="vt-vignette" aria-hidden="true" />
        <div ref={laptopRef} className="vt-laptop" aria-hidden="true">
          <div className="vt-laptop-screen" />
          <div className="vt-laptop-base" />
        </div>
        <div ref={fadeRef} className="vt-fade" aria-hidden="true" />
        {status === 'loading' && <div className="vt-status">LOADING ///</div>}
        {status === 'error' && <div className="vt-status">ASSET LOAD FAILED — check console</div>}
      </div>
    </div>
  )
}
