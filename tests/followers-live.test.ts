import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The real provider, on demand only:
 *
 *   LIVE=1 npx vitest run tests/followers-live.test.ts
 *
 * Two requests (a profile, one followers page) against a public account.
 * Every completed response is billed, so this is never part of the suite.
 * The key is read from .env.local when the shell does not carry it, and is
 * never printed.
 */
function keyFromEnvFile(): string | null {
  try {
    const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    return env.match(/^HIKER_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? null
  } catch {
    return null
  }
}

describe.runIf(process.env.LIVE === '1')('the follower source (live)', () => {
  it('reads a public profile and its newest page of followers', async () => {
    const key = process.env.HIKER_API_KEY ?? keyFromEnvFile()
    expect(key, 'HIKER_API_KEY').toBeTruthy()
    const { hikerSource } = await import('../app/lib/follower-source')
    const source = hikerSource(key as string)

    const profile = await source.profile('nasa')
    expect(profile.ok).toBe(true)
    if (!profile.ok) return
    console.log(`LIVE profile pk=${profile.value.pk} private=${profile.value.is_private} followers=${profile.value.follower_count}`)
    expect(profile.value.is_private).toBe(false)

    const page = await source.followers(profile.value.pk, null)
    expect(page.ok).toBe(true)
    if (!page.ok) return
    console.log(`LIVE followers page=${page.value.users.length} next=${page.value.next === null ? 'null' : 'cursor'} first=@${page.value.users[0]?.username}`)
    expect(page.value.users.length).toBeGreaterThan(0)
    expect(page.value.users[0]).toMatchObject({ pk: expect.any(String), username: expect.any(String) })
  }, 60_000)
})
