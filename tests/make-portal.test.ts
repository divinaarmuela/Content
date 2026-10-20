import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = (p: string) => readFileSync(p, 'utf8')

describe('a client with no portal gets one in the same press (20 Oct 2026)', () => {
  it("the route is a manager's, keeps a portal that exists, and makes the one-link portal otherwise", () => {
    const r = src('app/api/website/clients/[id]/portal/route.ts')
    expect(r).toContain("guard('account_manager')")
    expect(r).toContain('.claim(id,')
    expect(r).toContain('return held ? cur : { ...cur, share_token: randomUUID(), portal_one: true }')
  })

  it("the board's share button offers it instead of an error", () => {
    const board = src('app/dashboard/team-boards/[id]/page.tsx')
    expect(board).toContain("'Make their portal and share'")
    expect(board).toContain('ensureClientPortal(clientRow.id, clientRow.share_token)')
    expect(board).not.toContain('make one on their client page first')
  })

  it('the Milanote import gives a new client its portal, as adding one in the app does', () => {
    expect(src('scripts/import-milanote.ts')).toContain('share_token: randomUUID(), portal_one: true })')
  })
})
