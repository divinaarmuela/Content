import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TEAM_ACT_ACTIONS, parsePostActRequest } from '../app/lib/post-act-contract'

/* ── the team's side of the one portal (docs/ONE_PORTAL_SPEC.md §5) ── */

vi.mock('@/lib/db', () => ({ table: () => ({ get: async () => null, list: async () => [], claim: async () => ({ claimed: false }) }) }))
vi.mock('../app/lib/mailer', () => ({ notify: async () => 'sent', renderEmail: () => '', escapeHtml: (s: string) => s }))
const { previewEmail, unansweredBooked } = await import('../app/lib/one-portal-send')

describe('a manager records the client\'s answer, the team sets "if the client hasn\'t approved"', () => {
  it('the team route carries them', () => {
    for (const a of ['client_ok', 'client_not_approved', 'client_ok_book', 'set_if_no_answer']) expect(TEAM_ACT_ACTIONS).toContain(a)
    // …never the old client-only answers, nor the app's own moves
    for (const a of ['client_approve', 'client_ask_change', 'hold_for_client', 'auto_book']) expect(TEAM_ACT_ACTIONS).not.toContain(a)
  })
  it('the request carries the choice, and refuses anything else', () => {
    const ok = parsePostActRequest({ action: 'set_if_no_answer', expect_rev: 1, if_no_answer: 'wait' })
    expect(ok.ok && ok.request.if_no_answer).toBe('wait')
    expect(parsePostActRequest({ action: 'set_if_no_answer', expect_rev: 1, if_no_answer: 'maybe' }).ok).toBe(false)
  })
  it('the entry point lets a manager through on a move the client also makes', () => {
    const src = readFileSync('app/lib/post-stage.ts', 'utf8')
    expect(src).toContain("const teamMay = ROW_OF[request.action].who.some(h => h !== 'client' && h !== 'system')")
  })
})

describe('Send the preview', () => {
  it('is about the booked posts the client has not answered, soonest first', () => {
    const p = (id: string, over: Record<string, unknown>) => ({ id, stage: 'booked', sent_version: 2, scheduled_for: '2026-10-09T00:00:00.000Z', ...over }) as never
    const out = unansweredBooked([
      p('later', { scheduled_for: '2026-10-10T00:00:00.000Z' }),
      p('soon', {}),
      p('answered', { client_review: { version: 2, verdict: 'approved', at: 'x', by: 'J' } }),
      p('changed', { client_review: { version: 1, verdict: 'approved', at: 'x', by: 'J' } }),
      p('draft', { stage: 'draft' }),
    ])
    expect(out.map(x => (x as { id: string }).id)).toEqual(['soon', 'changed', 'later'])
  })
  it('the email: one link, the posts by time, and what Not approved does', () => {
    const m = previewEmail({ clientName: 'Acme', hello: 'Jordan', amName: 'Renée', posts: [{ title: 'Launch', when: 'Thu 8 Oct, 10:00 am' }] })
    expect(m.subject).toBe('Your next post is scheduled — have a look')
    expect(m.lines).toContain('• Launch — Thu 8 Oct, 10:00 am')
    expect(m.lines.join(' ')).toMatch(/not approved comes off the schedule straight away/)
    expect(m.cta).toBe('See my scheduled posts')
    // no-reply (2 Oct 2026): it says so, and who to contact instead
    expect(m.lines.join(' ')).toMatch(/Please don't reply to this email — it is not read\. Answer or comment on your portal, and for anything else contact Renée, your account manager\./)
    const r = previewEmail({ clientName: 'Acme', hello: 'Jordan', posts: [{ title: 'Launch', when: null }], reminder: true })
    expect(r.subject).toMatch(/^Reminder:/)
  })
  it('the route: managers and schedulers, on a client they may work on, on the one portal; a deliberate send', () => {
    const route = readFileSync('app/api/clients/[id]/send-preview/route.ts', 'utf8')
    expect(route).toContain("const MAY_SEND = new Set(['account_manager', 'scheduler', 'general', 'super_admin'])")
    expect(route).toContain('await assertClientAccess(user, id)')
    const lib = readFileSync('app/lib/one-portal-send.ts', 'utf8')
    expect(lib).toContain("if (!onePortal(client)) return { ok: false, status: 409")
    expect(lib).toContain('deliberateClientSend: true')
    expect(lib).toMatch(/actorName: 'MD Media',\s+actorEmail: null,\s+replyTo: `no-reply@\$\{NO_REPLY_DOMAIN\(\)\}`,/)
    // a failed email asks nobody
    expect(lib).toContain('if (delivered.length > 0 && !input.reminder)')
  })
})
