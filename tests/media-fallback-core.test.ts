import { describe, expect, it } from 'vitest'
import { MEDIA_PATH, ownAddress, mediaRewrite } from '../app/lib/media-fallback-core'

const BASE = 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev'
const PAGE = 'https://app.mdmmarketing.com.au'

describe('ownAddress — where a stored file is asked for again when its storage address cannot be reached', () => {
  it('a picture in our storage is asked for through our own site', () => {
    expect(ownAddress(`${BASE}/1795090453072-yoxedt-138.png`, BASE, PAGE)).toBe(`${MEDIA_PATH}/1795090453072-yoxedt-138.png`)
  })

  it('a video keeps the frame it was opened at', () => {
    expect(ownAddress(`${BASE}/a-film.mov#t=0.001`, BASE, PAGE)).toBe(`${MEDIA_PATH}/a-film.mov#t=0.001`)
  })

  it('a small copy asked for through /api/img falls back to the original picture', () => {
    const src = `/api/img?u=${encodeURIComponent(`${BASE}/pic.png`)}&w=640`
    expect(ownAddress(src, BASE, PAGE)).toBe(`${MEDIA_PATH}/pic.png`)
    expect(ownAddress(`${PAGE}${src}`, BASE, PAGE)).toBe(`${MEDIA_PATH}/pic.png`)
  })

  it('a small copy already in storage is asked for through our own site too', () => {
    expect(ownAddress(`${BASE}/thumb/w640/abc.webp`, BASE, PAGE)).toBe(`${MEDIA_PATH}/thumb/w640/abc.webp`)
  })

  it('a name with spaces or brackets is passed on as it was written', () => {
    expect(ownAddress(`${BASE}/Senorita%20Graphics%20(2).png`, BASE, PAGE)).toBe(`${MEDIA_PATH}/Senorita%20Graphics%20(2).png`)
  })

  it('a storage base with a folder in it keeps only what is inside the folder', () => {
    expect(ownAddress('https://cdn.example.com/files/a.png', 'https://cdn.example.com/files/', PAGE)).toBe(`${MEDIA_PATH}/a.png`)
    expect(ownAddress('https://cdn.example.com/other/a.png', 'https://cdn.example.com/files/', PAGE)).toBeNull()
  })

  it('anything that is not in our storage is left alone', () => {
    expect(ownAddress('https://scontent.cdninstagram.com/x.jpg', BASE, PAGE)).toBeNull()
    expect(ownAddress('https://pub-someone-else.r2.dev/x.png', BASE, PAGE)).toBeNull()
    expect(ownAddress(`/api/img?u=${encodeURIComponent('https://evil.example/x.png')}`, BASE, PAGE)).toBeNull()
    expect(ownAddress('/MDLogo-trim.png', BASE, PAGE)).toBeNull()
    expect(ownAddress('data:image/png;base64,AAAA', BASE, PAGE)).toBeNull()
    expect(ownAddress('blob:https://app.mdmmarketing.com.au/1-2-3', BASE, PAGE)).toBeNull()
    expect(ownAddress('', BASE, PAGE)).toBeNull()
    expect(ownAddress(null, BASE, PAGE)).toBeNull()
  })

  it('never sends a file round again that already came through our own site', () => {
    expect(ownAddress(`${MEDIA_PATH}/pic.png`, BASE, PAGE)).toBeNull()
    expect(ownAddress(`${PAGE}${MEDIA_PATH}/pic.png`, BASE, PAGE)).toBeNull()
  })

  it('does nothing when storage has no public address', () => {
    expect(ownAddress(`${BASE}/pic.png`, null, PAGE)).toBeNull()
    expect(ownAddress(`${BASE}/pic.png`, 'not an address', PAGE)).toBeNull()
  })
})

describe('mediaRewrite — the rule that passes /media on to storage', () => {
  it('points at the storage base, whatever slash it ends with', () => {
    expect(mediaRewrite(`${BASE}/`)).toEqual({ source: `${MEDIA_PATH}/:path*`, destination: `${BASE}/:path*` })
    expect(mediaRewrite(BASE)).toEqual({ source: `${MEDIA_PATH}/:path*`, destination: `${BASE}/:path*` })
  })

  it('is not made without a storage address, or for one that is not https', () => {
    expect(mediaRewrite(undefined)).toBeNull()
    expect(mediaRewrite('')).toBeNull()
    expect(mediaRewrite('http://insecure.example')).toBeNull()
    expect(mediaRewrite('nonsense')).toBeNull()
  })
})
