import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roleSatisfies } from '../app/lib/identity-core'

/**
 * A scheduler uploading the media they are about to post.
 *
 * `TEAM_ROLES` puts scheduler BELOW editor, so the upload route's old
 * `guard('editor')` refused every scheduler — the error read "Insufficient
 * permissions" on a 960 MB file and looked like a size limit. The route is
 * the team floor now; this pins both halves so it cannot drift back.
 */
describe('who may upload media', () => {
  it('a scheduler does NOT satisfy editor — the reason the guard was wrong', () => {
    expect(roleSatisfies('scheduler', 'editor')).toBe(false)
    expect(roleSatisfies('scheduler', 'scheduler')).toBe(true)
  })

  it('the upload route guards on the team floor, and no client reaches it', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/website/upload/route.ts'), 'utf8')
    expect(src).toMatch(/guard\('scheduler'\)/)
    expect(src).not.toMatch(/guard\('editor'\)/)
    expect(roleSatisfies('client', 'scheduler')).toBe(false)
  })
})
