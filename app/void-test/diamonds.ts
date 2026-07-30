import * as THREE from 'three'
import { loadBuf } from './bufLoader'

/**
 * Port of Lusion's GoalWhiteTunnelParticles — the floating diamond crystals.
 *
 * Their diamond.buf mesh instanced N times; each instance spins around a
 * random axis forever and drifts upward, wrapping vertically. The fragment
 * shader raytraces a refraction through the gem's own face planes at diamond
 * IOR (2.418) and shades facets with an angle-keyed rainbow — as the gems
 * tumble, the colours continuously reshape. Shader ported near-verbatim.
 */

const MAX_PLANES = 25

const vertexShader = /* glsl */ `
attribute vec3 a_instancePosition;
attribute vec3 a_instanceRotationAxis;
attribute vec4 a_instanceRand;
attribute float thickness;
uniform float u_time;
uniform float u_aspect;
uniform float u_activeRatio;
varying vec3 v_viewNormal;
varying float v_thickness;
varying vec3 v_cameraPositionLS;
varying vec3 v_positionLS;
varying vec3 v_normalLS;
varying vec4 v_orient;
varying float v_fadeOut;

float linearStep(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}
vec3 qrotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec4 quaternion(vec3 axis, float halfAngle) { return vec4(axis * sin(halfAngle), cos(halfAngle)); }

void main() {
  float time = 0.5 * u_time + 4.0 * a_instanceRand.x;
  float scale = 0.75;
  vec3 pos = position;
  vec4 orient = quaternion(a_instanceRotationAxis, (0.5 + a_instanceRand.y) * time);
  pos = qrotate(orient, pos);
  pos *= scale;
  vec3 nor = qrotate(orient, normal);
  vec3 instancePosition = a_instancePosition;
  instancePosition.y += 0.5 * u_time * (1.0 + a_instanceRand.x);
  float yLimit = 20.0 / u_aspect;
  instancePosition.y = mod(instancePosition.y, yLimit) - 0.5 * yLimit;
  v_fadeOut = abs(instancePosition.y) / (yLimit * 0.5);
  pos *= linearStep(a_instanceRand.w * 0.5, a_instanceRand.w * 0.5 + 0.5, u_activeRatio);
  pos += instancePosition;
  vec4 orientInv = vec4(-orient.xyz, orient.w);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  v_cameraPositionLS = qrotate(orientInv, (cameraPosition - instancePosition) / scale);
  v_positionLS = position * scale;
  v_normalLS = normal;
  v_orient = orient;
  v_viewNormal = normalMatrix * nor;
  v_thickness = thickness;
}
`

const fragmentShader = /* glsl */ `
uniform vec3 u_color;
uniform vec3 u_bgColor;
uniform vec4 u_planes[${MAX_PLANES}];
uniform mat3 u_normalMatrix;
varying vec3 v_viewNormal;
varying float v_thickness;
varying vec3 v_cameraPositionLS;
varying vec3 v_positionLS;
varying vec3 v_normalLS;
varying vec4 v_orient;
varying float v_fadeOut;

float linearStep(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}
float plaIntersect(in vec3 ro, in vec3 rd, in vec4 p) {
  return -(dot(ro, p.xyz) + p.w) / dot(rd, p.xyz);
}
vec4 getColorShade(vec3 dir, vec3 vn) {
  float d = dot(dir, vn);
  float shade = (1.0 - max(0.0, vn.z)) * v_thickness * 5.0;
  shade *= (pow(linearStep(2.0, -1.0, d), 4.0) * 0.15 + pow(linearStep(1.0, -2.0, d), 5.0) * 7.0);
  vec3 rgb = mix(vec3(0.8), clamp(abs(mod((d + vn.z) * 12.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0), 1.0 - shade);
  return vec4((vec3(u_color) + rgb * 1.2) * shade, 0.035 + (1.0 - v_thickness) * shade * shade) * (1.0 - abs(vn.z));
}
vec3 qrotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

void main() {
  vec3 localDir = normalize(v_positionLS);
  vec3 viewNormal = normalize(v_viewNormal);
  float ior = 2.418;
  vec3 norLS = normalize(v_normalLS);
  vec3 refrLS = refract(normalize(v_positionLS - v_cameraPositionLS), norLS, 1.0 / ior);
  float dist = 100.0;
  vec3 planeDir = vec3(0.0);
  for (int i = 0; i < ${MAX_PLANES}; i++) {
    vec4 plane = u_planes[i];
    plane.xyz *= -1.0;
    plane.w *= 0.7501;
    float hitDist = plaIntersect(v_positionLS + refrLS * 0.001, refrLS, plane);
    if (hitDist > 0.0 && hitDist < dist) {
      dist = hitDist;
      planeDir = u_planes[i].xyz;
    }
  }
  vec3 refrPosLS = v_positionLS + refrLS * dist;
  refrLS = refract(refrLS, planeDir, ior);
  vec3 refrLocalDir = qrotate(v_orient, normalize(refrPosLS));
  vec3 viewPlaneNor = u_normalMatrix * qrotate(v_orient, planeDir);
  vec4 frontColorShade = getColorShade(localDir, viewNormal);
  vec4 backColorShade = getColorShade(refrLocalDir, viewPlaneNor);
  gl_FragColor = frontColorShade * 1.5 + vec4(backColorShade.rgb * 0.75, backColorShade.a * 0.5);
  gl_FragColor.rgb = mix(u_bgColor, gl_FragColor.rgb, linearStep(0.0, 0.1, 1.0 - v_fadeOut));
}
`

export type Diamonds = {
  mesh: THREE.Mesh
  uniforms: {
    u_time: THREE.IUniform<number>
    u_activeRatio: THREE.IUniform<number>
    u_aspect: THREE.IUniform<number>
    u_bgColor: THREE.IUniform<THREE.Color>
    u_normalMatrix: THREE.IUniform<THREE.Matrix3>
  }
}

export async function createDiamonds(assetBase: string, count = 48, spread = 14): Promise<Diamonds> {
  const buf = await loadBuf(`${assetBase}/models/diamond.buf`)
  const src = buf.geometry

  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', src.getAttribute('position'))
  geometry.setAttribute('normal', src.getAttribute('normal'))
  if (src.getIndex()) geometry.setIndex(src.getIndex())
  const thicknessSrc = buf.streams.thickness
  const thickness =
    thicknessSrc instanceof Float32Array
      ? thicknessSrc
      : Float32Array.from(thicknessSrc as Uint8Array, (v) => v / 255)
  geometry.setAttribute('thickness', new THREE.BufferAttribute(thickness, 1))

  // per-instance placement: scattered around the path, random spin axes
  const ipos = new Float32Array(count * 3)
  const iaxis = new Float32Array(count * 3)
  const irand = new Float32Array(count * 4)
  const v = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    ipos[i * 3] = (Math.random() - 0.5) * spread * 2
    ipos[i * 3 + 1] = Math.random() * 40
    ipos[i * 3 + 2] = (Math.random() - 0.5) * spread * 2
    v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
    iaxis[i * 3] = v.x; iaxis[i * 3 + 1] = v.y; iaxis[i * 3 + 2] = v.z
    for (let k = 0; k < 4; k++) irand[i * 4 + k] = Math.random()
  }
  geometry.setAttribute('a_instancePosition', new THREE.InstancedBufferAttribute(ipos, 3))
  geometry.setAttribute('a_instanceRotationAxis', new THREE.InstancedBufferAttribute(iaxis, 3))
  geometry.setAttribute('a_instanceRand', new THREE.InstancedBufferAttribute(irand, 4))
  geometry.instanceCount = count

  // the gem's face planes, for the in-shader refraction raytrace
  const posArr = src.getAttribute('position').array as Float32Array
  const idx = src.getIndex()!.array
  const planes: number[][] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3()
  for (let t = 0; t < idx.length; t += 3) {
    a.fromArray(posArr, idx[t] * 3)
    b.fromArray(posArr, idx[t + 1] * 3)
    c.fromArray(posArr, idx[t + 2] * 3)
    ab.subVectors(b, a); ac.subVectors(c, a)
    n.crossVectors(ab, ac)
    if (n.lengthSq() < 1e-10) continue
    n.normalize()
    const w = -n.dot(a)
    const key = planes.find(
      (p) => Math.abs(p[0] - n.x) < 0.02 && Math.abs(p[1] - n.y) < 0.02 && Math.abs(p[2] - n.z) < 0.02 && Math.abs(p[3] - w) < 0.02,
    )
    if (!key && planes.length < MAX_PLANES) planes.push([n.x, n.y, n.z, w])
  }
  while (planes.length < MAX_PLANES) planes.push(planes[planes.length % Math.max(planes.length, 1)] ?? [0, 1, 0, -1])
  const planeUniform = planes.map((p) => new THREE.Vector4(p[0], p[1], p[2], p[3]))

  const uniforms = {
    u_time: { value: 0 },
    u_activeRatio: { value: 0 },
    u_aspect: { value: 0.5 }, // yLimit = 20/aspect = 40
    u_color: { value: new THREE.Color('#1a1a22') },
    u_bgColor: { value: new THREE.Color('#000000') },
    u_planes: { value: planeUniform },
    u_normalMatrix: { value: new THREE.Matrix3() },
  }

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  mesh.frustumCulled = false
  return { mesh, uniforms }
}
