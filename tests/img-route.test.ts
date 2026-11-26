import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

/**
 * THE SMALL-COPY ROUTE (board-thumb-core has the why). Pinned: it only ever fetches a picture in our own storage;
 * a copy already made is only pointed at; a copy is made once, smaller, and saved under its worked-out name; and
 * whatever goes wrong, the board still gets a picture — the original.
 */
const BASE = 'https://pub-abc123.r2.dev'
const FILE = `${BASE}/1795398310833-photo.png`

const saved: { key: string; bytes: Buffer; type: string }[] = []
let configured = true
vi.mock('../app/lib/storage', () => ({
  r2Configured: () => configured,
  putObjectAt: async (key: string, bytes: Buffer, type: string) => { saved.push({ key, bytes, type }); return { key, publicUrl: `${BASE}/${key}` } },
}))

import { GET } from '../app/api/img/route'

const ask = (u: string, w = '640') => GET(new Request(`http://x/api/img?u=${encodeURIComponent(u)}&w=${w}`))
let calls: { url: string; method: string }[] = []
let bigPicture: Buffer
const realFetch = globalThis.fetch

beforeEach(async () => {
  saved.length = 0; calls = []; configured = true
  process.env.R2_PUBLIC_BASE_URL = BASE
  // a 2000 × 1500 photograph-ish picture: noise, so it does not squash to nothing
  const noise = Buffer.alloc(2000 * 1500 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
  bigPicture = await sharp(noise, { raw: { width: 2000, height: 1500, channels: 3 } }).png().toBuffer()
})
afterEach(() => { globalThis.fetch = realFetch; delete process.env.R2_PUBLIC_BASE_URL })

/** storage as the route sees it: which small copies exist, and what the original answers */
function storage(opts: { copyExists?: boolean; original?: Buffer | null; status?: number }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (method === 'HEAD') return new Response(null, { status: opts.copyExists ? 200 : 404 })
    if (opts.original == null) return new Response(null, { status: opts.status ?? 404 })
    return new Response(new Uint8Array(opts.original), { status: 200, headers: { 'content-length': String(opts.original.byteLength) } })
  }) as typeof fetch
}

describe('GET /api/img', () => {
  it('refuses anything that is not a picture in our own storage, and fetches nothing', async () => {
    storage({})
    for (const u of ['https://evil.example/a.png', 'http://169.254.169.254/x.png', `${BASE}/clip.mp4`, '']) {
      expect((await ask(u)).status, u).toBe(400)
    }
    expect(calls).toEqual([])
  })
  it('a copy already made is only pointed at — nothing is fetched or shrunk again', async () => {
    storage({ copyExists: true })
    const res = await ask(FILE)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(new RegExp(`^${BASE}/thumb/w640/[0-9a-f]{40}\\.webp$`))
    expect(calls.map(c => c.method)).toEqual(['HEAD'])
    expect(saved).toEqual([])
  })
  it('the first time: the picture is shrunk to the width asked, saved under its worked-out name, and pointed at', async () => {
    storage({ original: bigPicture })
    const res = await ask(FILE, '640')
    expect(res.status).toBe(302)
    expect(saved).toHaveLength(1)
    expect(saved[0].type).toBe('image/webp')
    expect(res.headers.get('location')).toBe(`${BASE}/${saved[0].key}`)
    const made = await sharp(saved[0].bytes).metadata()
    expect(made).toMatchObject({ format: 'webp', width: 640, height: 480 })
    expect(saved[0].bytes.byteLength).toBeLessThan(bigPicture.byteLength / 4)
  })
  it('a picture is never made BIGGER, and one that gains nothing is left as it is', async () => {
    const small = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).webp({ quality: 30 }).toBuffer()
    storage({ original: small })
    const res = await ask(FILE)
    expect(res.headers.get('location')).toBe(FILE)
    expect(saved).toEqual([])
  })
  it('whatever goes wrong, the board still gets a picture: the original', async () => {
    storage({ original: null, status: 500 })
    expect((await ask(FILE)).headers.get('location')).toBe(FILE)
    storage({ original: Buffer.from('this is not a picture at all') })
    expect((await ask(FILE)).headers.get('location')).toBe(FILE)
    configured = false; storage({ original: bigPicture })
    expect((await ask(FILE)).headers.get('location')).toBe(FILE)
    expect(saved).toEqual([])
  })
})
