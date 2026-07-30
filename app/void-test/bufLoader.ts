import * as THREE from 'three'

/**
 * Loader for Lusion's custom `.buf` geometry format (reverse-engineered for a
 * private replication test — assets are © Lusion, NOT for publication).
 *
 * Layout: [uint32 LE headerLength][JSON header][binary payload]
 * The header lists attributes IN PAYLOAD ORDER. Each attribute block is
 * `count * componentSize` elements of `storageType`, where count is
 * `indexCount` for the "indices" attribute and `vertexCount` otherwise.
 * Attributes with `needsPack: true` are quantized: each component c maps
 * raw → from[c] + delta[c] * normalize(raw), normalize() being the usual
 * 0..1 (unsigned) / -min..max (signed) integer normalization.
 */

type PackedComponent = { from: number; delta: number }

type BufAttribute = {
  id: string
  needsPack: boolean
  componentSize: number
  storageType: 'Float32Array' | 'Uint32Array' | 'Int32Array' | 'Uint16Array' | 'Int16Array' | 'Uint8Array' | 'Int8Array'
  packedComponents?: PackedComponent[]
}

type BufHeader = {
  vertexCount: number
  indexCount: number
  attributes: BufAttribute[]
  meshType: 'Mesh' | 'Points'
}

const CTORS = {
  Float32Array,
  Uint32Array,
  Int32Array,
  Uint16Array,
  Int16Array,
  Uint8Array,
  Int8Array,
} as const

const normalize = (raw: number, type: BufAttribute['storageType']) => {
  switch (type) {
    case 'Uint16Array': return raw / 65535
    case 'Int16Array':  return (raw + 32768) / 65535
    case 'Uint8Array':  return raw / 255
    case 'Int8Array':   return (raw + 128) / 255
    default:            return raw
  }
}

export type BufResult = {
  geometry: THREE.BufferGeometry
  header: BufHeader
  /** raw (dequantized) streams by attribute id, incl. non-geometry ones */
  streams: Record<string, THREE.TypedArray>
}

export async function loadBuf(url: string): Promise<BufResult> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`buf fetch failed: ${url} (${res.status})`)
  const buffer = await res.arrayBuffer()

  const headerLength = new DataView(buffer).getUint32(0, true)
  const header: BufHeader = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)),
  )

  let offset = 4 + headerLength
  const streams: Record<string, THREE.TypedArray> = {}

  for (const attr of header.attributes) {
    const Ctor = CTORS[attr.storageType]
    const count = (attr.id === 'indices' ? header.indexCount : header.vertexCount) * attr.componentSize
    const bytes = count * Ctor.BYTES_PER_ELEMENT
    // slice() copies, guaranteeing alignment regardless of offset
    const raw = new Ctor(buffer.slice(offset, offset + bytes))
    offset += bytes

    if (attr.needsPack && attr.packedComponents) {
      const out = new Float32Array(count)
      const cs = attr.componentSize
      for (let i = 0; i < count; i++) {
        const { from, delta } = attr.packedComponents[i % cs]
        out[i] = from + delta * normalize(raw[i], attr.storageType)
      }
      streams[attr.id] = out
    } else {
      streams[attr.id] = raw
    }
  }

  const geometry = new THREE.BufferGeometry()
  const setAttr = (id: string, threeName: string, size: number) => {
    const s = streams[id]
    if (s) geometry.setAttribute(threeName, new THREE.BufferAttribute(s as Float32Array, size))
  }
  setAttr('position', 'position', 3)
  setAttr('normal', 'normal', 3)
  setAttr('uv', 'uv', 2)
  setAttr('tangent', 'tangent', 4)
  if (streams.indices) geometry.setIndex(new THREE.BufferAttribute(streams.indices as Uint16Array, 1))
  if (!streams.normal && header.meshType === 'Mesh') geometry.computeVertexNormals()

  return { geometry, header, streams }
}
