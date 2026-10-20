import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_ATTEMPTS, STALE_COPYING_MS, copyProgress, isMilanoteSrc, nextToCopy } from '../app/lib/milanote-media-core'

const row = (id: string, status: string, ago = 0) => ({ id, status, attempts: 0, updated_at: new Date(Date.now() - ago).toISOString() })

describe("copying Milanote's images and files into our storage (20 Oct 2026)", () => {
  it('fetches only from Milanote — never any other address', () => {
    expect(isMilanoteSrc('https://app.milanote.com/media/p/images/1UbQ/YLM/MDM00604.jpg')).toBe(true)
    expect(isMilanoteSrc('https://media.milanote.com/p/files/1Ug6/I9D/Brand%20Guidelines.pdf')).toBe(true)
    expect(isMilanoteSrc('http://app.milanote.com/x.jpg')).toBe(false)
    expect(isMilanoteSrc('https://evil.com/app.milanote.com.jpg')).toBe(false)
    expect(isMilanoteSrc('https://milanote.com.evil.com/x.jpg')).toBe(false)
    expect(isMilanoteSrc(null)).toBe(false)
  })

  it('takes rows still to do, and a copy a dead run left behind — never a finished or failed one', () => {
    const now = Date.now()
    const rows = [row('a', 'done'), row('b', 'todo'), row('c', 'copying', 60_000), row('d', 'copying', STALE_COPYING_MS + 60_000), row('e', 'failed')]
    expect(nextToCopy(rows, now, 10).map(r => r.id)).toEqual(['b', 'd'])
    expect(nextToCopy(rows, now, 1).map(r => r.id)).toEqual(['b'])
  })

  it('counts how far it has got', () => {
    expect(copyProgress([row('a', 'done'), row('b', 'todo'), row('c', 'failed')])).toEqual({ done: 1, failed: 1, left: 1, total: 3 })
  })

  it('gives up on a file after three tries', () => {
    expect(MAX_ATTEMPTS).toBe(3)
  })

  it('the job is registered, claims each file before copying it, and only a super admin starts it', () => {
    const fns = readFileSync('app/inngest/functions.ts', 'utf8')
    expect(fns).toContain("triggers: [{ event: 'milanote/media.copy' }]")
    expect(fns).toMatch(/export const functions = \[[\s\S]*milanoteMediaCopy/)
    expect(readFileSync('app/lib/milanote-media.ts', 'utf8')).toContain('.claim(')
    expect(readFileSync('app/api/production/team-boards/milanote-media/route.ts', 'utf8').match(/requireRole\('super_admin'\)/g)).toHaveLength(2)
  })
})
