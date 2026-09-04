import { describe, it, expect } from 'vitest'
import {
  IMAGE_EXTENSIONS, OBJECT_KEY_SHAPE, extensionOf, ourStorageUrl, storedFileIsUsable,
} from '@/app/lib/storage-core'

/**
 * IS THIS ONE OF OUR OWN FILES?
 *
 * The question a route has to answer before it writes a file into a version a
 * client has already approved. Getting it wrong once means a picture nobody
 * has seen is published under somebody's yes, so the guard is pinned here
 * rather than left to a `^https:` regex and a hopeful comment.
 */

const BASE = 'https://media.mdmmarketing.com.au'
const KEY = '1756000000000-a1b2c3-hero_shot.jpg'
const OURS = `${BASE}/${KEY}`

describe('the key shape objectKey() mints', () => {
  it('matches what we write', () => {
    expect(OBJECT_KEY_SHAPE.test(KEY)).toBe(true)
    expect(OBJECT_KEY_SHAPE.test('1756000000000-a1b2c3-a.b.c-d_e.png')).toBe(true)
  })
  it('and nothing else', () => {
    for (const bad of ['hero.jpg', 'uploads/1756000000000-a1b2c3-a.jpg', '1756-a-a.jpg', '']) {
      expect(OBJECT_KEY_SHAPE.test(bad), bad).toBe(false)
    }
  })
})

describe('ourStorageUrl', () => {
  it('accepts a file on our own base with a key we minted', () => {
    expect(ourStorageUrl(OURS, BASE, 'image')).toBe(OURS)
    expect(ourStorageUrl(OURS, `${BASE}/`, 'image')).toBe(OURS)
  })

  it('refuses another host, however much it looks like ours', () => {
    for (const bad of [
      `https://evil.example/${KEY}`,
      `https://media.mdmmarketing.com.au.evil.example/${KEY}`,
      `https://evil.example/?x=${BASE}/${KEY}`,
      `http://media.mdmmarketing.com.au/${KEY}`,
      `${BASE.replace('https', 'ftp')}/${KEY}`,
    ]) {
      expect(ourStorageUrl(bad, BASE, 'image'), bad).toBeNull()
    }
  })

  it('refuses a key that climbs out of the bucket or addresses something else', () => {
    for (const bad of [
      `${BASE}/../secrets/${KEY}`,
      `${BASE}/1756000000000-a1b2c3-../one.jpg`,
      `${BASE}//${KEY}`,
      `${BASE}/${KEY}?sig=abc`,
      `${BASE}/${KEY}#x`,
      `${BASE}/1756000000000-a1b2c3-one.jpg\\..\\x`,
      `${BASE}/`,
    ]) {
      expect(ourStorageUrl(bad, BASE, 'image'), bad).toBeNull()
    }
  })

  it('refuses an extension the kind does not allow', () => {
    for (const ext of ['svg', 'html', 'mp4', 'json', 'js']) {
      expect(ourStorageUrl(`${BASE}/1756000000000-a1b2c3-x.${ext}`, BASE, 'image'), ext).toBeNull()
    }
    for (const ext of IMAGE_EXTENSIONS) {
      expect(ourStorageUrl(`${BASE}/1756000000000-a1b2c3-x.${ext}`, BASE, 'image'), ext)
        .not.toBeNull()
    }
    expect(ourStorageUrl(`${BASE}/1756000000000-a1b2c3-x.mp4`, BASE, 'video')).not.toBeNull()
  })

  it('refuses everything when we do not know where our own files live', () => {
    expect(ourStorageUrl(OURS, null, 'image')).toBeNull()
    expect(ourStorageUrl(OURS, '', 'image')).toBeNull()
    // a base that is not itself https cannot be trusted to bound anything
    expect(ourStorageUrl(OURS, 'media.mdmmarketing.com.au', 'image')).toBeNull()
  })

  it('reads the extension off the key, not off a query string', () => {
    expect(extensionOf('a/b/hero_shot.JPG')).toBe('jpg')
    expect(extensionOf('hero.png?v=2')).toBe('png')
    expect(extensionOf('nodot')).toBe('')
  })
})

describe('what the storage host says about the file', () => {
  it('has to agree that it is a picture', () => {
    expect(storedFileIsUsable({ contentType: 'image/jpeg', bytes: 100 }, 'image', 1000).ok)
      .toBe(true)
    const html = storedFileIsUsable({ contentType: 'text/html', bytes: 100 }, 'image', 1000)
    expect(html.ok).toBe(false)
    expect(html.ok === false && html.why).toMatch(/not a picture/)
  })

  it('has to be a sane size', () => {
    const big = storedFileIsUsable({ contentType: 'image/png', bytes: 5000 }, 'image', 1000)
    expect(big.ok).toBe(false)
    expect(big.ok === false && big.why).toMatch(/too big/)
    // no length header is not proof of anything, so it is not held against it
    expect(storedFileIsUsable({ contentType: 'image/png', bytes: null }, 'image', 1000).ok)
      .toBe(true)
  })

  it('refuses a file the host will not talk about at all', () => {
    const missing = storedFileIsUsable(null, 'image', 1000)
    expect(missing.ok).toBe(false)
    expect(missing.ok === false && missing.why).toMatch(/not in our storage/)
  })
})
