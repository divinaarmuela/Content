'use client'

import { useEffect, useRef, useState } from 'react'
import { useLamaReady } from './ready'

// WebGL2 dither backdrop, the reference site's exact mechanism: the screen
// splits into cells of 4x4 dots and the luminance of the backdrop video
// (plus drifting noise) decides how many dots light up per cell through an
// ordered threshold matrix. The video is never a DOM layer — after the
// preloader, a reveal progress sweeps through the same threshold matrix and
// the dots dissolve into the actual video pixels. A cursor trail texture
// lights dots along the pointer's wake. Swap VIDEO_SRC only.
const VIDEO_SRC = '/hero_web.mp4'
// band2 ("What we do") renders its own video as grey dither — a different
// clip from the hero
const VIDEO2_SRC = '/website-landscape.mp4'

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_video2;
uniform sampler2D u_trail;
uniform float u_hasVideo;
uniform float u_hasVideo2;
uniform vec2 u_resolution;
uniform vec2 u_videoSize;
uniform vec2 u_video2Size;
uniform float u_time;
uniform float u_topProgress;
uniform float u_bottomProgress;
uniform float u_top2;
uniform float u_bottom2;
uniform float u_videoReveal;
uniform float u_pixelSize;
out vec4 fragColor;

float rand(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 ip = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float res = mix(
    mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
    mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x), u.y);
  return res * res;
}

// object-fit: cover mapping for a video texture of the given size
vec2 coverUv(vec2 uv, vec2 videoSize) {
  float canvasAspect = u_resolution.x / u_resolution.y;
  float videoAspect = videoSize.x / max(videoSize.y, 1.0);
  vec2 scale = canvasAspect > videoAspect
    ? vec2(1.0, videoAspect / canvasAspect)
    : vec2(canvasAspect / videoAspect, 1.0);
  return (uv - 0.5) * scale + 0.5;
}

// block order, mirroring the reference's drawLLLogo sequence: the 7 glyph
// blocks appear FIRST (orders 0-6) so a dissolving cell passes through the
// idle texture pattern, then the remaining 9 blocks fill the cell to solid
float orderThreshold(vec2 sub) {
  int x = int(sub.x);
  int y = int(sub.y);
  int m[16] = int[16](
    0, 7, 9, 2,
    4, 1, 11, 6,
    3, 8, 13, 5,
    10, 14, 12, 15);
  return (float(m[y * 4 + x]) + 0.5) / 16.0;
}

// idle mark: 7 of the 16 blocks per cell — an "M"-like mini-mark (two
// pillars + centre block), the same visual character as the reference's
// grid of tiny logo glyphs, without using their mark
float glyphBlock(vec2 sub) {
  int x = int(sub.x);
  int y = int(sub.y);
  int g[16] = int[16](
    1, 0, 0, 1,
    1, 1, 0, 1,
    1, 0, 0, 1,
    0, 0, 0, 0);
  return float(g[y * 4 + x]);
}

void main() {
  vec2 frag = v_uv * u_resolution;
  vec2 cell = floor(frag / u_pixelSize);
  float subSize = u_pixelSize / 4.0;
  vec2 sub = floor(mod(frag, u_pixelSize) / subSize);
  vec2 cellUv = (cell + 0.5) * u_pixelSize / u_resolution;

  // cursor wake: local fluid speed — recolors glyph blocks, adds no density
  float trailV = texture(u_trail, vec2(cellUv.x, 1.0 - cellUv.y)).r;
  float lum = 0.0;

  vec3 videoCol = vec3(0.0);
  if (u_hasVideo > 0.5) {
    // full-res sample is what the dissolved cells display in the hero band
    vec2 fuv = coverUv(v_uv, u_videoSize);
    videoCol = texture(u_video, vec2(fuv.x, 1.0 - fuv.y)).rgb;
  }
  if (u_hasVideo2 > 0.5) {
    // band2's clip drives dither density — contrast-lifted so the footage
    // shapes actually read through the dots
    vec2 cuv = coverUv(cellUv, u_video2Size);
    float v2 = dot(texture(u_video2, vec2(cuv.x, 1.0 - cuv.y)).rgb, vec3(0.299, 0.587, 0.114));
    lum += pow(v2, 0.65) * 0.95;
  }

  float threshold = orderThreshold(sub);

  // idle surface: the reference draws a 7-block glyph in EVERY cell at full
  // constant grey — a dense uniform carpet of square blocks that reads as a
  // grey fabric. The cursor trail / video luminance light up the remaining
  // blocks of the 16-block full pattern.
  float glyph = glyphBlock(sub);
  float extra = step(threshold, lum);

  // reference palette: charcoal base, grey dots, cream cursor
  vec3 ink = vec3(0.102, 0.110, 0.110);   // #1a1c1c bgPrimary
  vec3 grey = vec3(0.275, 0.275, 0.275);  // #464646 content dots
  vec3 cream = vec3(0.976, 0.957, 0.922); // #f9f4eb cursor

  // reference mechanism: the canvas belongs to the hero SECTION — a vertical
  // band between two progress values with a noise-warped edge. The grid, the
  // cursor effect, and the video all live inside the band and wipe away
  // together at its wavy edge; outside it the page is clean flat ink.
  // taller gap + wider noise warp = a high, slow dither edge like theirs
  float gap = 0.32;
  float noiseVal = 0.5 * noise(cellUv * 8.0);
  float yW = cellUv.y * (1.0 - 2.0 * 0.15) + 0.15 + 0.15 * noiseVal;
  float band = smoothstep((yW * (1.0 - gap)) - gap, yW * (1.0 - gap), u_topProgress - gap)
             - smoothstep((yW * (1.0 - gap)) - gap, yW * (1.0 - gap), u_bottomProgress - gap);
  band = clamp(band, 0.0, 1.0);

  // second band: a later section's backdrop — same wave mechanics, but its
  // video renders AS grey dither through the grid, never as crisp footage
  float band2 = smoothstep((yW * (1.0 - gap)) - gap, yW * (1.0 - gap), u_top2 - gap)
              - smoothstep((yW * (1.0 - gap)) - gap, yW * (1.0 - gap), u_bottom2 - gap);
  band2 = clamp(band2, 0.0, 1.0);

  // grid blocks dissolve at the band edges in dither order
  float gridOn = step(threshold, max(band, band2) * 1.0625);
  // luminance "extra" blocks exist ONLY in band2 (video-as-dither section);
  // the hero wave edge is purely video blocks over the plain glyph grid
  float dotAmt = max(glyph, extra * step(0.01, band2)) * gridOn;
  vec3 dithered = mix(ink, grey, dotAmt);

  // hero band only: the crisp video dissolves per-block through the wave
  float alpha = u_hasVideo > 0.5 ? step(threshold * 0.999, band * u_videoReveal) : 0.0;
  vec3 col = mix(dithered, videoCol * 0.72, alpha);

  // cursor pass — the reference's exact model: block reveal driven by local
  // fluid SPEED, progressive like drawLLLogo (each of the 7 glyph blocks
  // turns on at a higher speed threshold), coloured cursorRGB cream.
  // Suppressed where the crisp hero video is showing (alpha).
  float gOrder = orderThreshold(sub) * 16.0;   // glyph blocks own orders 0-6
  float cursorOn = glyph * step(gOrder / 7.0, trailV) * (1.0 - alpha);
  col = mix(col, cream, cursorOn);
  fragColor = vec4(col, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
  return s
}

export default function LamaBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const grainRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const video2Ref = useRef<HTMLVideoElement>(null)
  const [fallback, setFallback] = useState(false)
  const ready = useLamaReady()
  const readyRef = useRef(false)
  readyRef.current = ready

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    const video2 = video2Ref.current
    if (!canvas || !video || !video2) return
    const gl = canvas.getContext('webgl2')
    if (!gl) { setFallback(true); return }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { video.pause(); video2.pause() }

    let program: WebGLProgram
    try {
      program = gl.createProgram()!
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link')
    } catch {
      setFallback(true)
      return
    }
    gl.useProgram(program)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const makeTex = () => {
      const t = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      return t
    }
    const videoTex = makeTex()
    const video2Tex = makeTex()
    const trailTex = makeTex()

    // cursor velocity field — the reference's model: mousemove splats speed
    // into a small field with a tight gaussian radius; the field decays by
    // (1 - min(0.5, dt/250)) per frame like their advection pass. Intensity
    // is SPEED, so the effect flares under fast movement and dies fast.
    const FW = 96
    const FH = 54
    const field = new Float32Array(FW * FH)
    const fieldBytes = new Uint8Array(FW * FH)
    const SPLAT_R = 3.2
    const mouse = { x: -1, y: -1 }
    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth) * FW
      const ny = (e.clientY / window.innerHeight) * FH
      if (mouse.x >= 0) {
        const speed = Math.min(1.2, Math.hypot(nx - mouse.x, ny - mouse.y) / 3)
        const x0 = Math.max(0, Math.floor(nx - SPLAT_R * 2))
        const x1 = Math.min(FW - 1, Math.ceil(nx + SPLAT_R * 2))
        const y0 = Math.max(0, Math.floor(ny - SPLAT_R * 2))
        const y1 = Math.min(FH - 1, Math.ceil(ny + SPLAT_R * 2))
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const d2 = (x - nx) * (x - nx) + (y - ny) * (y - ny)
            const infl = Math.exp(-d2 / (SPLAT_R * SPLAT_R))
            const i = y * FW + x
            field[i] = Math.min(1.3, field[i] + infl * speed * 0.8)
          }
        }
      }
      mouse.x = nx
      mouse.y = ny
    }
    window.addEventListener('mousemove', onMove, { passive: true })

    const u = (name: string) => gl.getUniformLocation(program, name)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    let lastUpload = 0
    let lastFrame = performance.now()
    let hasFrame = false
    let hasFrame2 = false
    let top = 0
    let bottom = 0
    let videoReveal = 0
    const start = performance.now()
    // band2 follows the services section ("What we do") — its video renders
    // as grey dither behind the content, like the reference's section grids
    const band2El = document.querySelector<HTMLElement>('[data-lama-title="WHAT WE DO"]')

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)

      // video texture uploads only need ~15fps; everything else is per-frame
      if (now - lastUpload >= 66) {
        lastUpload = now
        if (video.readyState >= 2 && !video.paused) {
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, videoTex)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
          hasFrame = true
        }
        if (video2.readyState >= 2 && !video2.paused) {
          gl.activeTexture(gl.TEXTURE2)
          gl.bindTexture(gl.TEXTURE_2D, video2Tex)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video2)
          hasFrame2 = true
        }
      }

      // decay the velocity field exactly like their advection pass, then
      // upload it as an R8 texture
      const dt = Math.min(50, now - lastFrame)
      lastFrame = now
      const keep = reduced ? 0 : 1 - Math.min(0.5, dt / 250)
      for (let i = 0; i < field.length; i++) {
        field[i] *= keep
        fieldBytes[i] = Math.min(255, field[i] * 255)
      }
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, trailTex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, FW, FH, 0, gl.RED, gl.UNSIGNED_BYTE, fieldBytes)

      // entrance: the top-progress wave eases in after the preloader (their
      // reveal timeline); exit: bottom-progress is SCRUBBED — tied linearly
      // to scroll like their ScrollTrigger, so the wave tracks the section
      // edge exactly and never runs ahead of the header
      const vh = window.innerHeight
      const topTarget = readyRef.current ? 1 : 0
      top += (topTarget - top) * (reduced ? 1 : 0.03)
      // the wave edge must ride AHEAD of the incoming section's top edge so
      // the dither dissolve is visible in the gap above it, not hidden below
      bottom = Math.min(Math.max((window.scrollY / vh) * 1.25, 0), 1.6)
      // crisp-video dissolve inside the hero band, once footage is ready
      const revealTarget = readyRef.current && hasFrame ? 1 : 0
      videoReveal += (revealTarget - videoReveal) * (reduced ? 1 : 0.035)
      // band2 scrubs with the services section's actual screen position
      let top2 = 0
      let bottom2 = 0
      if (band2El) {
        const r = band2El.getBoundingClientRect()
        // their exact ScrollTrigger mapping (scrub, end: 'top top') — and the
        // band formula's y-warp keeps the wave edge at or below the section's
        // top edge, so it can never wash over the rows above
        top2 = Math.min(Math.max(1 - r.top / vh, 0), 1.2)
        // their exact exit scrub (bottom bottom → bottom -10%): with the
        // marquee transparent over the canvas there is no wall to beat — the
        // wave dissolves gradually beneath it, like the reference
        bottom2 = Math.min(Math.max((1 - r.bottom / vh) * 1.45, 0), 1.6)
      }

      gl.uniform1i(u('u_video'), 0)
      gl.uniform1i(u('u_trail'), 1)
      gl.uniform1i(u('u_video2'), 2)
      gl.uniform1f(u('u_hasVideo'), hasFrame ? 1 : 0)
      gl.uniform1f(u('u_hasVideo2'), hasFrame2 ? 1 : 0)
      gl.uniform2f(u('u_resolution'), canvas.width, canvas.height)
      gl.uniform2f(u('u_videoSize'), video.videoWidth || 1, video.videoHeight || 1)
      gl.uniform2f(u('u_video2Size'), video2.videoWidth || 1, video2.videoHeight || 1)
      gl.uniform1f(u('u_time'), reduced ? 0 : (now - start) / 1000)
      gl.uniform1f(u('u_topProgress'), top)
      gl.uniform1f(u('u_bottomProgress'), bottom)
      gl.uniform1f(u('u_top2'), top2)
      gl.uniform1f(u('u_bottom2'), bottom2)
      gl.uniform1f(u('u_videoReveal'), videoReveal)
      // their GRID_SIZE = 8 in PHYSICAL canvas pixels (no dpr multiply) —
      // this is what makes their texture finer and denser than a CSS-px grid
      gl.uniform1f(u('u_pixelSize'), 8)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  // upper grain canvas: sparse flickering specks above the content, the
  // counterpart of the reference's js-upper-canvas dither overlay
  useEffect(() => {
    const canvas = grainRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const paint = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(249,244,235,0.05)'
      const n = Math.round((canvas.width * canvas.height) / 9000)
      for (let i = 0; i < n; i++) {
        ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1)
      }
    }
    paint()
    const id = reduced ? 0 : window.setInterval(paint, 120)
    return () => { window.clearInterval(id); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <div aria-hidden="true">
      {/* texture source only — the shader renders it, never the DOM */}
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        autoPlay
        muted
        loop
        playsInline
        crossOrigin="anonymous"
        onError={() => setFallback(true)}
        className="fixed h-px w-px opacity-0 pointer-events-none"
      />
      <video
        ref={video2Ref}
        src={VIDEO2_SRC}
        autoPlay
        muted
        loop
        playsInline
        crossOrigin="anonymous"
        className="fixed h-px w-px opacity-0 pointer-events-none"
      />
      <div className="fixed inset-0 z-0 pointer-events-none bg-ink">
        {fallback ? (
          <div className="absolute inset-0 bg-lama-dots [background-size:4px_4px] opacity-60" />
        ) : (
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        )}
      </div>
      <canvas ref={grainRef} className="fixed inset-0 z-[15] h-full w-full pointer-events-none" />
    </div>
  )
}
