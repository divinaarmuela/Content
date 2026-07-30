import * as THREE from 'three'

/**
 * Port of Lusion's FFT convolution Bloom (their Bloom class, USE_CONVOLUTION
 * path) — shaders VERBATIM:
 *  - highPassFrag: bloom source = rgb × alpha-mask (+ their lens HALO with
 *    RGB shift — the rainbow ring lives HERE), padded by convolutionBuffer
 *  - convolutionSrcFrag: their procedural star-flare kernel
 *  - fftFrag: Stockham FFT butterfly (H+V ping-pong passes)
 *  - convolutionMixFrag: frequency-domain complex multiply with the cached
 *    kernel spectrum
 *  - convolutionCacheFrag: amount + saturation on the convolved result
 *  - convolutionFrag: final composite with dithering
 * Our addition at the very end: ACES + gamma (their engine tone-maps in a
 * later output pass; we fold it into the composite).
 */

const QUAD_VERT = /* glsl */ `
varying vec2 v_uv;
void main() { v_uv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const COPY_FRAG = /* glsl */ `
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_texture, v_uv); }
`

const HIGHPASS_FRAG = /* glsl */ `
uniform sampler2D u_texture;
uniform float u_amount;
uniform vec2 u_texelSize;
uniform vec2 u_aspect;
uniform float u_haloWidth;
uniform float u_haloRGBShift;
uniform float u_haloStrength;
uniform float u_haloMaskInner;
uniform float u_haloMaskOuter;
uniform float u_convolutionBuffer;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv;
  uv = (uv - 0.5) * (1.0 + u_convolutionBuffer) + 0.5;
  vec4 texel = texture2D(u_texture, uv);
  float alpha = texel.a * u_amount;
  gl_FragColor = vec4(texel.rgb * alpha, 1.0);
  vec2 toCenter = (uv - 0.5) * u_aspect;
  vec2 ghostUv = 1.0 - (toCenter + 0.5);
  vec2 ghostVec = (vec2(0.5) - ghostUv);
  vec2 direction = normalize(ghostVec);
  vec2 haloVec = direction * u_haloWidth;
  float weight = length(vec2(0.5) - fract(ghostUv + haloVec));
  weight = pow(1.0 - weight, 3.0);
  vec3 distortion = vec3(-u_texelSize.x, 0.0, u_texelSize.x) * u_haloRGBShift;
  float zoomBlurRatio = fract(atan(toCenter.y, toCenter.x) * 40.0) * 0.05 + 0.95;
  ghostUv *= zoomBlurRatio;
  vec2 haloUv = ghostUv + haloVec;
  vec3 halo = vec3(
    texture2D(u_texture, haloUv + direction * distortion.r).r,
    texture2D(u_texture, haloUv + direction * distortion.g).g,
    texture2D(u_texture, haloUv + direction * distortion.b).b
  ) * u_haloStrength * smoothstep(u_haloMaskInner, u_haloMaskOuter, length(toCenter));
  // their highPassFrag, verbatim: no amount multiplier on the halo.
  // my u_amount multiplier scaled the halo by the BLOOM amount (up to 30)
  // through the card/title. the halo's rgb shift is vec3(-texel, 0, +texel),
  // so the GREEN sample is the only unshifted one — where the shifted red and
  // blue taps fall outside the frame and clamp to black, pure green survives,
  // and 30x turned that into the green cast over the card.
  gl_FragColor.rgb += halo;
  gl_FragColor.rgb *= max(abs(uv.x - 0.5), abs(uv.y - 0.5)) > 0.5 ? 0. : 1.;
  // half-float ceiling is 65504; the FFT sums the whole image, so keep the
  // source bounded or the transform returns Inf/NaN (magenta-green garbage)
  gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0.0, 4.0);
}
`

// pass 1 input: red + green as the two real channels, imaginaries zeroed
const PACK_RG_FRAG = /* glsl */ `
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() { gl_FragColor = vec4(texture2D(u_texture, v_uv).rg, 0.0, 0.0); }
`

// pass 2 input: blue as the single real channel (it was never convolved at all)
const PACK_B_FRAG = /* glsl */ `
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() { gl_FragColor = vec4(texture2D(u_texture, v_uv).b, 0.0, 0.0, 0.0); }
`

const KERNEL_SRC_FRAG = /* glsl */ `
uniform vec2 u_aspect;
varying vec2 v_uv;
void main() {
  vec2 toCenter = (fract(v_uv + 0.5) - 0.5) * u_aspect;
  vec2 rotToCenter = mat2(0.7071067811865476, -0.7071067811865476, 0.7071067811865476, 0.7071067811865476) * toCenter;
  float res =
    exp(-length(toCenter) * 1.0) * 0.05 +
    exp(-length(toCenter) * 7.5) * 0.5 +
    exp(-length(toCenter) * 25.0) * 1. +
    exp(-length(toCenter * vec2(1.0, 10.0)) * 30.0) * 20. +
    exp(-length(toCenter * vec2(1.0, 20.0)) * 60.0) * 300. +
    exp(-length(toCenter * vec2(10.0, 1.0)) * 30.0) * 20. +
    exp(-length(toCenter * vec2(20.0, 1.0)) * 60.0) * 300. +
    exp(-length(rotToCenter * vec2(1.0, 8.0)) * 37.5) * 12. +
    exp(-length(rotToCenter * vec2(1.0, 20.0)) * 75.0) * 300. +
    exp(-length(rotToCenter * vec2(20.0, 1.0)) * 75.0) * 300.;
  gl_FragColor = vec4(res, res, 0., 0.);
}
`

const FFT_FRAG = /* glsl */ `
uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform float u_subtransformSize;
uniform float u_normalization;
uniform bool u_isForward;
const float TWOPI = 6.283185307179586;
void main() {
#ifdef HORIZTONAL
  float index = gl_FragCoord.x - .5;
#else
  float index = gl_FragCoord.y - .5;
#endif
  float evenIndex = floor(index / u_subtransformSize) * (u_subtransformSize * 0.5) + mod(index, u_subtransformSize * 0.5);
#ifdef HORIZTONAL
  vec2 evenPos = vec2(evenIndex, gl_FragCoord.y) * u_texelSize;
  vec2 oddPos = evenPos + vec2(.5, 0.);
#else
  vec2 evenPos = vec2(gl_FragCoord.x, evenIndex) * u_texelSize;
  vec2 oddPos = evenPos + vec2(0., .5);
#endif
  vec4 even = texture2D(u_texture, evenPos);
  vec4 odd = texture2D(u_texture, oddPos);
  float twiddleArgument = (u_isForward ? TWOPI : -TWOPI) * (index / u_subtransformSize);
  vec2 twiddle = vec2(cos(twiddleArgument), sin(twiddleArgument));
  gl_FragColor = (even + vec4(twiddle.x * odd.xy - twiddle.y * odd.zw, twiddle.y * odd.xy + twiddle.x * odd.zw)) * u_normalization;
}
`

const MIX_FRAG = /* glsl */ `
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_kernelTexture;
void main() {
  vec4 a = texture2D(u_texture, v_uv);
  vec4 b = texture2D(u_kernelTexture, v_uv);
  gl_FragColor = vec4(a.xy * b.xy - a.zw * b.zw, a.xy * b.zw + a.zw * b.xy);
}
`

const CACHE_FRAG = /* glsl */ `
uniform sampler2D u_texture;
uniform float u_amount;
uniform float u_saturation;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_texture, v_uv) * u_amount;
  gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114))), gl_FragColor.rgb, u_saturation);
  gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0.0, 4.0);
}
`

// their GoalTunnelEfx reprojection motion blur, 16 taps along the velocity
// from the previous frame's projection-view (with the tunnels' offset baked
// in); blue-noise substituted with a hash
const MOTION_FRAG = /* glsl */ `
uniform sampler2D u_texture;
uniform sampler2D u_depthTexture;
uniform mat4 u_projectionViewInverseMatrix;
uniform mat4 u_prevProjectionViewMatrix;
uniform vec2 u_aspect;
uniform float u_amount;
varying vec2 v_uv;
uniform sampler2D u_blueNoiseTexture;
uniform vec2 u_blueNoiseSize;
vec3 getBlueNoise(vec2 co) {
  return texture2D(u_blueNoiseTexture, co / u_blueNoiseSize).rgb;
}
void main() {
  vec3 bnoise = getBlueNoise(gl_FragCoord.xy);
  float depth = texture2D(u_depthTexture, v_uv + bnoise.yz * 0.01 * u_aspect).r;
  vec4 ndc = vec4(v_uv.xy * 2.0 - 1.0, depth, 1.0);
  vec4 worldPos = u_projectionViewInverseMatrix * ndc;
  vec4 prevPos = u_prevProjectionViewMatrix * worldPos;
  prevPos /= prevPos.w;
  prevPos.xy = prevPos.xy * 0.5 + 0.5;
  vec2 velocity = (prevPos.xy - v_uv) / 16.0 * u_amount;
  vec2 uv = v_uv + bnoise.xy * velocity;
  vec4 color = vec4(0.0);
  float weightSum = 0.0;
  float weight = 1.0;
  for (int i = 0; i < 16; i++) {
    color += texture2D(u_texture, uv) * weight;
    uv += velocity;
    weightSum += weight;
  }
  gl_FragColor = color / weightSum;
}
`

const FINAL_FRAG = /* glsl */ `
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform sampler2D u_bloomTexture;
uniform sampler2D u_bloomTextureB;
uniform float u_convolutionBuffer;
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 dithering(vec3 color) {
  float grid_position = rand(gl_FragCoord.xy);
  vec3 dither_shift_RGB = vec3(0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0);
  dither_shift_RGB = mix(2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position);
  return color + dither_shift_RGB;
}
void main() {
  vec4 c = texture2D(u_texture, v_uv);
  vec2 bloomUv = (v_uv - 0.5) / (1.0 + u_convolutionBuffer) + 0.5;
  // their composite: plain add, no tone mapping (white stays white)
  vec3 bloomC = vec3(
    texture2D(u_bloomTexture, bloomUv).rg,
    texture2D(u_bloomTextureB, bloomUv).r
  );
  // NaN guard — a NaN never equals itself (GLSL1-safe)
  bloomC = vec3(
    bloomC.r == bloomC.r ? bloomC.r : 0.0,
    bloomC.g == bloomC.g ? bloomC.g : 0.0,
    bloomC.b == bloomC.b ? bloomC.b : 0.0
  );
  vec3 color = c.rgb + bloomC;
  color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2)); // linear → sRGB only
  gl_FragColor = vec4(dithering(color), 1.0);
}
`

const powerTwoCeiling = (v: number) => Math.pow(2, Math.ceil(Math.log2(v)))
const powerTwoCeilingBase = (v: number) => Math.ceil(Math.log2(v))

export type FftBloom = {
  feedbackTexture: THREE.Texture
  sceneTexture: THREE.Texture
  /** their bloomAmount (30, 6, 4, 2 …) */
  amount: { value: number }
  saturation: { value: number }
  haloStrength: { value: number }
  motionAmount: { value: number }
  motionOffset: THREE.Vector3
  motionRotZ: { value: number }
  setSize: (w: number, h: number) => void
  render: (scene: THREE.Scene, camera: THREE.Camera, afterScene?: () => void) => void
  dispose: () => void
}

export function createFftBloom(renderer: THREE.WebGLRenderer): FftBloom {
  const fftOpts: THREE.RenderTargetOptions = {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  }
  const linOpts: THREE.RenderTargetOptions = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  }
  const depthTex = new THREE.DepthTexture(1, 1)
  const rtScene = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, depthTexture: depthTex,
  })
  const rtBlur = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  })
  const feedback = new THREE.WebGLRenderTarget(1, 1, linOpts)
  feedback.texture.wrapS = feedback.texture.wrapT = THREE.MirroredRepeatWrapping
  const highPass = new THREE.WebGLRenderTarget(1, 1, linOpts)
  const fftCache1 = new THREE.WebGLRenderTarget(1, 1, fftOpts)
  const fftCache2 = new THREE.WebGLRenderTarget(1, 1, fftOpts)
  const kernelRT = new THREE.WebGLRenderTarget(1, 1, fftOpts)
  const outCache = new THREE.WebGLRenderTarget(1, 1, linOpts)
  const outCacheB = new THREE.WebGLRenderTarget(1, 1, linOpts)

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geo = new THREE.PlaneGeometry(2, 2)
  const makePass = (frag: string, uniforms: Record<string, THREE.IUniform>, defines?: Record<string, boolean>) => {
    const scn = new THREE.Scene()
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: QUAD_VERT, fragmentShader: frag,
      depthTest: false, depthWrite: false, defines,
    })
    scn.add(new THREE.Mesh(geo, mat))
    return { scn, mat }
  }
  const blit = (p: { scn: THREE.Scene }, to: THREE.WebGLRenderTarget | null) => {
    renderer.setRenderTarget(to)
    renderer.render(p.scn, cam)
  }

  // their tuning values (Bloom class defaults + GoalTunnels config)
  const CONV_BUFFER = 0.1
  const amount = { value: 6 }
  const saturation = { value: 1 }
  const haloStrength = { value: 0 }

  const copyPass = makePass(COPY_FRAG, { u_texture: { value: rtScene.texture } })
  const packRGPass = makePass(PACK_RG_FRAG, { u_texture: { value: highPass.texture } })
  const packBPass = makePass(PACK_B_FRAG, { u_texture: { value: highPass.texture } })
  const feedbackPass = makePass(COPY_FRAG, { u_texture: { value: rtScene.texture } })
  const highPassPass = makePass(HIGHPASS_FRAG, {
    u_texture: { value: rtScene.texture },
    // damped vs their 1.0: our scene feeds linear HDR into the kernel at a
    // hotter stage than their pipeline does
    u_amount: { value: 0.08 },
    u_texelSize: { value: new THREE.Vector2() },
    u_aspect: { value: new THREE.Vector2(1, 1) },
    u_haloWidth: { value: 0.8 },
    u_haloRGBShift: { value: 0.015 },
    u_haloStrength: haloStrength,
    u_haloMaskInner: { value: 0.3 },
    u_haloMaskOuter: { value: 0.5 },
    u_convolutionBuffer: { value: CONV_BUFFER },
  })
  const kernelPass = makePass(KERNEL_SRC_FRAG, { u_aspect: { value: new THREE.Vector2(1, 1) } })
  const fftUniforms = {
    u_texture: { value: null as THREE.Texture | null },
    u_texelSize: { value: new THREE.Vector2() },
    u_subtransformSize: { value: 0 },
    u_normalization: { value: 1 },
    u_isForward: { value: true },
  }
  const fftH = makePass(FFT_FRAG, fftUniforms, { HORIZTONAL: true })
  const fftV = makePass(FFT_FRAG, fftUniforms)
  const mixPass = makePass(MIX_FRAG, { u_texture: { value: null }, u_kernelTexture: { value: kernelRT.texture } })
  const cachePass = makePass(CACHE_FRAG, { u_texture: { value: null }, u_amount: { value: 1 }, u_saturation: saturation })
  const finalPass = makePass(FINAL_FRAG, {
    u_texture: { value: rtBlur.texture },
    u_bloomTexture: { value: outCache.texture },
    u_bloomTextureB: { value: outCacheB.texture },
    u_convolutionBuffer: { value: CONV_BUFFER },
  })

  // ── their GoalTunnelEfx reprojection motion blur ──
  const motionAmount = { value: 0 }
  const motionOffset = new THREE.Vector3()
  const motionRotZ = { value: 0 }
  const pv = new THREE.Matrix4()
  const prevPV = new THREE.Matrix4()
  const pvInv = new THREE.Matrix4()
  const finalPrev = new THREE.Matrix4()
  const extra = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  let pvSynced = false
  const blueNoise = new THREE.TextureLoader().load(
    '/lusion-test/textures/LDR_RGB1_0.png',
    (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.minFilter = t.magFilter = THREE.NearestFilter
      motionPass.mat.uniforms.u_blueNoiseSize.value.set(t.image.width, t.image.height)
    },
  )
  blueNoise.wrapS = blueNoise.wrapT = THREE.RepeatWrapping
  blueNoise.minFilter = blueNoise.magFilter = THREE.NearestFilter
  const motionPass = makePass(MOTION_FRAG, {
    u_texture: { value: rtScene.texture },
    u_depthTexture: { value: depthTex },
    u_blueNoiseTexture: { value: blueNoise },
    u_blueNoiseSize: { value: new THREE.Vector2(128, 128) },
    u_projectionViewInverseMatrix: { value: pvInv },
    u_prevProjectionViewMatrix: { value: finalPrev },
    u_aspect: { value: new THREE.Vector2(1, 1) },
    u_amount: motionAmount,
  })

  // their renderFFT, ported: Stockham ping-pong, H passes then V passes
  const renderFFT = (a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget, forward: boolean) => {
    const w = a.width, h = a.height
    const xIters = Math.round(Math.log2(w))
    const yIters = Math.round(Math.log2(h))
    const iters = xIters + yIters
    let src = a, dst = b
    for (let i = 0; i < iters; i++) {
      const horizontal = i < xIters
      fftUniforms.u_texture.value = src.texture
      fftUniforms.u_normalization.value = i === 0 ? 1 / Math.sqrt(w * h) : 1
      fftUniforms.u_isForward.value = forward
      fftUniforms.u_texelSize.value.set(1 / w, 1 / h)
      fftUniforms.u_subtransformSize.value = Math.pow(2, (horizontal ? i : i - xIters) + 1)
      blit(horizontal ? fftH : fftV, dst)
      const t = src; src = dst; dst = t
    }
    // result lives in `src` after the loop; if odd iteration count it's `b`
    if (iters % 2 === 0) {
      copyPass.mat.uniforms.u_texture.value = src.texture
      blit(copyPass, dst)
    }
  }

  let W = 1, H = 1
  const setSize = (w: number, h: number) => {
    W = w; H = h
    rtScene.setSize(w, h)
    rtBlur.setSize(w, h)
    motionPass.mat.uniforms.u_aspect.value.set(1, w / Math.max(1, h))
    feedback.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2))
    const n = powerTwoCeiling(w / 2)
    const m = powerTwoCeiling(h / 2)
    highPass.setSize(n, m)
    fftCache1.setSize(n, m)
    fftCache2.setSize(n, m)
    kernelRT.setSize(n, m)
    outCache.setSize(n, m)
    outCacheB.setSize(n, m)
    // bake the kernel spectrum (their setPostprocessing)
    const l = h / Math.max(w, h)
    kernelPass.mat.uniforms.u_aspect.value.set((w / h) * l, l)
    blit(kernelPass, fftCache1)
    renderFFT(fftCache1, kernelRT, true)
    // ensure spectrum ends in kernelRT regardless of parity
    if ((Math.round(Math.log2(n)) + Math.round(Math.log2(m))) % 2 !== 0) {
      // odd: renderFFT left result in kernelRT already
    }
    highPassPass.mat.uniforms.u_texelSize.value.set(1 / w, 1 / h)
    const la = h / Math.sqrt(w * w + h * h) * 2
    highPassPass.mat.uniforms.u_aspect.value.set((w / h) * la, la)
    highPassPass.mat.uniforms.u_haloRGBShift.value = 0.015 * w
  }

  const render = (scene: THREE.Scene, camera: THREE.Camera, afterScene?: () => void) => {
    const prevTM = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setRenderTarget(rtScene)
    renderer.render(scene, camera)
    // their preUfx layer: frame overlay + the astronaut once he drops out
    if (afterScene) afterScene()
    renderer.toneMapping = prevTM

    // reprojection motion blur (their GoalTunnelEfx), then everything
    // downstream reads the blurred frame
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (!pvSynced) { prevPV.copy(pv); pvSynced = true }
    pvInv.copy(pv).invert()
    extra.compose(motionOffset, q.setFromEuler(new THREE.Euler(0, 0, motionRotZ.value)), one).invert()
    finalPrev.copy(prevPV).multiply(extra)
    if (motionAmount.value > 0.005) {
      blit(motionPass, rtBlur)
    } else {
      copyPass.mat.uniforms.u_texture.value = rtScene.texture
      blit(copyPass, rtBlur)
    }
    prevPV.copy(pv)

    feedbackPass.mat.uniforms.u_texture.value = rtBlur.texture
    highPassPass.mat.uniforms.u_texture.value = rtBlur.texture
    blit(feedbackPass, feedback)
    blit(highPassPass, highPass)

    // their amount normalisation
    let c = amount.value * 1024
    c = (c / Math.pow(powerTwoCeilingBase(fftCache1.width * fftCache1.height), 4)) * 0.85
    cachePass.mat.uniforms.u_amount.value = c

    // the transform carries TWO real channels per pass (real in .xy, imaginary
    // in .zw), so the three colour channels need two rounds. previously the
    // highpass RGBA went in raw, which put B and the constant alpha into the
    // imaginary slots.
    const convolve = (pack: { scn: THREE.Scene }, out: THREE.WebGLRenderTarget) => {
      blit(pack, fftCache1)
      renderFFT(fftCache1, fftCache2, true)
      mixPass.mat.uniforms.u_texture.value = fftCache2.texture
      blit(mixPass, fftCache1)
      renderFFT(fftCache1, fftCache2, false)
      cachePass.mat.uniforms.u_texture.value = fftCache2.texture
      blit(cachePass, out)
    }
    convolve(packRGPass, outCache)   // -> .r = bloom R, .g = bloom G
    convolve(packBPass, outCacheB)   // -> .r = bloom B

    blit(finalPass, null)
    renderer.setRenderTarget(null)
  }

  return {
    feedbackTexture: feedback.texture,
    sceneTexture: rtScene.texture,
    amount,
    saturation,
    haloStrength,
    motionAmount,
    motionOffset,
    motionRotZ,
    setSize,
    render,
    dispose: () => {
      for (const rt of [rtScene, rtBlur, feedback, highPass, fftCache1, fftCache2, kernelRT, outCache, outCacheB]) rt.dispose()
      geo.dispose()
    },
  }
}
