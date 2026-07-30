import * as THREE from 'three'

/**
 * Port of Lusion's selective bloom semantics.
 *
 * Their materials write a BLOOM MASK into gl_FragColor.a (the buffers are
 * opaque; alpha is a data channel). The bloom source is scene.rgb * scene.a,
 * blurred with their exact 9-tap gaussian (blur9FragmentShader weights) over
 * a 3-level mip chain, then composited with a saturation boost — their
 * bloomSaturation is what makes the tunnel colours sing. (Their real kernel
 * is an FFT star-flare convolution; the mask + saturation behaviour is the
 * part that changes the look and is ported here.)
 *
 * The half-res masked extract doubles as the live u_feedbackTexture for the
 * black tunnel (bright spots boost nearby structure), replacing the stub.
 */

const QUAD_VERT = /* glsl */ `
varying vec2 v_uv;
void main() {
  v_uv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const EXTRACT_FRAG = /* glsl */ `
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_texture, v_uv);
  gl_FragColor = vec4(c.rgb * c.a, 1.0);
}
`

const COPY_FRAG = /* glsl */ `
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() {
  gl_FragColor = vec4(texture2D(u_texture, v_uv).rgb, 1.0);
}
`

// their blur9FragmentShader, verbatim weights
const BLUR9_FRAG = /* glsl */ `
uniform sampler2D u_texture;
uniform vec2 u_delta;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_texture, v_uv) * 0.1633;
  vec2 delta = u_delta;
  color += texture2D(u_texture, v_uv - delta) * 0.1531;
  color += texture2D(u_texture, v_uv + delta) * 0.1531;
  delta += u_delta;
  color += texture2D(u_texture, v_uv - delta) * 0.12245;
  color += texture2D(u_texture, v_uv + delta) * 0.12245;
  delta += u_delta;
  color += texture2D(u_texture, v_uv - delta) * 0.0918;
  color += texture2D(u_texture, v_uv + delta) * 0.0918;
  delta += u_delta;
  color += texture2D(u_texture, v_uv - delta) * 0.051;
  color += texture2D(u_texture, v_uv + delta) * 0.051;
  gl_FragColor = color;
}
`

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D u_scene;
uniform sampler2D u_bloom0;
uniform sampler2D u_bloom1;
uniform sampler2D u_bloom2;
uniform float u_strength;
uniform float u_saturation;
varying vec2 v_uv;
// scene is LINEAR HDR (their pipeline) — tone map + encode at the very end
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 scene = texture2D(u_scene, v_uv).rgb;
  vec3 bloom =
    texture2D(u_bloom0, v_uv).rgb * 0.5 +
    texture2D(u_bloom1, v_uv).rgb * 0.75 +
    texture2D(u_bloom2, v_uv).rgb * 1.0;
  float luma = dot(bloom, vec3(0.299, 0.587, 0.114));
  bloom = max(vec3(0.0), mix(vec3(luma), bloom, u_saturation));
  vec3 color = aces((scene + bloom * u_strength) * 1.1);
  gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
`

type Level = { a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget }

export type SelectiveBloom = {
  /** quarter-res copy of the last rendered frame — their feedbackRenderTarget:
   * the tunnel samples this offset by surface normal = the astronaut and the
   * bright LEDs reflecting onto nearby structure */
  feedbackTexture: THREE.Texture
  strength: { value: number }
  saturation: { value: number }
  setSize: (w: number, h: number) => void
  render: (scene: THREE.Scene, camera: THREE.Camera) => void
  /** pre-bloom scene texture (for the glass refraction input) */
  sceneTexture: THREE.Texture
  dispose: () => void
}

export function createSelectiveBloom(renderer: THREE.WebGLRenderer): SelectiveBloom {
  const opts: THREE.RenderTargetOptions = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  }
  const rtScene = new THREE.WebGLRenderTarget(1, 1, { ...opts, samples: 4 })
  const extract = new THREE.WebGLRenderTarget(1, 1, opts)
  const feedback = new THREE.WebGLRenderTarget(1, 1, opts)
  feedback.texture.wrapS = feedback.texture.wrapT = THREE.MirroredRepeatWrapping
  const levels: Level[] = [0, 1, 2].map(() => ({
    a: new THREE.WebGLRenderTarget(1, 1, opts),
    b: new THREE.WebGLRenderTarget(1, 1, opts),
  }))

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quadGeo = new THREE.PlaneGeometry(2, 2)
  const makePass = (frag: string, uniforms: Record<string, THREE.IUniform>) => {
    const scene = new THREE.Scene()
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false })
    scene.add(new THREE.Mesh(quadGeo, mat))
    return { scene, mat }
  }

  const extractPass = makePass(EXTRACT_FRAG, { u_texture: { value: rtScene.texture } })
  const copyPass = makePass(COPY_FRAG, { u_texture: { value: rtScene.texture } })
  const blurPass = makePass(BLUR9_FRAG, { u_texture: { value: null }, u_delta: { value: new THREE.Vector2() } })
  const strength = { value: 0.8 }
  const saturation = { value: 1 }
  const compositePass = makePass(COMPOSITE_FRAG, {
    u_scene: { value: rtScene.texture },
    u_bloom0: { value: levels[0].a.texture },
    u_bloom1: { value: levels[1].a.texture },
    u_bloom2: { value: levels[2].a.texture },
    u_strength: strength,
    u_saturation: saturation,
  })

  let W = 1, H = 1
  const setSize = (w: number, h: number) => {
    W = w; H = h
    rtScene.setSize(w, h)
    extract.setSize(w >> 1, h >> 1)
    feedback.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2))
    levels.forEach((l, i) => {
      const s = 2 + i
      l.a.setSize(Math.max(1, w >> s), Math.max(1, h >> s))
      l.b.setSize(Math.max(1, w >> s), Math.max(1, h >> s))
    })
  }

  const blit = (scene: THREE.Scene, to: THREE.WebGLRenderTarget | null) => {
    renderer.setRenderTarget(to)
    renderer.render(scene, cam)
  }

  const render = (scene: THREE.Scene, camera: THREE.Camera) => {
    // linear HDR scene pass (their pipeline) — tone mapping lives in composite
    const prevTM = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setRenderTarget(rtScene)
    renderer.render(scene, camera)
    renderer.toneMapping = prevTM

    // live feedback: quarter-res copy of the frame (their _onAfterRender)
    blit(copyPass.scene, feedback)

    // masked extract (their rgb*a)
    blit(extractPass.scene, extract)

    // 3 mip levels, blur9 H+V each, feeding downward
    let src: THREE.Texture = extract.texture
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i]
      blurPass.mat.uniforms.u_texture.value = src
      blurPass.mat.uniforms.u_delta.value.set(1.6 / Math.max(1, W >> (2 + i)), 0)
      blit(blurPass.scene, l.b)
      blurPass.mat.uniforms.u_texture.value = l.b.texture
      blurPass.mat.uniforms.u_delta.value.set(0, 1.6 / Math.max(1, H >> (2 + i)))
      blit(blurPass.scene, l.a)
      src = l.a.texture
    }

    blit(compositePass.scene, null)
    renderer.setRenderTarget(null)
  }

  return {
    feedbackTexture: feedback.texture,
    sceneTexture: rtScene.texture,
    strength,
    saturation,
    setSize,
    render,
    dispose: () => {
      rtScene.dispose()
      extract.dispose()
      feedback.dispose()
      levels.forEach((l) => { l.a.dispose(); l.b.dispose() })
      quadGeo.dispose()
    },
  }
}

/** force a material to write bloom-mask 0 (their suit/earth never bloom) */
export function noBloom(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      /}\s*$/,
      '  gl_FragColor.a = 0.0;\n}',
    )
  }
}
