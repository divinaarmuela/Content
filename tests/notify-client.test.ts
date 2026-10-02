import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/* ── Notify the client (the owner, 2 Oct 2026: "for every page a notify client button with the link") ── */

describe('notify the client', () => {
  const lib = readFileSync('app/lib/one-portal-notify.ts', 'utf8')
  it('a deliberate send, from no-reply, only to the client\'s own addresses, only for a page they can open now', () => {
    expect(lib).toContain('deliberateClientSend: true')
    expect(lib).toContain('const picked = pickRecipients(input.emails, page.recipients)')
    expect(lib).toContain("if (!title) return { ok: false, status: 409, error: 'This is not on the client’s portal yet — they could not open it. Put it there first.' }")
    expect(lib).toContain("replyTo: `no-reply@${NO_REPLY_DOMAIN()}`")
  })
  it('the link is that page of the one portal', async () => {
    const { notifyPath } = await import('../app/lib/one-portal-notify')
    expect(notifyPath('t', 'editing', 'i1')).toBe('/portal/t/home?tab=editing&id=i1')
    expect(notifyPath('t', 'forms', 'f1')).toBe('/portal/t/home?tab=forms&form=f1')
  })
  it('the route: account managers, schedulers, generals and super admins, on a client they may work on', () => {
    const route = readFileSync('app/api/clients/[id]/notify/route.ts', 'utf8')
    expect(route).toContain("const MAY_SEND = new Set(['account_manager', 'scheduler', 'general', 'super_admin'])")
    expect((route.match(/await assertClientAccess\(user, id\)/g) ?? []).length).toBe(2)
  })
  it('the button is on the edit / design card, the shoot brief, the shared board and the sent intake form', () => {
    expect(readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')).toContain("<NotifyClientButton clientId={item.client_id} tab={design ? 'designing' : 'editing'} id={item.id}")
    expect(readFileSync('app/dashboard/production/shoots/[id]/ShootSop.tsx', 'utf8')).toContain('<NotifyClientButton clientId={batch.client_id} tab="shoot" id={batch.id}')
    expect(readFileSync('app/dashboard/team-boards/[id]/page.tsx', 'utf8')).toContain('<NotifyClientButton clientId={board.client_id} tab="boards" id={board.id}')
    expect(readFileSync('app/dashboard/clients/[id]/IntakePanel.tsx', 'utf8')).toContain('<NotifyClientButton clientId={clientId} tab="forms" id={form.id}')
  })
})
