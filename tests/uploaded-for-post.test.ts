import { describe, expect, it } from 'vitest'
import { uploadedForPost } from '../app/lib/version-files-core'

// 30 Sep 2026: every corrected slide uploaded for Jordan's post was refused on Save — "One of those files is not part
// of the approved version". A file OUR upload recorded may now go on a draft; a link from anywhere else may not.

const R2 = 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/'

describe('uploadedForPost', () => {
  const known = new Set([`${R2}1-new-3.png`, `${R2}2-new-7.png`])

  it('takes a file the app uploaded, as an upload, with its measurements', () => {
    const out = uploadedForPost([{ url: `${R2}1-new-3.png`, name: '3.png', width: 2160, height: 2700 }], known, [])
    expect(out).toEqual([{ url: `${R2}1-new-3.png`, name: '3.png', type: 'image', width: 2160, height: 2700, bytes: undefined, seconds: undefined, source: 'upload' }])
  })
  it('never takes a link the app did not upload', () => {
    expect(uploadedForPost([{ url: 'https://evil.example/x.png' }], known, [])).toEqual([])
  })
  it('never repeats a file that was allowed anyway, nor one named twice', () => {
    const out = uploadedForPost([{ url: `${R2}1-new-3.png` }, { url: `${R2}1-new-3.png` }, { url: `${R2}2-new-7.png` }], known, [{ url: `${R2}2-new-7.png` }])
    expect(out.map(s => s.url)).toEqual([`${R2}1-new-3.png`])
  })
  it('a video upload is a video', () => {
    const k = new Set([`${R2}clip.mov`])
    expect(uploadedForPost([{ url: `${R2}clip.mov` }], k, [])[0].type).toBe('video')
  })
  it('nothing asked, nothing taken', () => {
    expect(uploadedForPost(undefined, known, [])).toEqual([])
  })
})
