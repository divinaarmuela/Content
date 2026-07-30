import * as THREE from 'three'
import { loadBuf, type BufResult } from './bufLoader'

/**
 * CPU linear-blend skinning for Lusion's baked skeleton stream.
 *
 * astronaut_animations.buf = 288 frames × 53 bones, FRAME-MAJOR
 * (frame0[bone0..52], frame1[bone0..52], …). Verified by brute-force edge-
 * distortion scoring: each entry is the FINAL skinning transform — the
 * inverse-bind is already baked in — so skinning is simply
 *   v'_f = Σ w_b · ( R_fb · v + t_fb )
 * with xyzw quats, no axis conversion, in the meshes' own (y-up) space.
 */

export const BONES = 53
export const FRAMES = 288

export type Skeleton = {
  /** frame-major final bone transforms: [frame][bone] */
  quats: THREE.Quaternion[][]
  pos: THREE.Vector3[][]
}

export async function loadSkeleton(url: string): Promise<Skeleton> {
  const { streams, header } = await loadBuf(url)
  if (header.vertexCount !== BONES * FRAMES) throw new Error('unexpected animation size')
  const o = streams.orient as Float32Array
  const p = streams.position as Float32Array

  const quats: THREE.Quaternion[][] = []
  const pos: THREE.Vector3[][] = []
  for (let f = 0; f < FRAMES; f++) {
    const fq: THREE.Quaternion[] = []
    const fp: THREE.Vector3[] = []
    for (let b = 0; b < BONES; b++) {
      const i = f * BONES + b
      fq.push(new THREE.Quaternion(o[i * 4], o[i * 4 + 1], o[i * 4 + 2], o[i * 4 + 3]))
      fp.push(new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]))
    }
    quats.push(fq)
    pos.push(fp)
  }
  return { quats, pos }
}

export type SkinnedPart = {
  mesh: THREE.Mesh
  bindPositions: Float32Array
  bindNormals: Float32Array | null
  boneIndices: Uint8Array
  boneWeights: Float32Array
}

export function makeSkinnedPart(buf: BufResult, material: THREE.Material): SkinnedPart {
  const geometry = buf.geometry
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  const norAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  posAttr.setUsage(THREE.DynamicDrawUsage)
  norAttr?.setUsage(THREE.DynamicDrawUsage)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  return {
    mesh,
    bindPositions: (posAttr.array as Float32Array).slice(),
    bindNormals: norAttr ? (norAttr.array as Float32Array).slice() : null,
    boneIndices: buf.streams.boneIndices as Uint8Array,
    boneWeights: buf.streams.boneWeights as Float32Array,
  }
}

// scratch objects (module-level to avoid per-frame GC)
const qA = new THREE.Quaternion()
const mDelta: THREE.Matrix4[] = Array.from({ length: BONES }, () => new THREE.Matrix4())
const vP = new THREE.Vector3()
const nTmp = new THREE.Vector3()
const e0 = new THREE.Vector3()
const e1 = new THREE.Vector3()

/**
 * Build the 53 final bone matrices for a continuous frame value (lerped).
 * `slot` picks the scratch buffer: their shader evaluates TWO poses per draw
 * (loop + dive), so both must exist at once — one shared array would clobber.
 */
const mDeltaB: THREE.Matrix4[] = []
export function poseAtFrame(skel: Skeleton, frame: number, slot: 0 | 1 = 0) {
  const target = slot === 0 ? mDelta : mDeltaB
  if (target.length === 0) for (let b = 0; b < BONES; b++) target.push(new THREE.Matrix4())
  const f = THREE.MathUtils.clamp(frame, 0, FRAMES - 1.001)
  const f0 = Math.floor(f)
  const f1 = Math.min(f0 + 1, FRAMES - 1)
  const a = f - f0
  for (let b = 0; b < BONES; b++) {
    qA.slerpQuaternions(skel.quats[f0][b], skel.quats[f1][b], a)
    vP.lerpVectors(skel.pos[f0][b], skel.pos[f1][b], a)
    const m = target[b]
    m.makeRotationFromQuaternion(qA)
    m.setPosition(vP)
  }
  return target
}

/** Apply the current pose matrices to one mesh part (2-bone LBS). */
/**
 * Their vertex shader (shader-g.glsl) skins the mesh TWICE — once with the
 * loop clip's frame pair, once with the dive frame pair — and mixes the
 * resulting VERTEX POSITIONS:
 *
 *   pos = mix(posLoop, posLinear, u_loopLinearBlend)
 *
 * That is a blend between two poses. Interpolating the frame INDEX instead
 * sweeps the skinner through every animation frame in between, which plays a
 * burst of unrelated animation — the "sudden jump" on the way down.
 *
 * `blend` = their u_loopLinearBlend; `matricesB` = the dive pose.
 */
export function skinPart(
  part: SkinnedPart,
  matrices: THREE.Matrix4[],
  matricesB?: THREE.Matrix4[],
  blend = 0,
) {
  const geometry = part.mesh.geometry
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  const norAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const out = posAttr.array as Float32Array
  const outN = norAttr ? (norAttr.array as Float32Array) : null
  const { bindPositions, bindNormals, boneIndices, boneWeights } = part
  const count = posAttr.count

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    const b0 = boneIndices[i * 2]
    const b1 = boneIndices[i * 2 + 1]
    let w0 = boneWeights[i * 2]
    let w1 = boneWeights[i * 2 + 1]
    const wSum = w0 + w1
    if (wSum > 0) { w0 /= wSum; w1 /= wSum } else { w0 = 1; w1 = 0 }

    const x = bindPositions[i3], y = bindPositions[i3 + 1], z = bindPositions[i3 + 2]
    e0.set(x, y, z).applyMatrix4(matrices[b0])
    e1.set(x, y, z).applyMatrix4(matrices[b1])
    let px = e0.x * w0 + e1.x * w1
    let py = e0.y * w0 + e1.y * w1
    let pz = e0.z * w0 + e1.z * w1
    if (matricesB && blend > 0) {
      // their posLinear — the second full skinning
      e0.set(x, y, z).applyMatrix4(matricesB[b0])
      e1.set(x, y, z).applyMatrix4(matricesB[b1])
      const bx = e0.x * w0 + e1.x * w1
      const by = e0.y * w0 + e1.y * w1
      const bz = e0.z * w0 + e1.z * w1
      px += (bx - px) * blend
      py += (by - py) * blend
      pz += (bz - pz) * blend
    }
    out[i3] = px; out[i3 + 1] = py; out[i3 + 2] = pz

    if (outN && bindNormals) {
      nTmp.set(bindNormals[i3], bindNormals[i3 + 1], bindNormals[i3 + 2])
      e0.copy(nTmp).transformDirection(matrices[b0]).multiplyScalar(w0)
      e1.copy(nTmp).transformDirection(matrices[b1]).multiplyScalar(w1)
      let nx = e0.x + e1.x, ny = e0.y + e1.y, nz = e0.z + e1.z
      if (matricesB && blend > 0) {
        e0.copy(nTmp).transformDirection(matricesB[b0]).multiplyScalar(w0)
        e1.copy(nTmp).transformDirection(matricesB[b1]).multiplyScalar(w1)
        nx += (e0.x + e1.x - nx) * blend
        ny += (e0.y + e1.y - ny) * blend
        nz += (e0.z + e1.z - nz) * blend
      }
      outN[i3] = nx; outN[i3 + 1] = ny; outN[i3 + 2] = nz
    }
  }
  posAttr.needsUpdate = true
  if (norAttr) norAttr.needsUpdate = true
}

/** 100-sample (quat, pos) flight path from the in/out animation bufs. */
export type FlightPath = { quats: THREE.Quaternion[]; pos: THREE.Vector3[] }

export async function loadFlightPath(url: string): Promise<FlightPath> {
  const { streams, header } = await loadBuf(url)
  const o = streams.orient as Float32Array
  const p = streams.position as Float32Array
  const quats: THREE.Quaternion[] = []
  const pos: THREE.Vector3[] = []
  for (let i = 0; i < header.vertexCount; i++) {
    quats.push(new THREE.Quaternion(o[i * 4], o[i * 4 + 1], o[i * 4 + 2], o[i * 4 + 3]).normalize())
    pos.push(new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]))
  }
  return { quats, pos }
}

export function samplePath(path: FlightPath, t: number, outQ: THREE.Quaternion, outP: THREE.Vector3) {
  const n = path.pos.length
  const f = THREE.MathUtils.clamp(t, 0, 1) * (n - 1.001)
  const f0 = Math.floor(f)
  const a = f - f0
  outQ.slerpQuaternions(path.quats[f0], path.quats[Math.min(f0 + 1, n - 1)], a)
  outP.lerpVectors(path.pos[f0], path.pos[Math.min(f0 + 1, n - 1)], a)
}
