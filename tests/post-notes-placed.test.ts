import { describe, expect, it } from 'vitest'
import { firstNoteThread, openNoteCounts, placeNotes, unplacedUploads, type PostNote } from '../app/lib/post-window-core'

// 30 Sep 2026: Jordan's note on post 4's slide 6 vanished once the new slide 6 went in; brought back, it lit the new
// slide up blue as if it were still waiting. And the new slides were uploaded but never went into the post.

const note = (over: Partial<PostNote>): PostNote => ({
  id: 'n', post_id: 'p', version: 1, file_url: null, slide_index: null, visibility: 'client',
  author_id: null, author_name: 'Jordan', body: 'x', created_at: '2026-09-29T08:00:00Z', resolved_at: null, ...over,
})
const slides = ['a1', 'a2', 'a3', 'a4', 'a5', 'new6', 'a7', 'a8'].map(url => ({ url }))

describe('placeNotes', () => {
  it('a note on a file still in the post sits on that file’s slide, wherever it has moved', () => {
    const [p] = placeNotes([note({ file_url: 'a3', slide_index: 0 })], slides)
    expect(p).toMatchObject({ slide: 3, replaced: false })
  })
  it('a note on a file that was REPLACED stays on the slide it was written on, marked replaced', () => {
    const [p] = placeNotes([note({ file_url: 'old6', slide_index: 5 })], slides)
    expect(p).toMatchObject({ slide: 6, replaced: true })
  })
  it('a note on the whole post has no slide', () => {
    expect(placeNotes([note({})], slides)[0]).toMatchObject({ slide: null, replaced: false })
  })
})

describe('openNoteCounts — the blue number on a slide', () => {
  it('counts notes still to do, never ones on a replaced slide or resolved ones', () => {
    const placed = placeNotes([
      note({ id: '1', file_url: 'old6', slide_index: 5 }),                         // Jordan's, the slide since replaced
      note({ id: '2', file_url: 'a1', slide_index: 0 }),                           // still to do
      note({ id: '3', file_url: 'a1', slide_index: 0, resolved_at: '2026-09-30T00:00:00Z' }),
    ], slides)
    const counts = openNoteCounts(placed)
    expect(counts.get(6)).toBeUndefined()
    expect(counts.get(1)).toBe(1)
  })
})

describe('firstNoteThread', () => {
  it('opens on the client’s notes when the client has written any', () => {
    expect(firstNoteThread([note({ visibility: 'team' }), note({ visibility: 'client' })])).toBe('client')
    expect(firstNoteThread([note({ visibility: 'team' })])).toBe('team')
    expect(firstNoteThread([])).toBe('team')
  })
})

describe('unplacedUploads', () => {
  it('lists the files uploaded here that are not in the post — never ones from the library', () => {
    const files = [
      { url: 'new6', source: 'upload' },
      { url: 'new3', source: 'upload' },
      { url: 'lib1', source: 'library' },
    ]
    expect(unplacedUploads(files, slides).map(f => f.url)).toEqual(['new3'])
  })
})
