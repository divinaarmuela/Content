import * as THREE from 'three'

/**
 * Finale dressing, from their code:
 *  - GoalWhiteTunnelStickers: their stickers.png atlas (1465×1024) with their
 *    exact 26 sticker rects, scattered around the astronaut
 *  - the LED message card (GoalTunnelAstronauts.updateCard): face.png stepped
 *    tile-by-tile at 10Hz through their 11×11 LED subpixel texture, flickering
 */

// their goalWhiteTunnelStickerData, verbatim
const STICKER_DATA = [
  { x: 1132, y: 3, w: 195, h: 195 }, { x: 744, y: 3, w: 195, h: 256 },
  { x: 525, y: 3, w: 213, h: 282 }, { x: 242, y: 3, w: 277, h: 286 },
  { x: 1055, y: 633, w: 209, h: 209 }, { x: 1076, y: 398, w: 209, h: 209 },
  { x: 3, y: 772, w: 298, h: 249 }, { x: 945, y: 3, w: 181, h: 249 },
  { x: 1291, y: 389, w: 160, h: 197 }, { x: 1055, y: 848, w: 83, h: 122 },
  { x: 1132, y: 204, w: 167, h: 179 }, { x: 1270, y: 828, w: 192, h: 193 },
  { x: 780, y: 265, w: 182, h: 167 }, { x: 564, y: 445, w: 294, h: 184 },
  { x: 307, y: 683, w: 205, h: 334 }, { x: 864, y: 438, w: 206, h: 189 },
  { x: 968, y: 258, w: 149, h: 134 }, { x: 734, y: 635, w: 165, h: 382 },
  { x: 605, y: 291, w: 169, h: 141 }, { x: 302, y: 445, w: 256, h: 232 },
  { x: 518, y: 683, w: 210, h: 266 }, { x: 242, y: 295, w: 357, h: 144 },
  { x: 3, y: 3, w: 233, h: 469 }, { x: 905, y: 633, w: 144, h: 340 },
  { x: 1270, y: 613, w: 187, h: 209 }, { x: 3, y: 478, w: 293, h: 288 },
]
const ATLAS_W = 1465
const ATLAS_H = 1024

export type Stickers = {
  group: THREE.Group
  update: (t: number, activeRatio: number) => void
}

export function createStickers(assetBase: string): Stickers {
  const tex = new THREE.TextureLoader().load(`${assetBase}/textures/stickers.png`)
  tex.colorSpace = THREE.SRGBColorSpace
  const group = new THREE.Group()
  const items: { mesh: THREE.Mesh; seed: number; base: THREE.Vector3; scale: number; aspect: number }[] = []
  const geo = new THREE.PlaneGeometry(1, 1)
  for (let i = 0; i < STICKER_DATA.length; i++) {
    const d = STICKER_DATA[i]
    const map = tex.clone()
    map.colorSpace = THREE.SRGBColorSpace
    map.offset.set(d.x / ATLAS_W, 1 - (d.y + d.h) / ATLAS_H)
    map.repeat.set(d.w / ATLAS_W, d.h / ATLAS_H)
    const mat = new THREE.MeshBasicMaterial({
      map, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    const scale = 0.7 + Math.random() * 0.9
    mesh.scale.set(scale * (d.w / d.h), scale, 1)
    const a = (i / STICKER_DATA.length) * Math.PI * 2 + Math.random() * 0.5
    const r = 2.6 + Math.random() * 4.5
    const base = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.7, -1 - Math.random() * 5)
    mesh.position.copy(base)
    group.add(mesh)
    items.push({ mesh, seed: Math.random() * 10, base, scale, aspect: d.w / d.h })
  }
  const update = (t: number, activeRatio: number) => {
    group.visible = activeRatio > 0.001
    if (!group.visible) return
    for (const it of items) {
      const pop = Math.min(1, Math.max(0, activeRatio * 1.6 - it.seed * 0.06))
      const s = 1 - Math.pow(1 - pop, 3)
      const k = 0.001 + s * it.scale
      it.mesh.scale.set(k * it.aspect, k, 1)
      it.mesh.position.set(
        it.base.x + Math.sin(t * 0.5 + it.seed) * 0.25,
        it.base.y + Math.cos(t * 0.4 + it.seed * 2) * 0.25,
        it.base.z,
      )
      it.mesh.rotation.z = Math.sin(t * 0.3 + it.seed * 3) * 0.25
    }
  }
  return { group, update }
}

const CARD_FRAG = /* glsl */ `
uniform sampler2D u_cardTexture;
uniform sampler2D u_ledTexture;
uniform vec2 u_cardUvOffset;
uniform vec2 u_tile;
uniform vec2 u_ledGrid;
uniform vec3 u_color;
uniform float u_opacity;
varying vec2 v_uv;
void main() {
  float on = texture2D(u_cardTexture, u_cardUvOffset + v_uv * u_tile).r;
  vec3 led = texture2D(u_ledTexture, fract(v_uv * u_ledGrid)).rgb;
  vec3 color = on * led * u_color * 2.5;
  gl_FragColor = vec4(color * u_opacity, u_opacity * on);
}
`

export type LedCard = {
  mesh: THREE.Mesh
  update: (t: number, light: number) => void
}

export function createLedCard(assetBase: string): LedCard {
  const cardTex = new THREE.TextureLoader().load(`${assetBase}/textures/face.png`, (t) => {
    const w = t.image.width, h = t.image.height
    uniforms.u_tile.value.set(11 / w, 11 / h)
    cols = Math.max(1, Math.floor(w / 11))
    rows = Math.max(1, Math.floor(h / 11))
  })
  cardTex.minFilter = cardTex.magFilter = THREE.NearestFilter

  // their 11×11 LED subpixel canvas
  const c = document.createElement('canvas')
  c.width = c.height = 11
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 11, 11)
  ctx.fillStyle = '#f00'; ctx.fillRect(1, 1, 3, 9)
  ctx.fillStyle = '#0f0'; ctx.fillRect(4, 1, 3, 9)
  ctx.fillStyle = '#00f'; ctx.fillRect(7, 1, 3, 9)
  const ledTex = new THREE.Texture(c)
  ledTex.needsUpdate = true
  ledTex.wrapS = ledTex.wrapT = THREE.RepeatWrapping
  ledTex.minFilter = THREE.LinearFilter

  let cols = 8, rows = 1
  const uniforms = {
    u_cardTexture: { value: cardTex },
    u_ledTexture: { value: ledTex },
    u_cardUvOffset: { value: new THREE.Vector2() },
    u_tile: { value: new THREE.Vector2(1, 1) },
    u_ledGrid: { value: new THREE.Vector2(11, 11) },
    u_color: { value: new THREE.Color('#aaaafb') }, // their faceLedColor
    u_opacity: { value: 0 },
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
varying vec2 v_uv;
void main() { v_uv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: CARD_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  )
  mesh.frustumCulled = false

  const update = (t: number, light: number) => {
    // their updateCard: 10Hz tile stepping through the message strip
    const n = Math.floor((10 * t) % (cols * rows))
    uniforms.u_cardUvOffset.value.set(
      (n % cols) * uniforms.u_tile.value.x,
      1 - uniforms.u_tile.value.y - Math.floor(n / cols) * uniforms.u_tile.value.y,
    )
    uniforms.u_opacity.value = light
    mesh.visible = light > 0.01
  }
  return { mesh, update }
}
