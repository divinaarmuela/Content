import { describe, expect, it } from 'vitest'
import { mediaUsedBefore } from '../app/lib/schedule-compose-core'

const img = (n: string) => ({ url: `https://media.test/${n}.jpg`, name: `${n}.jpg`, type: 'image' })

describe('the picker\'s "Used before" tab (26 Oct 2026)', () => {
  const posts = [
    { id: 'old', client_id: 'c1', slides: [img('a'), img('b')], updated_at: '2026-10-01T00:00:00Z' },
    { id: 'new', client_id: 'c1', slides: [img('b'), img('c')], updated_at: '2026-10-20T00:00:00Z' },
    { id: 'draft', client_id: 'c1', slides: [img('d')], created_at: '2026-10-10T00:00:00Z' },
    { id: 'other', client_id: 'c2', slides: [img('x')], updated_at: '2026-10-25T00:00:00Z' },
    { id: 'this', client_id: 'c1', slides: [img('mine')], updated_at: '2026-10-26T00:00:00Z' },
  ]
  it('lists every file on the client\'s other posts once, newest post first', () => {
    expect(mediaUsedBefore(posts, 'c1', 'this').map(s => s.name)).toEqual(['b.jpg', 'c.jpg', 'd.jpg', 'a.jpg'])
  })
  it('never shows another client\'s files, and nothing without a client', () => {
    expect(mediaUsedBefore(posts, 'c1').some(s => s.name === 'x.jpg')).toBe(false)
    expect(mediaUsedBefore(posts, null)).toEqual([])
  })
})
