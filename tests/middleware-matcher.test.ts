import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * EVERY ROUTE THAT ASKS "WHO IS THIS?" MUST BE ONE THE MIDDLEWARE RAN ON.
 *
 * Clerk's auth() throws unless clerkMiddleware ran for the request, and the
 * middleware only runs for paths in `config.matcher`. A route that calls
 * requireRole / requireSignedIn / guard / resolveTeamUser from outside the
 * matcher is not "unprotected" — it is a 500 on every call, which is how
 * the board's link previews were dead in production for anyone who tried
 * one (the owner, 9 Sep 2026: "does the post linking work?" — no: "Clerk:
 * auth() was called but Clerk can't detect usage of clerkMiddleware()").
 *
 * Read off the files, so the next route written outside the list fails
 * here rather than in somebody's browser. A route that is meant to be
 * Clerk-free (the portal, the client's connect link, the contact form)
 * simply does not call auth() and is not on this list.
 */
const root = join(__dirname, '..')

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) routeFiles(p, out)
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

/** '/api/foo/[id]/bar' → the path as a request would spell it, id and all */
const pathOf = (file: string) =>
  '/' + relative(join(root, 'app'), file).replace(/\\/g, '/').replace(/\/route\.ts$/, '')

const CALLS_AUTH = /\b(requireRole|requireSignedIn|guard|resolveTeamUser|requireFilesAccess)\s*\(/

describe('the middleware matcher covers every route that calls auth()', () => {
  const middleware = readFileSync(join(root, 'middleware.ts'), 'utf8')
  const matcher = [...middleware.matchAll(/'(\/api\/[^']+)'/g)]
    .map(m => m[1].replace(/\/:path\*$/, ''))

  it('lists at least the routes it always did', () => {
    for (const p of ['/api/production', '/api/social', '/api/team', '/api/leads']) expect(matcher).toContain(p)
  })

  it('and every other route that asks who is calling', () => {
    const missing: string[] = []
    for (const file of routeFiles(join(root, 'app', 'api'))) {
      const src = readFileSync(file, 'utf8')
      if (!CALLS_AUTH.test(src)) continue
      const path = pathOf(file)
      const covered = matcher.some(m => path === m || path.startsWith(`${m}/`))
      if (!covered) missing.push(path)
    }
    expect(missing, 'routes calling auth() outside the middleware matcher (every call 500s)').toEqual([])
  })
})
