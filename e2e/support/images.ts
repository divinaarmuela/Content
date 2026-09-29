import { deflateSync } from 'node:zlib'

/**
 * Small, real PNG files made in memory — one solid colour each, so no two
 * files in a carousel are the same bytes. Nothing is read from disk, and no
 * client's real media is ever used in a journey.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** A `size`×`size` PNG of one colour. Instagram wants at least 320 px, so the default is 1080. */
export function solidPng(r: number, g: number, b: number, size = 1080): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour RGB
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** `count` distinct PNGs, named so a person reading the ZZ client's files knows where they came from. */
export function testImages(count: number, tag: string): { name: string; mimeType: string; buffer: Buffer }[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `e2e-${tag}-${String(i + 1).padStart(2, '0')}.png`,
    mimeType: 'image/png',
    buffer: solidPng((37 * (i + 1)) % 256, (91 * (i + 3)) % 256, (53 * (i + 7)) % 256),
  }))
}
