import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE OWNER'S TWO RULES, pinned on the source itself: nothing on a screen
 * names the service the follower list comes from, and nothing on a screen
 * shows money — no dollar figure, no request count, for any role.
 *
 * Read from disk rather than rendered, so a chip added in a hurry fails a
 * test rather than a review.
 */

const ROOT = join(__dirname, '..')
const SCREENS = [
  'app/dashboard/social/[id]/followers/page.tsx',
  'app/dashboard/clients/FollowerSettings.tsx',
  'app/components/portal/PortalFollowers.tsx',
  'app/dashboard/production/[id]/HowItDid.tsx',
  'app/dashboard/board/Board.tsx',
]
const WIRE = [
  'app/api/social/accounts/[id]/followers/route.ts',
  'app/api/social/accounts/[id]/followers/refresh/route.ts',
  'app/api/clients/[id]/followers/route.ts',
  'app/api/social/followed-from-post/route.ts',
  'app/lib/portal-followers.ts',
]

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the Followers screens', () => {
  for (const file of SCREENS) {
    it(`${file} never names the service`, () => {
      expect(read(file)).not.toMatch(/hiker|apify|scrap(e|er|ing)/i)
    })
    it(`${file} never shows money or a request count`, () => {
      const src = read(file)
      // a template literal is `${x}`; a price is `$0.40`, `~$`, `USD`
      expect(src).not.toMatch(/~\$|\$\d|USD|per 1,?000|cost_note|requests:/i)
      expect(src).not.toMatch(/\bcost\b/i)
    })
  }
})

describe('the wire', () => {
  for (const file of WIRE) {
    it(`${file} hands no cost, request count, source or key to a browser`, () => {
      const src = read(file)
      expect(src).not.toMatch(/HIKER_API_KEY|APIFY_TOKEN/)
      expect(src).not.toMatch(/cost_note|\.requests\b|source:/)
    })
  }
})
