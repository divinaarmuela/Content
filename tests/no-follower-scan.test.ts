import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * THE FOLLOWER SCAN IS GONE (the owner, 1 Oct 2026: "can't you just remove this page now"). The People page, the
 * per-account Followers page, the post's "Who it brought in" page and everything that read a third party's copy of
 * an Instagram account's followers and likers were removed, with the scan's job. This keeps them from coming back by
 * accident: no file under app/ may import the removed modules, and no code may read the provider's key.
 */
const ROOT = join(__dirname, '..')

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...filesUnder(full))
    else if (/\.(ts|tsx|js|jsx|mjs|mts)$/.test(name)) out.push(full)
  }
  return out
}

const REMOVED_MODULES = ['followers', 'followers-core', 'follower-source', 'portal-followers', 'post-interactors', 'people-analytics', 'people-analytics-core', 'post-leads', 'post-leads-core', 'follower-avatar-core']

describe('the follower scan stays removed', () => {
  const appFiles = filesUnder(join(ROOT, 'app'))

  it('no file under app/ imports a removed module', () => {
    const importRe = new RegExp(`(?:from|import\\()\\s*['"][^'"]*/(?:${REMOVED_MODULES.join('|')})['"]`)
    const offenders = appFiles.filter(f => importRe.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f))
    expect(offenders).toEqual([])
  })

  it('the removed modules, pages and routes are not on disk', () => {
    for (const m of REMOVED_MODULES) expect(existsSync(join(ROOT, 'app/lib', `${m}.ts`)), m).toBe(false)
    for (const p of [
      'app/dashboard/social/people', 'app/dashboard/social/[id]/followers', 'app/dashboard/social/posts/[id]/leads',
      'app/api/social/people', 'app/api/social/followed-from-post', 'app/api/social/posts/[id]/people',
      'app/api/social/accounts/[id]/followers', 'app/api/clients/[id]/followers',
    ]) expect(existsSync(join(ROOT, p)), p).toBe(false)
  })

  it('no code reads the provider’s key, and no Inngest function looks at followers', () => {
    const code = [...appFiles, ...filesUnder(join(ROOT, 'lib')), ...filesUnder(join(ROOT, 'scripts'))]
    const offenders = code.filter(f => /HIKER_API_KEY|hikerapi/i.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f))
    expect(offenders).toEqual([])
    const fns = readFileSync(join(ROOT, 'app/inngest/functions.ts'), 'utf8')
    expect(fns).not.toContain("'followers-daily'")
    expect(fns).not.toContain("'followers-snapshot'")
    expect(fns).not.toContain('app/followers.snapshot.requested')
  })

  it('the generated types carry no follower tables or columns', () => {
    const types = readFileSync(join(ROOT, 'lib/db-types.ts'), 'utf8')
    for (const word of ['follower_snapshots', 'FollowerSnapshot', 'interactors', 'followers_on_portal', 'followers_daily_top', 'followers_full_cadence']) {
      expect(types, word).not.toContain(word)
    }
  })
})
