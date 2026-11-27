import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLIENT_ANSWER_ACTIONS, CLIENT_ANSWER_INBOX, inboxAddress, inboxPerson, withInbox } from '../app/lib/client-answer-inbox-core'
import { planMoveEmails, type Roster, type TeamPerson } from '../app/lib/post-notify-core'

/**
 * ONE INBOX HEARS EVERY CLIENT ANSWER (the owner, 27 Nov 2026: "contact needs notification when approved comments
 * etc" — "yes for every client"). The account behind contact@ is on no client's team, so it heard nothing.
 */
const person = (id: string, role: string, extra: Partial<TeamPerson> = {}): TeamPerson =>
  ({ id, email: `${id}@x.invalid`, name: id, role, active_status: true, ...extra })

const KARLY = person('karly', 'account_manager')
const RAVEN = person('raven', 'scheduler')
const CONTACT = person('contact', 'super_admin', { email: 'Contact@MDMMarketing.com.au' })
const OTHER = person('other', 'super_admin') // a super admin on no client's team: still not told

const roster = (people: TeamPerson[]): Roster => ({ people, clientTeamIds: ['karly', 'raven'], defaultSchedulerIds: [] })

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1', client_id: 'c1', created_by: 'raven', assigned_to: null, stage: 'booked', rev: 9, sent_version: 2,
  client_review: { version: 2, verdict: 'approved', note: null, by: 'Paula', at: '2026-11-27T05:00:00.000Z' },
  booking: { pending: false, job_ids: ['j1'], at: '2026-11-27T04:00:00.000Z', for_time: '2026-11-28T02:00:00.000Z' },
  ...over,
}) as never

const plan = (action: string, p: unknown, people: TeamPerson[], inbox?: string | null) => planMoveEmails({
  action, from: 'booked', to: action === 'client_not_approved' ? 'draft' : 'booked', version: 2,
  effects: [{ when: 'after', kind: 'notify', to: 'account_managers', action: action as never }],
  post: p as never, roster: roster(people), actorId: null, now: '2026-11-27T05:00:00.000Z',
  ...(inbox !== undefined ? { inbox } : {}),
})

describe('the inbox address', () => {
  it('is contact@ unless the environment names another, and `off` is nobody', () => {
    expect(CLIENT_ANSWER_INBOX).toBe('contact@mdmmarketing.com.au')
    expect(inboxAddress(undefined)).toBe('contact@mdmmarketing.com.au')
    expect(inboxAddress('  Ops@Example.com ')).toBe('ops@example.com')
    expect(inboxAddress('off')).toBeNull()
    expect(inboxAddress('nonsense')).toBe('contact@mdmmarketing.com.au')
  })

  it('is a team account with that address — active, never a client login, whatever the capitals', () => {
    expect(inboxPerson([KARLY, CONTACT], CLIENT_ANSWER_INBOX)?.id).toBe('contact')
    expect(inboxPerson([KARLY, { ...CONTACT, active_status: false }], CLIENT_ANSWER_INBOX)).toBeNull()
    expect(inboxPerson([KARLY, { ...CONTACT, role: 'client' }], CLIENT_ANSWER_INBOX)).toBeNull()
    expect(inboxPerson([KARLY], CLIENT_ANSWER_INBOX)).toBeNull()
    expect(inboxPerson([KARLY, CONTACT], null)).toBeNull()
  })

  it('is added once, and never when it is missing', () => {
    expect(withInbox([KARLY], CONTACT).map(p => p.id)).toEqual(['karly', 'contact'])
    expect(withInbox([KARLY, CONTACT], CONTACT).map(p => p.id)).toEqual(['karly', 'contact'])
    expect(withInbox([KARLY], null).map(p => p.id)).toEqual(['karly'])
  })
})

describe('a client’s word on a post', () => {
  it('an approval goes to the client’s managers AND the inbox, on a client it is not on', () => {
    const r = plan('client_ok', post(), [KARLY, RAVEN, CONTACT, OTHER])
    expect(r.ok && r.emails.map(e => e.person.id)).toEqual(['karly', 'contact'])
    expect(r.ok && r.emails.map(e => e.target)).toEqual(['account_managers', 'account_managers'])
  })

  it('so does a no, and an approval that books a waiting post', () => {
    const no = post({ stage: 'draft', booking: null, client_review: { version: 2, verdict: 'not_approved', note: 'Change the cover', by: 'Paula', at: '2026-11-27T05:00:00.000Z' } })
    const r = plan('client_not_approved', no, [KARLY, CONTACT])
    expect(r.ok && r.emails.map(e => e.person.id)).toEqual(['karly', 'contact'])
    expect(CLIENT_ANSWER_ACTIONS).toEqual(['client_ok', 'client_ok_book', 'client_not_approved'])
  })

  it('it is not told twice when it is already on the client, and not at all when switched off or missing', () => {
    const on = planMoveEmails({
      action: 'client_ok', from: 'booked', to: 'booked', version: 2,
      effects: [{ when: 'after', kind: 'notify', to: 'account_managers', action: 'client_ok' as never }],
      post: post(), roster: { people: [KARLY, CONTACT], clientTeamIds: ['karly', 'contact'], defaultSchedulerIds: [] }, actorId: null, now: '2026-11-27T05:00:00.000Z',
    })
    expect(on.ok && on.emails.map(e => e.person.id)).toEqual(['karly', 'contact'])
    const off = plan('client_ok', post(), [KARLY, CONTACT], null)
    expect(off.ok && off.emails.map(e => e.person.id)).toEqual(['karly'])
    const none = plan('client_ok', post(), [KARLY])
    expect(none.ok && none.emails.map(e => e.person.id)).toEqual(['karly'])
  })

  it('a move that is not the client’s word adds nobody', () => {
    const r = planMoveEmails({
      action: 'booking_done', from: 'ready', to: 'booked', version: 2,
      effects: [{ when: 'after', kind: 'notify', to: 'account_managers', action: 'booking_done' as never }],
      post: post(), roster: roster([KARLY, CONTACT]), actorId: null, now: '2026-11-27T05:00:00.000Z',
    })
    expect(r.ok && r.emails.map(e => e.person.id)).toEqual(['karly'])
  })
})

describe('every other place the team hears what a client said', () => {
  it('a comment on a post reaches the client’s managers and the inbox, not only its maker and holder', () => {
    const route = readFileSync('app/api/portal/act/route.ts', 'utf8')
    expect(route).toContain('const managers = await clientManagers(client.id)')
    expect(route).toContain('const also = (await withClientAnswerInbox(managers)).map(m => m.id)')
    expect(route).toContain('const people = [...new Set([post.created_by, post.assigned_to, ...also].filter((x): x is string => !!x))]')
    // the older "tell the managers" too
    expect(route).toContain('for (const m of await withClientAnswerInbox(managers)) {')
  })

  it('a clip or design approved, and a comment on a piece, a shoot or a board', () => {
    const actor = readFileSync('app/lib/portal-actor.ts', 'utf8')
    expect(actor).toContain('const inbox = await clientAnswerInbox()')
    expect(actor).toContain('if (inbox && ![...managers, ...extras].some(p => p.id === inbox.id)) extras.push(inbox)')
  })

  it('a card the client approved or sent back', () => {
    const flow = readFileSync('app/lib/workflow.ts', 'utf8')
    expect(flow).toContain("if (audience === 'account_managers' && !system && actor.role === 'client') {")
    expect(flow).toContain('people = await withClientAnswerInbox(people)')
  })

  it('the live move reads the address from the environment', () => {
    expect(readFileSync('app/lib/post-notify.ts', 'utf8')).toContain('inbox: inboxAddress(process.env.CLIENT_ANSWER_INBOX),')
  })
})
