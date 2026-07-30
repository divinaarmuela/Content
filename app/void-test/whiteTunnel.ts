import * as THREE from 'three'
import { loadBuf } from './bufLoader'

/**
 * Port of Lusion's GoalWhiteTunnel — the "4D" passage.
 *
 * 16 instances of their tunnel_block meshes form one continuous tube; the
 * vertex-stage `deform()` (ported VERBATIM from their blockVert) twists,
 * squeezes and stretches the tube by u_ratioInverse. At ratioInverse≈1 the
 * tube is a violent spiral (the vortex); as the scroll drives it to 0 the
 * twist unwinds into the straight corridor. One system, scrub-driven.
 */

export const BLOCK_COUNT = 16

const vertexShader = /* glsl */ `
attribute float a_instanceId;
uniform float u_time;
uniform float u_ratio;
uniform float u_ratioInverse;
varying vec3 v_worldNormal;
varying vec3 v_worldPosition;
varying vec3 v_localPosition;
varying vec2 v_uv;
varying vec3 v_viewPosition;
varying float v_lengthRatio;

vec3 deform(in vec3 pos) {
  float blockCount = float(BLOCK_COUNT);
  float ratio = mix(0.1, 1.0, u_ratioInverse);
  float lengthRatio = -pos.z / blockCount;
  float scalar = mix(0.25, ratio, lengthRatio);
  pos.x *= 1.0 + scalar * 0.5 * sin(lengthRatio * 6.283184);
  pos.y *= 1.0 + scalar * 0.5 * cos(lengthRatio * 6.283184 + 3.1415926);
  float angleRatio = smoothstep(0.25, 1.0, u_ratioInverse);
  float angle = (angleRatio + angleRatio * lengthRatio * lengthRatio * 1.0) * -6.283184;
  float s = sin(angle);
  float c = cos(angle);
  mat2 m = mat2(c, -s, s, c);
  pos.xy = m * pos.xy;
  pos.y += ratio * sin(ratio * lengthRatio * 3.141592 * 4.0) * 0.25;
  pos.z -= (cos(ratio * 1.5 + (1.0 - ratio) * lengthRatio * 3.141592 * 0.5) * 0.5 + 0.5 - 1.0) * blockCount;
  pos.z *= 1.0 + 16.0 * (ratio * lengthRatio * lengthRatio) + 2.0 * ratio * (sin(8.0 * lengthRatio) * 0.5 + 0.5);
  pos.z *= (1.0 - ratio * ratio * ratio) * 0.9 + 0.1;
  pos.z += blockCount / 4.0;
  return pos * 15.0;
}

void main() {
  float blockCount = float(BLOCK_COUNT);
  vec3 pos = position;
  pos.z -= a_instanceId;
  pos.z /= blockCount;
  float lengthRatio = -pos.z;
  pos.z *= blockCount;
  v_localPosition = pos;
  v_lengthRatio = lengthRatio;
  vec3 nor = deform(pos + normal * 0.01);
  pos = deform(pos);
  nor = normalize(nor - pos);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  v_viewPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  // their container is at the origin, so their worldPosition IS this local
  // deformed position — use it directly so the occlusion sphere sits mid-tube
  v_worldPosition = pos;
  v_worldNormal = normalMatrix * nor;
  v_uv = uv;
}
`

// their blockFrag, ported VERBATIM (only the GLSLIFY define dropped):
// live 4D voronoi — royal-blue base, white cell blobs that drift and
// reshape with time; white_block texture as shade; far-end glow;
// fbm-driven roaming sphere occlusion (the astronaut's fake shadow)
const fragmentShader = /* glsl */ `
uniform sampler2D u_texture;
uniform float u_ratioInverse;
uniform vec3 u_fbm;
uniform float u_time;
varying vec3 v_localPosition;
varying vec2 v_uv;
varying vec3 v_worldPosition;
varying vec3 v_worldNormal;
varying vec3 v_viewPosition;
varying float v_lengthRatio;

float sphOcclusion(in vec3 pos, in vec3 nor, in vec4 sph) {
  vec3 di = sph.xyz - pos;
  float l = length(di);
  float nl = dot(nor, di / l);
  float h = l / sph.w;
  float h2 = h * h;
  return max(0.0, nl) / h2;
}
float linearStep(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}
vec4 hash(vec4 p4) {
  p4 = fract(p4 * vec4(.1031, .1030, .0973, .1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
vec3 voronoi(const in vec4 x) {
  vec4 p = floor(x);
  vec4 f = fract(x);
  float id = 0.0;
  vec2 res = vec2(100.0);
  for (int l = -1; l <= 1; l++) {
    for (int k = -1; k <= 1; k++) {
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec4 b = vec4(float(i), float(j), float(k), float(l));
          vec4 r = vec4(b) - f + hash(p + b);
          float d = dot(r, r);
          float cond = max(sign(res.x - d), 0.0);
          float nCond = 1.0 - cond;
          float cond2 = nCond * max(sign(res.y - d), 0.0);
          float nCond2 = 1.0 - cond2;
          id = (dot(p + b, vec4(1.0, 57.0, 113.0, 421.)) * cond) + (id * nCond);
          res = vec2(d, res.x) * cond + res * nCond;
          res.y = cond2 * d + nCond2 * res.y;
        }
      }
    }
  }
  return vec3(sqrt(res), abs(id));
}
vec4 hash(float p) {
  vec4 p4 = fract(vec4(p) * vec4(.1031, .1030, .0973, .1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

void main() {
  vec4 sph = vec4(u_fbm.x * 2., u_fbm.y * 2. + 1., 0., 2.5);
  vec3 worldNormal = normalize(v_worldNormal);
  float ao = 1. - sphOcclusion(v_worldPosition, worldNormal, sph) * 2. * smoothstep(0.8, 0.5, u_ratioInverse);
  float shade = texture2D(u_texture, v_uv).r;
  float brightness = pow(v_lengthRatio, 5.);
  float t = u_ratioInverse * -2. + u_time * 0.2;
  vec3 vn = voronoi(vec4(v_localPosition * 2. + vec3(0., 0., -t * 0.5), t * 0.25));
  vec4 rnd = hash(vn.z);
  float threshold = 0.05 + rnd.x * 0.1;
  float r = abs(vn.x - .5) * (1.75 + rnd.y * 0.5);
  float pattern = max(0., 1. - smoothstep(threshold - fwidth(r), threshold, r));
  vec3 color = mix(vec3(0.102, 0.184, 0.984), vec3(1.), pattern);
  color *= (.35 + shade) * ao;
  color += brightness * 0.3;   // far-end glow, damped for our closer camera
  gl_FragColor = vec4(color, shade + brightness);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), smoothstep(0.8, 1.0, u_ratioInverse) * 0.5);
  // hold their royal blue: saturate around luminance so the walls read
  // #1a2ffb rather than a washed steel blue
  {
    float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
    gl_FragColor.rgb = mix(vec3(lum), gl_FragColor.rgb, 2.7);
  }
  gl_FragColor.a *= ao * mix(1., 0.15, pattern);
  // our bloom runs hotter than theirs at this stage; keep the wall mask low so
  // the royal blue stays saturated instead of blooming to white
  gl_FragColor.a *= 0.25;
  gl_FragColor += linearStep(-10., -11., v_localPosition.z) * 0.25;
}
`

export type WhiteTunnel = {
  container: THREE.Group
  uniforms: {
    u_ratio: THREE.IUniform<number>
    u_ratioInverse: THREE.IUniform<number>
    u_time: THREE.IUniform<number>
    u_fbm: THREE.IUniform<THREE.Vector3>
  }
}

export async function createWhiteTunnel(assetBase: string): Promise<WhiteTunnel> {
  const [base, wall] = await Promise.all([
    loadBuf(`${assetBase}/models/tunnel_block_base.buf`),
    loadBuf(`${assetBase}/models/tunnel_block_wall.buf`),
  ])
  const tex = new THREE.TextureLoader().load(`${assetBase}/textures/white_block.webp`)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping

  const uniforms = {
    u_ratio: { value: 0 },
    u_ratioInverse: { value: 1 },
    u_time: { value: 0 },
    u_texture: { value: tex },
    u_fbm: { value: new THREE.Vector3() },
  }

  const container = new THREE.Group()
  for (const src of [base, wall]) {
    const geo = new THREE.InstancedBufferGeometry()
    for (const name of ['position', 'normal', 'uv']) {
      const attr = src.geometry.getAttribute(name)
      if (attr) geo.setAttribute(name, attr)
    }
    if (src.geometry.getIndex()) geo.setIndex(src.geometry.getIndex())
    const ids = new Float32Array(BLOCK_COUNT)
    for (let i = 0; i < BLOCK_COUNT; i++) ids[i] = i
    geo.setAttribute('a_instanceId', new THREE.InstancedBufferAttribute(ids, 1))
    geo.instanceCount = BLOCK_COUNT

    const mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        defines: { BLOCK_COUNT },
        side: THREE.DoubleSide,
        // their buffers are opaque — alpha is the BLOOM MASK, not blending
        transparent: false,
      }),
    )
    mesh.frustumCulled = false
    container.add(mesh)
  }
  return { container, uniforms }
}
