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

describe('nothing is emailed to a client unless a person presses send (the owner, 2 Oct 2026)', () => {
  const lib = readFileSync('app/lib/one-portal-send.ts', 'utf8')
  const sweep = lib.slice(lib.indexOf('export async function sendOnePortalReminders'))
  it('the 24 h reminder tells the account managers, never the client', () => {
    expect(sweep).not.toContain('toClient')
    expect(sweep).not.toContain('deliberateClientSend')
    expect(sweep).not.toContain('sendSchedulingPreview(')
    expect(sweep).toContain('recipientEmail: m.email')
  })
  it('the only automatic sweeps that run are not client sends', () => {
    const fns = readFileSync('app/inngest/functions.ts', 'utf8')
    expect(fns).toContain('The CLIENT is never emailed by this sweep')
  })
  it('the mailer still drops every client email nobody pressed send for', () => {
    const mailer = readFileSync('app/lib/mailer.ts', 'utf8')
    expect(mailer).toContain("if (clientNotificationsPaused() && input.toClient === true && input.deliberateClientSend !== true)")
    expect(mailer).toMatch(/return true \|\| process\.env\.PAUSE_CLIENT_NOTIFICATIONS/)
  })
})

/** NO APPROVAL NEEDED (the owner, 25 Nov 2026) — the third choice, from the request to the email. */
describe('"No approval needed" on a post', () => {
  it('the team route takes the choice, and still refuses a made-up one', () => {
    const ok = parsePostActRequest({ action: 'set_if_no_answer', expect_rev: 1, if_no_answer: 'none' })
    expect(ok.ok && ok.request.if_no_answer).toBe('none')
    expect(parsePostActRequest({ action: 'set_if_no_answer', expect_rev: 1, if_no_answer: 'never' }).ok).toBe(false)
  })
  it('the preview email does not name a post the client is not asked about', () => {
    const p = (id: string, over: Record<string, unknown>) => ({ id, stage: 'booked', sent_version: 1, scheduled_for: '2026-12-01T00:00:00.000Z', ...over }) as never
    const out = unansweredBooked([p('asked', {}), p('wait', { if_no_answer: 'wait' }), p('quiet', { if_no_answer: 'none' })])
    expect(out.map(x => (x as { id: string }).id).sort()).toEqual(['asked', 'wait'])
  })
  it('the card\'s own menu carries the three choices and the portal link, and the client\'s screen says Scheduled', () => {
    const menu = readFileSync('app/dashboard/scheduler/board/PostPortalMenu.tsx', 'utf8')
    expect(menu).toMatch(/IF_NO_ANSWER_CHOICES\.map\(/)
    expect(menu).toMatch(/action: 'set_if_no_answer'/)
    expect(menu).toMatch(/postPortalPath\(portal\.token, post\)/)
    expect(readFileSync('app/dashboard/scheduler/board/PostCard.tsx', 'utf8')).toMatch(/<PostPortalMenu post=\{post\} portal=\{portal\}/)
    const portal = readFileSync('app/components/portal/OnePortalScheduling.tsx', 'utf8')
    expect(portal).toMatch(/portalStateWords\(tile\)/)
    expect(portal).toMatch(/const asked = profile\.booked\.filter\(t => !t\.no_approval\)/)
    expect(portal).toMatch(/tile\.no_approval \? \(/)
  })
})
