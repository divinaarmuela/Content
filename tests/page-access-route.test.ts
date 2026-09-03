import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { encodeKey } from '@/lib/db'
import type { Row } from '@/lib/db-types'

/**
 * Page visibility, at the collision the two lists can have.
 *
 * A GRANT and a HIDE for the same page are one row — `(team_user_id, href)` is
 * the key — so replacing one set must leave the other alone. Getting this
 * wrong reads to the person as "Settings keeps un-hiding Leads for me".
 */

let role = 'super_admin'
const RANK: Record<string, number> = { client: 0, editor: 1, scheduler: 2, account_manager: 3, super_admin: 4 }
class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('../app/lib/authz', () => ({
  requireRole: async (required: string) => {
    if (RANK[role] < RANK[required]) throw new AuthzError('Insufficient permissions', 403)
    return { id: 'admin-1', role, email: 'admin@example.invalid' }
  },
  authzErrorResponse: (e: unknown) => e instanceof AuthzError
    ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))

const { PATCH } = await import('../app/api/team/page-access/route')

const patch = async (body: unknown) => {
  const res = await PATCH(new Request('https://x.test/api/team/page-access', {
    method: 'PATCH', body: JSON.stringify(body),
  }) as never)
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

const HIDDEN_HREF = '/dashboard/leads'
const GRANT_HREF = '/dashboard/bookings'
let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  role = 'super_admin'
  fake = seedDb({
    team_users: [{ id: 'tu-9', email: 'sam@example.invalid', role: 'editor', active_status: true }] as unknown as Row[],
    user_page_access: [{
      id: `tu-9__${encodeKey(HIDDEN_HREF)}`,
      team_user_id: 'tu-9', href: HIDDEN_HREF, hidden: true, granted_by: 'sam@example.invalid',
    }] as unknown as Row[],
  })
})
afterEach(() => fake.restore())

const access = () => fake.rows('user_page_access') as unknown as Record<string, unknown>[]

describe('PATCH /api/team/page-access', () => {
  it('an admin granting a page somebody muted leaves the mute alone', async () => {
    const { status } = await patch({ team_user_id: 'tu-9', hrefs: [HIDDEN_HREF, GRANT_HREF] })
    expect(status).toBe(200)

    const rows = access()
    const muted = rows.find(r => r.href === HIDDEN_HREF)
    expect(muted).toBeTruthy()
    expect(muted!.hidden).toBe(true)
    // the page they did NOT mute is granted as asked
    expect(rows.find(r => r.href === GRANT_HREF)).toMatchObject({ hidden: false })
  })

  it('replacing the grants does not disturb the hide rows', async () => {
    await patch({ team_user_id: 'tu-9', hrefs: [GRANT_HREF] })
    await patch({ team_user_id: 'tu-9', hrefs: [] })
    const rows = access()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ href: HIDDEN_HREF, hidden: true })
  })

  it('a person can replace their own hides without touching their grants', async () => {
    await patch({ team_user_id: 'tu-9', hrefs: [GRANT_HREF] })
    role = 'scheduler'
    // the session is admin-1 here, so this writes admin-1's own hides —
    // tu-9's rows must be untouched either way
    const { status } = await patch({ self_hidden: ['/dashboard/audience'] })
    expect(status).toBe(200)
    const theirs = access().filter(r => r.team_user_id === 'tu-9')
    expect(theirs).toHaveLength(2)
    expect(theirs.find(r => r.href === HIDDEN_HREF)!.hidden).toBe(true)
    expect(theirs.find(r => r.href === GRANT_HREF)!.hidden).toBe(false)
  })
})
