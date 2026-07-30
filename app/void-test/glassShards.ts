import * as THREE from 'three'
import { loadBuf } from './bufLoader'

/**
 * Port of Lusion's GoalTunnelGlass — the shattering crystal screen.
 *
 * broken_glass.buf: one mesh, 946 shard pieces (per-vertex `piece` index),
 * vertex positions relative to each piece's pivot.
 * broken_glass_animation.buf: 15 frames × 946 pieces of (quat, position),
 * frame-major, uploaded as two 946×15 float data textures and scrubbed with
 * u_frameFrom/u_frameTo/u_frameRatio — exactly their pipeline.
 *
 * The fragment shader is their crystal look, ported verbatim: faceted normals
 * from screen-space derivatives, screen-space refraction of the already-
 * rendered scene, and an angle-keyed rainbow iridescence.
 */

export const GLASS_PIECES = 946
export const GLASS_FRAMES = 15

const vertexShader = /* glsl */ `
uniform sampler2D u_positionTexture;
uniform sampler2D u_orientTexture;
uniform vec2 u_textureSize;
uniform float u_frameFrom;
uniform float u_frameTo;
uniform float u_frameRatio;
uniform float u_fragmentScale;
attribute float piece;
varying vec3 v_viewPosition;
varying vec3 v_localDir;

vec3 qrotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  vec4 animationUvs = (vec4(piece, u_frameFrom, piece, u_frameTo) + 0.5) / u_textureSize.xyxy;
  vec3 piecePosFrom = texture2D(u_positionTexture, animationUvs.xy).xyz;
  vec3 piecePosTo = texture2D(u_positionTexture, animationUvs.zw).xyz;
  vec4 pieceOrientFrom = texture2D(u_orientTexture, animationUvs.xy);
  vec4 pieceOrientTo = texture2D(u_orientTexture, animationUvs.zw);

  float radius = length(position) * u_fragmentScale;
  vec3 dir = position / max(radius, 1e-6);
  vec3 posFrom = qrotate(pieceOrientFrom, dir);
  vec3 posTo = qrotate(pieceOrientTo, dir);
  v_localDir = normalize(mix(posFrom, posTo, u_frameRatio));
  vec3 pos = v_localDir * radius + mix(piecePosFrom, piecePosTo, u_frameRatio);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  v_viewPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D u_backgroundTexture;
uniform vec2 u_resolution;
varying vec3 v_viewPosition;
varying vec3 v_localDir;

void main() {
  vec3 fdx = dFdx(v_viewPosition);
  vec3 fdy = dFdy(v_viewPosition);
  vec3 viewNormal = normalize(cross(fdx, fdy));
  float alpha = abs(1.0 - viewNormal.z);
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 bgColor = texture2D(u_backgroundTexture, uv).rgb;
  vec2 refl = reflect(normalize(v_viewPosition), viewNormal).xy;
  vec2 uvOffset = refl.xy * 0.2 * vec2(u_resolution.x / u_resolution.y, 1.0);
  vec3 color = texture2D(u_backgroundTexture, uv + uvOffset).rgb;
  // their facet-angle rainbow, verbatim — no hue drift, and alpha is used
  // straight (it is both the blend alpha AND the bloom mask; scaling it by an
  // extra opacity term dimmed the pane twice over, leaving it translucent
  // exactly while the astronaut was inside it)
  color += clamp(abs(mod(alpha * 8.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0) * (1.0 - alpha) * (1.0 - bgColor);
  gl_FragColor = vec4(color, alpha);
}
`

export type GlassShards = {
  mesh: THREE.Mesh
  uniforms: {
    u_backgroundTexture: THREE.IUniform<THREE.Texture | null>
    u_resolution: THREE.IUniform<THREE.Vector2>
    u_frameFrom: THREE.IUniform<number>
    u_frameTo: THREE.IUniform<number>
    u_frameRatio: THREE.IUniform<number>
    u_fragmentScale: THREE.IUniform<number>
  }
  /** intact-pane (frame 0) bounding size, in the mesh's local units */
  paneSize: THREE.Vector3
  /** scrub the shatter: 0 = intact pane, 1 = fully blown apart */
  setProgress: (t: number) => void
}

export async function createGlassShards(assetBase: string): Promise<GlassShards> {
  const [model, anim] = await Promise.all([
    loadBuf(`${assetBase}/models/broken_glass.buf`),
    loadBuf(`${assetBase}/models/broken_glass_animation.buf`),
  ])

  const geometry = model.geometry
  geometry.setAttribute(
    'piece',
    new THREE.BufferAttribute(Float32Array.from(model.streams.piece as Uint16Array), 1),
  )

  const makeTexture = (fill: (texel: number, i: number, data: Float32Array) => void) => {
    const data = new Float32Array(GLASS_PIECES * GLASS_FRAMES * 4)
    for (let i = 0; i < GLASS_PIECES * GLASS_FRAMES; i++) fill(i * 4, i, data)
    const tex = new THREE.DataTexture(
      data, GLASS_PIECES, GLASS_FRAMES, THREE.RGBAFormat, THREE.FloatType,
    )
    tex.minFilter = THREE.NearestFilter
    tex.magFilter = THREE.NearestFilter
    tex.needsUpdate = true
    return tex
  }
  const ap = anim.streams.position as Float32Array
  const ao = anim.streams.orient as Float32Array

  // frame 0 = the intact pane; its piece-pivot bounds give the screen size
  const paneMin = new THREE.Vector3(Infinity, Infinity, Infinity)
  const paneMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (let i = 0; i < GLASS_PIECES; i++) {
    paneMin.x = Math.min(paneMin.x, ap[i * 3]); paneMax.x = Math.max(paneMax.x, ap[i * 3])
    paneMin.y = Math.min(paneMin.y, ap[i * 3 + 1]); paneMax.y = Math.max(paneMax.y, ap[i * 3 + 1])
    paneMin.z = Math.min(paneMin.z, ap[i * 3 + 2]); paneMax.z = Math.max(paneMax.z, ap[i * 3 + 2])
  }
  const paneSize = paneMax.clone().sub(paneMin)
  const posTex = makeTexture((o, i, d) => {
    d[o] = ap[i * 3]; d[o + 1] = ap[i * 3 + 1]; d[o + 2] = ap[i * 3 + 2]; d[o + 3] = 1
  })
  const oriTex = makeTexture((o, i, d) => {
    d[o] = ao[i * 4]; d[o + 1] = ao[i * 4 + 1]; d[o + 2] = ao[i * 4 + 2]; d[o + 3] = ao[i * 4 + 3]
  })

  const uniforms = {
    u_backgroundTexture: { value: null as THREE.Texture | null },
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_positionTexture: { value: posTex },
    u_orientTexture: { value: oriTex },
    u_textureSize: { value: new THREE.Vector2(GLASS_PIECES, GLASS_FRAMES) },
    u_frameFrom: { value: 0 },
    u_frameTo: { value: 0 },
    u_frameRatio: { value: 0 },
    u_fragmentScale: { value: 1 },
  }

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
    }),
  )
  mesh.frustumCulled = false
  mesh.renderOrder = 1000

  const setProgress = (t: number) => {
    const f = THREE.MathUtils.clamp(t, 0, 1) * (GLASS_FRAMES - 1.001)
    uniforms.u_frameFrom.value = Math.floor(f)
    uniforms.u_frameTo.value = Math.min(Math.floor(f) + 1, GLASS_FRAMES - 1)
    uniforms.u_frameRatio.value = f - Math.floor(f)
  }
  setProgress(0)

  return { mesh, uniforms, paneSize, setProgress }
}
