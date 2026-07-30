import * as THREE from 'three'

/**
 * Port of Lusion's frameBgMesh (GoalSection) — their device-frame overlay.
 *
 * A fullscreen quad drawn ON TOP of the 3D scene that fills with the page
 * background and cuts a rounded-rect HOLE where the DOM device sits: you see
 * the tunnel through the hole. u_frameScale zooms the hole (mix(1, diag/min,
 * E)) so at E=1 the hole covers everything (pure 3D) and at E=0 it is the real
 * device size. Shaders are their frameBgVert / frameBgFrag, verbatim.
 */

const VERT = /* glsl */ `
uniform vec2 u_viewportResolution;
uniform vec2 u_frameOffset;
uniform float u_frameScale;
uniform float u_frameRotate;
uniform vec2 u_domXY;
uniform vec2 u_domWH;
uniform vec2 u_dom2Offset;
uniform vec2 u_dom2WH;
varying vec2 v_uv;
varying vec2 v_uv2;
mat2 getRotation2D(float a) { float s = sin(a); float c = cos(a); return mat2(c, -s, s, c); }
void main() {
  v_uv = position.xy * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  v_uv = (v_uv * u_viewportResolution - u_domXY - u_domWH * 0.5);
  v_uv -= u_frameOffset;
  v_uv = getRotation2D(u_frameRotate) * v_uv;
  v_uv /= u_frameScale;
  v_uv2 = v_uv + (-u_dom2Offset);
  v_uv2 = (v_uv2 + u_dom2WH * 0.5) / u_dom2WH;
  v_uv = (v_uv + u_domWH * 0.5) / u_domWH;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
uniform sampler2D u_dom2Texture;
uniform vec3 u_bgColor;
uniform vec2 u_domWH;
uniform vec2 u_dom2WH;
uniform float u_globalRadius;
uniform float u_radiusScale;
uniform vec3 u_glowColor;
uniform float u_glowRadius;
uniform float u_glowUpperBound;
uniform float u_glowPow;
uniform float u_glowTint;
varying vec2 v_uv;
varying vec2 v_uv2;
float linearStep(float edge0, float edge1, float x) { return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0); }
float sdRoundedBox(in vec2 p, in vec2 b, in float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
float getRoundedCornerMask(vec2 uv, vec2 size, float radius, float ratio) {
  vec2 halfSize = size * 0.5;
  float maxDist = length(halfSize);
  float minSize = min(halfSize.x, halfSize.y);
  float maxSize = max(halfSize.x, halfSize.y);
  float t = ratio * maxDist;
  radius = mix(minSize * linearStep(0., minSize, t), radius, linearStep(maxSize, maxDist, t));
  halfSize = min(halfSize, vec2(t));
  float d = sdRoundedBox((uv - .5) * size, halfSize, radius);
  float w = max(fwidth(d), 1e-3);
  return 1.0 - smoothstep(0.0, w, d);
}
float sdBox(in vec2 p, in vec2 b) {
  vec2 w = abs(p) - b;
  float g = max(w.x, w.y);
  return (g > 0.0) ? length(max(w, 0.0)) : g;
}
void main() {
  vec3 map = texture2D(u_dom2Texture, v_uv2).rgb;
  float opacity = 1. - getRoundedCornerMask(v_uv, u_domWH, u_globalRadius * u_radiusScale, 1.);
  vec3 color = u_bgColor;
  vec2 lightPos = vec2(2., 1.5);
  vec2 tabletSize = vec2(u_domWH.x / u_domWH.y, 1.);
  float tabletRadiusOffset = 0.05;
  vec2 pos = (v_uv * 2. - 1.) * tabletSize;
  float dist = sdBox(pos, tabletSize - tabletRadiusOffset) - u_glowRadius - tabletRadiusOffset;
  color = mix(u_glowColor, color, pow(linearStep(0., u_glowUpperBound, dist), u_glowPow));
  color = mix(color, mix(map.ggg, map.ggg * u_glowColor, u_glowTint), 1. - map.r);
  gl_FragColor = vec4(color, opacity);
}
`

/** placeholder device art (their _placeholderTexture2 is a DOM <img>) */
function makeDeviceTexture(): THREE.CanvasTexture {
  const W = 1024, H = 640
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!
  // shader reads: map.r == 1 → keep bg; map.r == 0 → draw map.ggg (device)
  g.fillStyle = '#ffffff' // r=1 → transparent to bg
  g.fillRect(0, 0, W, H)
  const bodyW = W * 0.86, bodyH = H * 0.74
  const x = (W - bodyW) / 2, y = (H - bodyH) / 2 - H * 0.03
  // device body: r=0 (draw), g = brightness of the chassis
  const r = 26
  g.fillStyle = '#0a2a2a'
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + bodyW, y, x + bodyW, y + bodyH, r)
  g.arcTo(x + bodyW, y + bodyH, x, y + bodyH, r)
  g.arcTo(x, y + bodyH, x, y, r)
  g.arcTo(x, y, x + bodyW, y, r)
  g.closePath()
  g.fill()
  // laptop base
  g.fillStyle = '#062020'
  g.fillRect(x - bodyW * 0.06, y + bodyH, bodyW * 1.12, H * 0.035)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

export type FrameOverlay = {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  uniforms: Record<string, THREE.IUniform>
  visible: boolean
  /** their syncRect(left, top, width, height) in CSS px */
  setRect: (l: number, t: number, w: number, h: number) => void
  setViewport: (w: number, h: number) => void
}

export function createFrameOverlay(): FrameOverlay {
  const uniforms: Record<string, THREE.IUniform> = {
    u_bgColor: { value: new THREE.Color(0, 0, 0) },
    u_frameOffset: { value: new THREE.Vector2() },
    u_frameScale: { value: 1 },
    u_frameRotate: { value: 0 },
    u_radiusScale: { value: 1 },
    u_glowColor: { value: new THREE.Color(0, 0, 0) },
    u_glowRadius: { value: 0.11 },
    u_glowUpperBound: { value: 0.5 },
    u_glowPow: { value: 0.1 },
    u_glowTint: { value: 0 },
    u_dom2Offset: { value: new THREE.Vector2() },
    u_dom2WH: { value: new THREE.Vector2(1, 1) },
    u_dom2Texture: { value: makeDeviceTexture() },
    u_viewportResolution: { value: new THREE.Vector2(1, 1) },
    u_globalRadius: { value: 24 },
    u_domXY: { value: new THREE.Vector2() },
    u_domWH: { value: new THREE.Vector2(1, 1) },
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // colour blends normally; ALPHA is left untouched so the bloom mask in
    // the target's alpha channel survives this overlay
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })

  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  return {
    scene,
    camera,
    uniforms,
    visible: false,
    setRect(l, t, w, h) {
      ;(uniforms.u_domXY.value as THREE.Vector2).set(l, t)
      ;(uniforms.u_domWH.value as THREE.Vector2).set(w, h)
      // device art rect: the laptop body fills 0.86 × 0.74 of the texture, so
      // scale the rect until the body sits ~15% proud of the screen hole —
      // otherwise the bezel lands exactly on the hole edge and is invisible
      ;(uniforms.u_dom2WH.value as THREE.Vector2).set(w * (1.15 / 0.86), h * (1.15 / 0.74))
      ;(uniforms.u_dom2Offset.value as THREE.Vector2).set(0, 0)
    },
    setViewport(w, h) {
      ;(uniforms.u_viewportResolution.value as THREE.Vector2).set(w, h)
    },
  }
}
