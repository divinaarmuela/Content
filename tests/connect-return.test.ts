import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectReturnPath } from '../app/lib/social-connect'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

/**
 * CONNECT IT WHERE YOU PRESSED IT.
 *
 * The owner, 9 Sep 2026: "I clicked the Facebook icon on Schedule and it
 * brought me to the Social page instead of connecting it here." The empty
 * slot was a link to Social channels, and the network's return trip was
 * hard-wired there too — a page a scheduler cannot even open, so for them a
 * reconnect from Schedule ended in a refusal after a success.
 */
describe('the network sends the person back to the page they started on', () => {
  it('Schedule, with the client and the network, when the press was on the Schedule bar', () => {
    expect(connectReturnPath('schedule', 'c1', 'facebook'))
      .toBe('/dashboard/social/schedule?client=c1&connected=facebook&clientId=c1')
  })

  it('Social channels by default — the page whose own buttons started it', () => {
    expect(connectReturnPath('social', 'c1', 'instagram'))
      .toBe('/dashboard/social?connected=instagram&clientId=c1')
  })

  it('escapes what it puts in the address', () => {
    expect(connectReturnPath('schedule', 'a b', 'x&y')).toContain('client=a%20b&connected=x%26y')
  })
})

describe('the Schedule bar connects, and comes back', () => {
  it('an empty slot starts the sign-in from the bar, asking to return to Schedule', () => {
    const bar = read('app/dashboard/social/schedule/ProfilesBar.tsx')
    expect(bar).toMatch(/onConnect\?: \(platform: string\) => void/)
    expect(bar).toMatch(/onClick=\{\(\) => \{ setBusy\(true\); onConnect\(platform\) \}\}/)
    const page = read('app/dashboard/social/schedule/page.tsx')
    expect(page).toContain("returnTo: 'schedule'")
    expect(page).toContain('onConnect={connect}')
  })

  it('…and re-reads the client’s accounts on arrival, like Social channels does', () => {
    const page = read('app/dashboard/social/schedule/page.tsx')
    expect(page).toMatch(/params\.get\('connected'\)/)
    expect(page).toMatch(/method: 'PUT'/)
  })

  it('the re-read is open to whoever may start a connection', () => {
    const route = read('app/api/social/connect/route.ts')
    // both handlers sit on the same floor, and both check the client
    expect(route.match(/requireRole\('scheduler'\)/g)?.length).toBe(2)
    expect(route.match(/assertClientAccess\(user, clientId\)/g)?.length).toBe(2)
    expect(route).not.toContain("requireRole('account_manager')")
  })
})
