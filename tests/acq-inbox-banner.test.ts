import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('a person whose own work inbox is not read is told so on the acquisition page (21 Sep 2026)', () => {
  it('the page asks about the signed-in person only, and offers the one press that fixes it', () => {
    const route = readFileSync('app/api/leads/acquisition/inbox/route.ts', 'utf8')
    expect(route).toContain("const user = await requireRole('scheduler')")
    expect(route).toContain('connected: read.includes(mine)')
    const page = readFileSync('app/dashboard/leads/acquisition/Acquisition.tsx', 'utf8')
    expect(page).toContain('{inbox && inbox.mine.work_address && !inbox.mine.connected && (')
    expect(page).toContain('href="/api/inbox/connect?from=acquisition"')
  })
  it('Google opens on the right account, and the person comes back to where they pressed', () => {
    expect(readFileSync('app/lib/inbox-connect.ts', 'utf8')).toContain('...(loginHint ? { login_hint: loginHint } : {}),')
    const cb = readFileSync('app/api/inbox/connect/callback/route.ts', 'utf8')
    expect(cb).toContain("const base = fromAcquisition ? '/dashboard/leads/acquisition?' : `${SETTINGS}&`")
    // the domain rule is untouched: only the work domain is ever connected
    expect(readFileSync('app/lib/inbox-connect.ts', 'utf8')).toContain("if (!email.endsWith(`@${allowedMailDomain()}`)) return { ok: false, reason: 'wrong_domain' }")
  })
})
