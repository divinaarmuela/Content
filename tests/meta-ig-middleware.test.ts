import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WHO MAY REACH THE INSTAGRAM LOGIN ROUTES (1 Oct 2026). Read off
 * middleware.ts, so a widening to '/api/meta(.*)' — which would put Meta's
 * own callers behind Clerk and break the login and every webhook — fails
 * here, and so does dropping the gate from /connect.
 */
const src = readFileSync(join(__dirname, '..', 'middleware.ts'), 'utf8')
const protectedBlock = src.slice(src.indexOf('createRouteMatcher(['), src.indexOf('])', src.indexOf('createRouteMatcher([')))
const matcherBlock = src.slice(src.indexOf('matcher: ['))
const entries = (block: string) => [...block.matchAll(/'(\/[^']+)'/g)].map(m => m[1])

/** does a createRouteMatcher-style pattern ('/x(.*)') or a Next matcher ('/x/:path*') cover this path? */
const covers = (pattern: string, path: string) => {
  const re = new RegExp('^' + pattern.replace(/\/:path\*$/, '(/.*)?').replace(/\(\.\*\)/g, '.*') + '$')
  return re.test(path)
}

describe('middleware and the Instagram Login routes', () => {
  it('the connect route and the accounts list are protected and matched', () => {
    for (const p of ['/api/meta/instagram/connect', '/api/meta/instagram/accounts']) {
      expect(entries(protectedBlock).some(e => covers(e, p)), `${p} protected`).toBe(true)
      expect(entries(matcherBlock).some(e => covers(e, p)), `${p} matched`).toBe(true)
    }
  })

  it('the callback and the webhook are public — neither protected nor matched', () => {
    for (const p of ['/api/meta/instagram/callback', '/api/meta/webhook']) {
      expect(entries(protectedBlock).filter(e => covers(e, p)), `${p} must not be protected`).toEqual([])
      expect(entries(matcherBlock).filter(e => covers(e, p)), `${p} must not run Clerk`).toEqual([])
    }
  })

  it('the contact form stays public and /api/leads stays gated', () => {
    expect(entries(protectedBlock).some(e => covers(e, '/api/submit'))).toBe(false)
    expect(entries(protectedBlock).some(e => covers(e, '/api/leads'))).toBe(true)
  })

  it('the public routes do not ask who is calling', () => {
    for (const f of ['app/api/meta/instagram/callback/route.ts', 'app/api/meta/webhook/route.ts']) {
      const route = readFileSync(join(__dirname, '..', f), 'utf8')
      expect(route, f).not.toMatch(/\b(requireRole|requireSignedIn|guard|resolveTeamUser|auth)\s*\(/)
    }
  })
})

describe('the portable part stays portable (the owner, 1 Oct 2026: may be reused in unlk.ai)', () => {
  it('meta-ig-core.ts and meta-ig-client.ts import nothing of MD Media', () => {
    for (const f of ['app/lib/meta-ig-core.ts', 'app/lib/meta-ig-client.ts']) {
      const code = readFileSync(join(__dirname, '..', f), 'utf8')
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map(m => m[1])
      expect(imports.filter(i => !i.startsWith('node:') && i !== './meta-ig-core'), f).toEqual([])
    }
  })
})

