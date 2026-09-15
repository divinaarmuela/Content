import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { managesClients } from '../app/lib/identity-core'
import { cardPeople } from '../app/lib/card-people-core'

/**
 * A SUPER ADMIN CAN BE THE AM (the owner, 15 Sep 2026: "their role is super
 * admin but they can be tagged as AM, because I have added them as AM in
 * the client" — a card read "Account manager: none on this client yet"
 * under a super admin who was the AM). Whoever is assigned on the client's
 * team, account manager or super admin, is its manager everywhere.
 */
describe('managesClients', () => {
  it('an account manager or a super admin on the client is its manager; nobody else is', () => {
    expect(managesClients('account_manager')).toBe(true)
    expect(managesClients('super_admin')).toBe(true)
    for (const r of ['editor', 'scheduler', 'general', 'quality_checker', 'client', null, undefined]) expect(managesClients(r)).toBe(false)
  })
})

describe('everywhere a client’s managers are named (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
  it('the card face on the Editor and Post approval boards', () => {
    for (const p of ['app/dashboard/editor/page.tsx', 'app/dashboard/scheduler/page.tsx']) {
      expect(src(p), p).toContain('if (!managesClients(role.get(a.team_user_id))) continue')
      expect(src(p), p).not.toContain("!== 'account_manager') continue")
    }
  })
  it('the editor’s drawer, the post’s card, comment notices and @-mentions', () => {
    expect(src('app/dashboard/board/EditorCardDrawer.tsx')).toContain('managesClients(u.role) && u.active_status !== false')
    expect(src('app/dashboard/board/PostApprovalDetail.tsx')).toContain('managesClients(u.role) && u.active_status !== false')
    expect(src('app/api/production/items/[id]/comments/route.ts')).toContain('u.active_status && managesClients(u.role)')
    expect(src('app/lib/card-people-core.ts')).toContain('managesClients(u.role) && onClient.has(u.id)')
  })
  it('a super admin on the client is offered as “this client” in @-mentions', () => {
    const team = [
      { id: 'sa', name: 'Abby', email: 'abby@zz.invalid', role: 'super_admin', active_status: true },
      { id: 'ed', name: 'Sam', email: 'sam@zz.invalid', role: 'editor', active_status: true },
    ]
    const links = [{ team_user_id: 'sa', client_id: 'c1' }]
    const people = cardPeople({ id: 'i1', client_id: 'c1', owner_id: 'ed' } as never, team as never, links as never, 'ed')
    const abby = people.find(p => p.id === 'sa')
    expect(abby).toBeTruthy()
    expect(String(abby?.hint ?? '')).toContain('this client')
  })
})
