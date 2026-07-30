import * as THREE from 'three'

/**
 * Port of Lusion's tunnel-astronaut material (GoalTunnelAstronauts), fragment
 * VERBATIM: matcap shading, armb (arm.rgb + base.r→albedo) + normal maps, sun
 * speculars (GGX getMetalShininess), and the gloss — the suit reflects a LIVE
 * texture of the tunnel (u_blackTunnelTexture ← our feedback frame) with a
 * ×7–17 metal-boosted specular, plus an SDF box-frame glow that picks up the
 * passing grid. Bloom mask written to alpha, matching the selective bloom.
 * Vertex is ours (CPU-skinned geometry), producing their exact varyings.
 */

const vertexShader = /* glsl */ `
attribute vec4 tangent;
attribute float ao;
varying vec3 v_worldPosition;
varying vec4 v_worldTangent;
varying vec3 v_worldNormal;
varying vec2 v_uv;
varying float v_ao;
varying vec3 v_viewPosition;
vec3 inverseTransformDirection(in vec3 dir, in mat4 matrix) {
  return normalize((vec4(dir, 0.0) * matrix).xyz);
}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  v_worldPosition = wp.xyz;
  v_worldNormal = inverseTransformDirection(normalMatrix * normal, viewMatrix);
  v_worldTangent = vec4(inverseTransformDirection(normalMatrix * tangent.xyz, viewMatrix), tangent.w);
  v_uv = uv;
  v_ao = ao;
  vec4 mv = viewMatrix * wp;
  v_viewPosition = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

// their astronautCommonPars + astronautCommon + tunnel fragment, inlined
const fragmentShader = /* glsl */ `
uniform sampler2D u_blackTunnelTexture;
uniform sampler2D u_matcapTexture;
uniform sampler2D u_envTexture;
uniform float u_sunFactor;
uniform vec3 u_sunPosition;
uniform vec3 u_ambientColor;
uniform vec3 u_sunFadeColor;
uniform float u_blackTunnelRatio;
uniform float u_offsetZ;
uniform float u_frameIn;
uniform float u_endRatio;
uniform sampler2D u_armbTexture;
uniform sampler2D u_norTexture;
uniform float u_time;
uniform vec3 u_bgColor;
uniform float u_showRatio;
uniform float u_debugFlat;
varying vec3 v_worldPosition;
varying vec4 v_worldTangent;
varying vec3 v_worldNormal;
varying vec2 v_uv;
varying float v_ao;
varying vec3 v_viewPosition;
const float PI = 3.14159265359;
const float RECIPROCAL_PI = 0.31830988618;
const float RECIPROCAL_PI2 = 0.15915494;
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
float linearStep(float edge0, float edge1, float x) { return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0); }
vec2 cartesianToPolar(vec3 n) {
  vec2 uv;
  uv.x = atan(n.z, n.x) * RECIPROCAL_PI2 + 0.5;
  uv.y = asin(n.y) * RECIPROCAL_PI + 0.5;
  return uv;
}
mat4 rotation3d(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;
  return mat4(
    oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0,
    oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0,
    oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0,
    0.0, 0.0, 0.0, 1.0
  );
}
float sdBoxFrame(vec3 p, vec3 b, float e) {
  p = abs(p) - b;
  vec3 q = abs(p + e) - e;
  return min(min(
    length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
    length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
    length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}
float getMetalShininess(vec3 viewDir, vec3 lightPosition, vec3 worldNormal, float roughness, float metalness) {
  vec3 lightDir = normalize(lightPosition - v_worldPosition);
  vec3 H = normalize(viewDir + lightDir);
  float dotNL = max(0., dot(worldNormal, lightDir));
  float dotNH = max(0., dot(worldNormal, H));
  float alpha = max(0.01, roughness * roughness);
  float alphaSqr = alpha * alpha;
  float pi = 3.14159;
  float denom = dotNH * dotNH * (alphaSqr - 1.0) + 1.0;
  float D = alphaSqr / (pi * denom * denom);
  float specular = metalness * D * 5.0;
  return specular * dotNL;
}
void main() {
  vec3 worldNormal = normalize(v_worldNormal);
  vec3 worldTangent = normalize(v_worldTangent.xyz);
  vec3 worldBinormal = normalize(cross(worldNormal, worldTangent)) * -v_worldTangent.w;
  worldTangent = normalize(cross(worldBinormal, worldNormal));
  vec3 tangentSpaceNormal = normalize(texture2D(u_norTexture, v_uv).xyz - .5);
  worldNormal = normalize(tangentSpaceNormal.x * worldTangent + tangentSpaceNormal.y * worldBinormal + tangentSpaceNormal.z * worldNormal);
  vec4 armb = texture2D(u_armbTexture, v_uv);
  float ao = v_ao * armb.r;
  float roughness = armb.g;
  float metalness = armb.b;
  float albedo = armb.a;
  vec3 N = worldNormal;
  vec3 V = normalize(cameraPosition - v_worldPosition);
  vec3 reflection = normalize(reflect(-V, N));
  float NdV = clamp(abs(dot(N, V)), 0.001, 1.0);
  float fresnel = pow(1.0 - NdV, 5.0);

  vec2 uvDiff = cartesianToPolar(worldNormal);
  vec2 uvSpec = cartesianToPolar(reflection);
  vec3 blackTunnelEnvDiff = texture2D(u_blackTunnelTexture, 0.25 * uvDiff).rgb;
  vec3 blackTunnelEnvSpec = texture2D(u_blackTunnelTexture, 0.25 * uvSpec).rgb * (0.2 + metalness * 0.7) * 2.;
  mat4 frameInRotation = rotation3d(vec3(1.0, 0.0, 0.0), 0.2 + 1. * u_frameIn);
  vec3 viewDir = (vec4(normalize(v_worldPosition), 1.0) * frameInRotation).xyz;
  vec3 x = normalize(vec3(viewDir.z, 0.0, -viewDir.x));
  vec3 y = cross(viewDir, x);
  vec2 uv = vec2(dot(x, worldNormal), dot(y, worldNormal)) * 0.495 + 0.5;
  vec3 sunPosition = u_sunPosition;
  vec3 L = normalize(sunPosition - v_worldPosition);
  float sunNdLRaw = dot(N, L);
  float sunNdL = saturate(sunNdLRaw);
  float matcapShading = 0.5 + 0.5 * (1.0 - texture2D(u_matcapTexture, uv).r);
  float zAxisShading = linearStep(-0.2, 1.3, worldNormal.z) * (0.65 + ao * 0.35);
  float metalMask = 1.0 - metalness;
  float metalShininess = u_sunFactor * getMetalShininess(V, sunPosition, N, (1.0 - 0.9 * metalness), 0.4 * metalness);
  vec3 color = vec3(matcapShading * albedo);
  color += zAxisShading;
  color *= metalMask;
  color *= mix(u_ambientColor * (0.85 + sunNdL * 0.5), vec3(fresnel * 2.), u_blackTunnelRatio * 0.5);
  color += linearStep(0., 10.0, metalShininess);
  color *= mix(0.5 + 0.5 * ao, 0.75 + 0.25 * ao, u_blackTunnelRatio);
  color += metalMask * u_sunFactor * (0.5 * (0.4 + 0.2 * ao + 0.5 * sunNdL) + 0.1 * sunNdL * sunNdL);
  color += linearStep(0., 1., -sunNdLRaw) * u_ambientColor * 0.1;
  vec3 blackTunnelColor = (color * blackTunnelEnvSpec * (7. + metalness * 10.) + albedo * blackTunnelEnvDiff * 1.6) * (1.3 - abs(reflection.z)) * (0.5 + ao * 0.5);
  float GRID_SIZE = 20.0;
  vec3 relPos = v_worldPosition + worldNormal * 3. + vec3(0., 0., u_offsetZ);
  float repDist = GRID_SIZE - 1.;
  vec3 relPosRep = mod(relPos + 0.5 * repDist, repDist) - 0.5 * repDist;
  float sdf = sdBoxFrame(relPosRep, vec3(GRID_SIZE - 1.) * .5, 1.);
  blackTunnelColor += exp(-sdf * 0.25) * blackTunnelEnvDiff * 2.;
  gl_FragColor.rgb = color;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, 0.3 * gl_FragColor.rgb + blackTunnelColor, clamp(u_blackTunnelRatio * 2. - 1. + ao, 0., 1.));
  gl_FragColor.rgb = mix(u_bgColor, gl_FragColor.rgb, vec3(u_showRatio));
  gl_FragColor.rgb *= (0.3 + armb.r * 0.7);
  gl_FragColor.rgb += max(worldNormal.z * 2. * sunNdL, metalness) * texture2D(u_envTexture, 1.2 * (uv - 0.5) + vec2(0.5, 0.5)).rgb * 0.75 * v_ao * (1. - u_blackTunnelRatio);
  gl_FragColor.a = 0.01 + 0.1 * max(0.0, gl_FragColor.g - 1. + metalness * 0.2) * (0.5 + metalness * 1.5) + gl_FragColor.b * u_blackTunnelRatio * dot(vec3(0.299, 0.587, 0.114), blackTunnelColor) * 5.;
  gl_FragColor.a += metalShininess;
  gl_FragColor.a *= (0.5 + fresnel * 0.9);
  // suit only glints on their site — keep its flare contribution small
  gl_FragColor.a *= 0.2;
  if (u_debugFlat > 0.5) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }
}
`

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })

/** their armb combine: rgb = arm.rgb, a = base.r (greyscale albedo) */
async function makeArmb(assetBase: string, part: string) {
  const [arm, base] = await Promise.all([
    loadImage(`${assetBase}/textures/${part}_arm.webp`),
    loadImage(`${assetBase}/textures/${part}_base.webp`),
  ])
  const cnv = document.createElement('canvas')
  cnv.width = arm.width; cnv.height = arm.height
  const ctx = cnv.getContext('2d')!
  ctx.drawImage(arm, 0, 0)
  const a = ctx.getImageData(0, 0, cnv.width, cnv.height)
  ctx.drawImage(base, 0, 0, cnv.width, cnv.height)
  const b = ctx.getImageData(0, 0, cnv.width, cnv.height)
  for (let i = 0; i < a.data.length; i += 4) a.data[i + 3] = b.data[i]
  ctx.putImageData(a, 0, 0)
  const tex = new THREE.CanvasTexture(cnv)
  tex.flipY = false
  return tex
}

export type AstronautShared = {
  u_blackTunnelTexture: THREE.IUniform<THREE.Texture | null>
  u_matcapTexture: THREE.IUniform<THREE.Texture>
  u_envTexture: THREE.IUniform<THREE.Texture>
  u_sunFactor: THREE.IUniform<number>
  u_sunPosition: THREE.IUniform<THREE.Vector3>
  u_ambientColor: THREE.IUniform<THREE.Color>
  u_sunFadeColor: THREE.IUniform<THREE.Color>
  u_blackTunnelRatio: THREE.IUniform<number>
  u_offsetZ: THREE.IUniform<number>
  u_frameIn: THREE.IUniform<number>
  u_endRatio: THREE.IUniform<number>
  u_time: THREE.IUniform<number>
  u_bgColor: THREE.IUniform<THREE.Color>
  u_showRatio: THREE.IUniform<number>
  u_debugFlat: THREE.IUniform<number>
}

export function createAstronautShared(assetBase: string): AstronautShared {
  const loader = new THREE.TextureLoader()
  const matcap = loader.load(`${assetBase}/textures/white_matcap.jpg`)
  const env = loader.load(`${assetBase}/textures/earth.webp`)
  env.minFilter = THREE.LinearFilter
  return {
    u_blackTunnelTexture: { value: null },
    u_matcapTexture: { value: matcap },
    u_envTexture: { value: env }, // their env IS earth.webp
    u_sunFactor: { value: 1 },
    u_sunPosition: { value: new THREE.Vector3(-20, 0, 22) }, // their sun
    // their #566d80 / #bbb are raw SHADING CONSTANTS in fragBlack, not scene
    // colours. three's colour management converts a hex literal sRGB->linear,
    // which handed the shader (0.093,0.153,0.216) instead of (0.337,0.427,0.502)
    // — 3.6x too dark. since `color *= u_ambientColor * (0.85 + sunNdL*0.5)` is
    // the dominant term while u_blackTunnelRatio is 0, that alone made the
    // astronaut invisible against the black title background. declare them in
    // LINEAR space so they keep their literal values, as their build does.
    u_ambientColor: {
      value: new THREE.Color().setRGB(0x56 / 255, 0x6d / 255, 0x80 / 255, THREE.LinearSRGBColorSpace),
    },
    u_sunFadeColor: {
      value: new THREE.Color().setRGB(0xbb / 255, 0xbb / 255, 0xbb / 255, THREE.LinearSRGBColorSpace),
    },
    u_blackTunnelRatio: { value: 0 },
    u_offsetZ: { value: 0 },
    u_frameIn: { value: 0 },
    u_endRatio: { value: 0 },
    u_time: { value: 0 },
    u_bgColor: { value: new THREE.Color('#000000') },
    u_showRatio: { value: 1 },
    u_debugFlat: { value: 0 },
  }
}

export async function createAstronautMaterial(
  assetBase: string,
  part: string,
  shared: AstronautShared,
): Promise<THREE.ShaderMaterial> {
  const armb = await makeArmb(assetBase, part)
  const nor = new THREE.TextureLoader().load(`${assetBase}/textures/${part}_nor.webp`)
  nor.flipY = false
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      u_armbTexture: { value: armb },
      u_norTexture: { value: nor },
    },
    vertexShader,
    fragmentShader,
    // opaque buffer — alpha is their bloom mask
    transparent: false,
  })
}
