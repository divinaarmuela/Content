import { describe, it, expect } from 'vitest'
import { keepVersion, readHistory } from '../app/lib/client-report-core'

describe('a report is never overwritten (4 Nov 2026)', () => {
  it('the current text is kept, newest first, with who wrote and who replaced it', () => {
    const h = keepVersion({ body: 'v1', generated_at: 'a', generated_by: 'manal', updated_at: 'b', updated_by: 'karly', history: [{ body: 'v0', replaced_at: 'x', replaced_by: 'y' }] }, 'akmal', 'now')
    expect(h[0]).toMatchObject({ body: 'v1', written_by: 'manal', edited_by: 'karly', replaced_by: 'akmal', replaced_at: 'now' })
    expect(h[1].body).toBe('v0')
  })
  it('nothing written yet: nothing to keep', () => {
    expect(keepVersion({ body: '' }, 'a', 'now')).toEqual([])
  })
  it('reads only real versions', () => {
    expect(readHistory([{ body: 'x' }, null, 3])).toHaveLength(1)
  })
})
