import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  planPostTransition, readPostState,
  type PostActor, type PostState, type StagePatch,
} from '@/app/lib/post-stage-core'
import {
  bookedFactProblem, clientRoundEmail, clientRoundKey, dueApprovalReminder, factProblem,
  moveWords, nextPersonId, planMoveEmails, recipientsFor,
  reminderWords, roundOutcomeWords, teamPostPath, type Roster, type TeamPerson,
} from '@/app/lib/post-notify-core'

/**
 * EVERY POSTING EMAIL, THE RULES (P7; SPEC §7). The audit's lessons each have
 * a test here: an email only reports a fact the landed post shows (V14: the
 * "Booked in" email for a booking the provider refused), a draft sends nothing
 * (V12), the next named person is always told (decision 14), and the client is
 * never emailed by the app on its own — one batched email per round, only on a
 * person's press (decision 15, the owner's rule of 13 and 28 Sep).
 */

const NOW = '2026-09-29T00:00:00.000Z'
const LATER = '2026-10-02T08:00:00.000Z' // a Thursday 6 pm in Melbourne

const person = (id: string, role: string, extra: Partial<TeamPerson> = {}): TeamPerson =>
  ({ id, email: `${id}@x.invalid`, name: id[0].toUpperCase() + id.slice(1), role, active_status: true, ...extra })

const JOY = person('joy', 'account_manager', { quality_reviewer: true })
const MANAL = person('manal', 'account_manager')
const AKMAL = person('akmal', 'super_admin')
const CATH = person('cath', 'scheduler')
const RAVEN = person('raven', 'scheduler')
const GONE = person('gone', 'account_manager', { active_status: false })
const CLIENT = person('jordan', 'client')
const OTHER_AM = person('otheram', 'account_manager') // not on this client

const roster = (over: Partial<Roster> = {}): Roster => ({
  people: [JOY, MANAL, AKMAL, CATH, RAVEN, GONE, CLIENT, OTHER_AM],
  clientTeamIds: ['joy', 'manal', 'akmal', 'cath', 'raven', 'gone'],
  defaultSchedulerIds: ['raven'],
  ...over,
})

const mk = (over: Record<string, unknown> = {}): PostState => readPostState({
  id: 'p1', client_id: 'c1', created_by: 'cath', stage: 'draft', rev: 3, stage_at: NOW,
  draft_version: 1, sent_version: null, scheduled_for: LATER, timezone: 'Australia/Melbourne',
  channels: ['acc-ig'], slides: [{ url: 'https://r2/a.jpg', name: 'a.jpg', type: 'image' }], caption: 'Spring menu is here\nCome in',
  per_channel: {}, source_item_id: 'item-1',
  ...over,
})!

/** the post as it stands after the plan's write landed */
const landed = (post: PostState, patch: StagePatch): PostState => ({ ...post, ...patch } as PostState)

const actor = (id: string, hats: PostActor['hats']): PostActor => ({ id, hats })
const ACCOUNTS = [{ id: 'acc-ig', platform: 'instagram', live: true }]

function run(post: PostState, action: string, who: PostActor, input: Record<string, unknown> = {}) {
  const plan = planPostTransition(post, action, who, { expect_rev: post.rev, ...input }, { now: NOW, accounts: ACCOUNTS, clientHasContact: true })
  if (!plan.ok) throw new Error(`${action} refused: ${plan.reason}`)
  return { plan, after: landed(post, plan.patch) }
}

describe('who a target names — auto-assign, never the actor, never a client', () => {
  it('quality checkers are the flagged reviewers; with nobody flagged, the super admins', () => {
    expect(recipientsFor('quality_checkers', mk(), roster(), 'cath').map(p => p.id)).toEqual(['joy'])
    const noFlag = roster({ people: [MANAL, AKMAL, CATH] })
    expect(recipientsFor('quality_checkers', mk(), noFlag, 'cath').map(p => p.id)).toEqual(['akmal'])
  })
  it('account managers are the managers ON THIS CLIENT, active, minus the actor', () => {
    expect(recipientsFor('account_managers', mk(), roster(), 'manal').map(p => p.id)).toEqual(['joy', 'akmal'])
  })
  it('schedulers: the assigned person, else the client default, else the maker — never the whole team', () => {
    expect(recipientsFor('schedulers', mk({ assigned_to: 'cath' }), roster(), 'joy').map(p => p.id)).toEqual(['cath'])
    expect(recipientsFor('schedulers', mk(), roster(), 'joy').map(p => p.id)).toEqual(['raven'])
    expect(recipientsFor('schedulers', mk(), roster({ defaultSchedulerIds: [] }), 'joy').map(p => p.id)).toEqual(['cath'])
    expect(recipientsFor('schedulers', mk({ created_by: 'joy' }), roster({ defaultSchedulerIds: [] }), 'joy').map(p => p.id))
      .toEqual(['cath', 'raven'])
  })
  it('the "client" target is the client\'s account managers — the app never emails a client on its own', () => {
    const people = recipientsFor('client', mk(), roster(), 'cath')
    expect(people.map(p => p.id)).toEqual(['joy', 'manal', 'akmal'])
    expect(people.some(p => p.role === 'client')).toBe(false)
  })
  it('a named person who is inactive or a client is not emailed', () => {
    expect(recipientsFor('person', mk(), roster(), 'cath', 'gone')).toEqual([])
    expect(recipientsFor('person', mk(), roster(), 'cath', 'jordan')).toEqual([])
    expect(recipientsFor('person', mk(), roster(), 'cath', 'cath')).toEqual([])
  })
})

describe('an email reports a fact the LANDED post shows (audit V14)', () => {
  it('a Book press never sends "Booked in" — the booking is not there yet', () => {
    const ready = mk({ stage: 'ready', sent_version: 1, draft_version: 2, approval: { version: 1, by: 'joy', hat: 'quality_reviewer', at: NOW } })
    const { plan, after } = run(ready, 'book', actor('cath', ['scheduler']))
    expect(factProblem('book', after)).toMatch(/waits until the booking exists/)
    expect(planMoveEmails({ ...plan, version: plan.event.version, post: after, roster: roster(), actorId: 'cath', now: NOW }))
      .toEqual({ ok: true, emails: [] })
  })
  it('booking_done tells the managers only when the booking holds a job and is not pending', () => {
    const booked = mk({ stage: 'booked', sent_version: 1, draft_version: 2, booking: { job_ids: [], pending: true, at: NOW, for_time: LATER } })
    const { plan, after } = run(booked, 'booking_done', actor(null as unknown as string, ['system']), { job_ids: ['job-1'] })
    const planned = planMoveEmails({ ...plan, version: plan.event.version, post: after, roster: roster(), actorId: 'cath', now: NOW })
    expect(planned.ok && planned.emails.map(e => e.person.id)).toEqual(['joy', 'manal', 'akmal'])
    // the same email against a post whose booking FAILED in the meantime: nobody is told it was booked
    const failed = { ...after, stage: 'ready' as const, booking: null, problem: 'Instagram refused it.' }
    const refused = planMoveEmails({ ...plan, version: plan.event.version, post: failed, roster: roster(), actorId: 'cath', now: NOW })
    expect(refused).toMatchObject({ ok: false, reason: expect.stringMatching(/Ready to post, not Booked in/) })
    expect(factProblem('booking_done', { ...after, booking: { job_ids: ['job-1'], pending: true, at: NOW, for_time: LATER } }))
      .toMatch(/no finished booking/)
  })
  it('booking_failed tells the scheduler it is back in Ready to post, with the reason', () => {
    const booked = mk({ stage: 'booked', sent_version: 1, draft_version: 2, assigned_to: null, booking: { job_ids: [], pending: true, at: NOW, for_time: LATER } })
    const { plan, after } = run(booked, 'booking_failed', actor(null as unknown as string, ['system']), { problem: 'Instagram refused the video.' })
    const planned = planMoveEmails({ ...plan, version: plan.event.version, post: after, roster: roster(), actorId: null, now: NOW })
    expect(planned.ok && planned.emails.map(e => e.person.id)).toEqual(['raven'])
    const words = moveWords('booking_failed', 'schedulers', { title: 'Spring menu', actor: 'MD Media', when: null, post: after })!
    expect(words.subject).toBe('Not booked: Spring menu')
    expect(words.lines.join(' ')).toContain('Instagram refused the video.')
    expect(words.lines.join(' ')).toContain('back in Ready to post')
  })
  it('an email about version 1 is not sent once the post is on version 2', () => {
    const qc = mk({ stage: 'quality_check', sent_version: 2, draft_version: 3 })
    expect(factProblem('send_to_qc', qc, 1)).toMatch(/version 2 now, not 1/)
    expect(factProblem('send_to_qc', qc, 2)).toBeNull()
  })
  it('a client send is reported only when something reached the client for this version', () => {
    const wc = mk({ stage: 'with_client', sent_version: 1, draft_version: 2 })
    expect(factProblem('pass_send_client', wc)).toMatch(/Nothing reached the client/)
    expect(factProblem('pass_send_client', { ...wc, client_send: { version: 1, at: NOW, to: ['a@b.co'], via: 'email', approve_by: null, for_time: LATER } })).toBeNull()
  })
  it('a partial post is reported as partial, never as posted', () => {
    const outcomes = { instagram: { status: 'published', url: 'https://ig/1', at: NOW, error: null }, linkedin: { status: 'failed', url: null, at: NOW, error: 'x' } }
    const posted = mk({ stage: 'posted', outcomes })
    expect(factProblem('record_posted', posted)).toMatch(/Not every network/)
    expect(factProblem('record_partial', posted)).toBeNull()
    const w = moveWords('record_partial', 'schedulers', { title: 'Spring menu', actor: 'MD Media', when: null, post: posted })!
    expect(w.lines[0]).toBe('Spring menu: Posted on 1 of 2 — LinkedIn did not go out.')
  })
})

describe('who hears about each move (decision 14: the next person is always told)', () => {
  it('a Save tells nobody (audit V12: drafts emailed "Publishing now")', () => {
    const { plan, after } = run(mk(), 'save', actor('cath', ['creator', 'scheduler']))
    expect(planMoveEmails({ ...plan, version: plan.event.version, post: after, roster: roster(), actorId: 'cath', now: NOW }))
      .toEqual({ ok: true, emails: [] })
  })
  it('Send for quality check tells the quality checker, and the words say what to do', () => {
    const { plan, after } = run(mk(), 'send_to_qc', actor('cath', ['creator', 'scheduler']))
    const planned = planMoveEmails({ ...plan, version: plan.event.version, post: after, roster: roster(), actorId: 'cath', now: NOW })
    expect(planned.ok && planned.emails.map(e => [e.person.id, e.target])).toEqual([['joy', 'quality_checkers']])
    const w = moveWords('send_to_qc', 'quality_checkers', { title: 'Spring menu', actor: 'Cath', when: null, post: after })!
    expect(w.subject).toBe('Quality check: Spring menu')
    expect(w.lines).toEqual(['Cath sent Spring menu for the quality check (version 1).', 'Open it, then press Passed, or Ask for a change.'])
  })
  it('Ask for a change tells the named person once, as theirs', () => {
    const qc = mk({ stage: 'quality_check', sent_version: 1, draft_version: 2 })
    const { plan, after } = run(qc, 'ask_change', actor('joy', ['am', 'qr']), { version: 1, note: 'Crop slide 2', assign_to: 'raven' })
    const planned = planMoveEmails({ ...plan, version: plan.event.version, post: after, roster: roster(), actorId: 'joy', now: NOW })
    expect(planned.ok && planned.emails.map(e => [e.person.id, e.target])).toEqual([['raven', 'person']])
    const w = moveWords('ask_change', 'person', { title: 'Spring menu', actor: 'Joy', when: null, post: after, note: 'Crop slide 2' })!
    expect(w.lines).toEqual(['Joy asked for a change to Spring menu: “Crop slide 2”', 'It is back in Draft with you. Make the change, then send it for quality check again.'])
  })
  it('the client approving tells the scheduler and the managers; a manager approving for them never says "Client approved"', () => {
    const wc = mk({ stage: 'with_client', sent_version: 1, draft_version: 2, client_send: { version: 1, at: NOW, to: ['jordan@tkbg.com.au'], via: 'email', approve_by: '2026-10-02T06:00:00.000Z', for_time: LATER } })
    const client = run(wc, 'client_approve', actor('portal', ['client']), { version: 1 })
    const planned = planMoveEmails({ ...client.plan, version: client.plan.event.version, post: client.after, roster: roster(), actorId: 'portal', now: NOW })
    expect(planned.ok && planned.emails.map(e => e.person.id)).toEqual(['raven', 'joy', 'manal', 'akmal'])

    const mgr = run(wc, 'approve_for_client', actor('manal', ['am']), { version: 1, agreed_via: 'whatsapp' })
    const words = moveWords('approve_for_client', 'schedulers', {
      title: 'Spring menu', actor: 'Manal', when: 'Thu 2 Oct, 6:00 pm AEST', post: mgr.after, nameOf: id => (id === 'manal' ? 'Manal' : null),
    })!
    expect(words.lines[0]).toBe('Approved by Manal for the client — on WhatsApp.')
    expect(JSON.stringify(words)).not.toMatch(/client approved/i)
  })
  it('a time change on a post the client approved asks the managers to tell the client — it does not email the client', () => {
    const ready = mk({ stage: 'ready', sent_version: 1, draft_version: 2, approval: { version: 1, by: 'portal', hat: 'client', at: NOW } })
    const { plan, after } = run(ready, 'change_time', actor('cath', ['scheduler']), { scheduled_for: '2026-10-03T08:00:00.000Z' })
    const planned = planMoveEmails({ ...plan, version: plan.event.version, post: after, roster: roster(), actorId: 'cath', now: NOW })
    expect(planned.ok && planned.emails.map(e => [e.person.id, e.target])).toEqual([['joy', 'client'], ['manal', 'client'], ['akmal', 'client']])
    const w = moveWords('change_time', 'client', { title: 'Spring menu', actor: 'Cath', when: 'Fri 3 Oct', previousWhen: 'Thu 2 Oct', post: after })!
    expect(w.lines.join(' ')).toContain('Please tell them the new time — the app never emails a client on its own.')
    expect(moveWords('change_time', 'schedulers', { title: 't', actor: 'a', when: null, post: after })).toBeNull()
  })
  it('a stage change that leaves the post with somebody else names them; with the actor, nobody', () => {
    const draft = mk({ stage: 'draft', sent_version: 1, draft_version: 2, changes_asked: { version: 1, by: 'joy', who: 'team', to: 'raven', note: 'x', at: NOW } })
    expect(nextPersonId({ from: 'quality_check', to: 'draft' }, draft, 'joy', NOW)).toBe('raven')
    expect(nextPersonId({ from: 'quality_check', to: 'draft' }, draft, 'raven', NOW)).toBeNull()
    expect(nextPersonId({ from: 'draft', to: 'draft' }, draft, 'joy', NOW)).toBeNull()
    // Take back: the manager holds it now, so nobody else hears
    const wc = mk({ stage: 'with_client', sent_version: 1, draft_version: 2, client_send: { version: 1, at: NOW, to: ['a@b.co'], via: 'email', approve_by: null, for_time: LATER } })
    const back = run(wc, 'take_back', actor('manal', ['am']))
    expect(planMoveEmails({ ...back.plan, version: back.plan.event.version, post: back.after, roster: roster(), actorId: 'manal', now: NOW }))
      .toEqual({ ok: true, emails: [] })
  })
})

describe('approve-by reminders, 24 hours and 1 hour before (decision 11)', () => {
  const BY = '2026-10-02T06:00:00.000Z'
  const sentAt = (at: string) => mk({ stage: 'with_client', sent_version: 1, draft_version: 2, client_send: { version: 1, at, to: ['jordan@tkbg.com.au'], via: 'email', approve_by: BY, for_time: LATER } })
  it('nothing before 24 hours out; the 24-hour one inside the day; the 1-hour one in the last hour', () => {
    const post = sentAt('2026-09-29T00:00:00.000Z')
    expect(dueApprovalReminder(post, '2026-09-30T00:00:00.000Z')).toBeNull()
    expect(dueApprovalReminder(post, '2026-10-01T07:00:00.000Z')).toEqual({ kind: '24h', approve_by: BY, version: 1 })
    expect(dueApprovalReminder(post, '2026-10-02T05:30:00.000Z')).toEqual({ kind: '1h', approve_by: BY, version: 1 })
  })
  it('none once the approve-by time has passed — the post is missed, and nothing moves', () => {
    expect(dueApprovalReminder(sentAt('2026-09-29T00:00:00.000Z'), '2026-10-02T06:00:00.000Z')).toBeNull()
  })
  it('a reminder whose moment came before the send is never due: sent 3 hours out, only the 1-hour one', () => {
    const post = sentAt('2026-10-02T03:00:00.000Z')
    expect(dueApprovalReminder(post, '2026-10-02T04:00:00.000Z')).toBeNull()
    expect(dueApprovalReminder(post, '2026-10-02T05:10:00.000Z')?.kind).toBe('1h')
  })
  it('only With client posts, and only ones that were sent', () => {
    expect(dueApprovalReminder({ ...sentAt(NOW), stage: 'ready' }, '2026-10-02T05:30:00.000Z')).toBeNull()
    expect(dueApprovalReminder({ ...sentAt(NOW), client_send: null }, '2026-10-02T05:30:00.000Z')).toBeNull()
  })
  it('the words go to the team, and tell them what to do', () => {
    const w = reminderWords('1h', { title: 'Spring menu', sentOn: 'Mon 29 Sep', approveBy: 'Thu 2 Oct, 4:00 pm', to: ['jordan@tkbg.com.au'] })
    expect(w.subject).toBe('The client has not answered yet: Spring menu')
    expect(w.lines).toEqual([
      'Spring menu was sent to jordan@tkbg.com.au on Mon 29 Sep. They have not answered.',
      'Their approval closes in 1 hour, at Thu 2 Oct, 4:00 pm.',
      'Nudge them now. If they said yes another way, press Approve for the client. If nobody answers, the post will need a new time.',
    ])
  })
})

describe('the client\'s round: one email per person, listing every post', () => {
  const posts = [
    { id: 'p1', title: 'Spring menu', caption: 'Spring is here', when: 'Thu 2 Oct, 6:00 pm AEST', networks: ['instagram', 'linkedin'], link: 'https://app/portal/t/post/p1', approve_by: 'Thu 2 Oct, 4:00 pm AEST' },
    { id: 'p2', title: 'Chef reel', caption: '', when: 'Fri 3 Oct, 6:00 pm AEST', networks: ['instagram'], link: 'https://app/portal/t/post/p2', approve_by: 'Fri 3 Oct, 4:00 pm AEST' },
  ]
  it('two posts, one email, from the sender, each post listed with its time and networks', () => {
    const m = clientRoundEmail({ clientName: 'TKBG', hello: 'Jordan', senderName: 'Divina Armuela', posts })
    expect(m.subject).toBe('2 posts are ready for you to approve')
    expect(m.lines).toContain('Divina Armuela has sent you 2 posts to look over before they go out.')
    expect(m.items.map(i => i.title)).toEqual(['Spring menu', 'Chef reel'])
    expect(m.items[0].lines[0]).toBe('Goes out Thu 2 Oct, 6:00 pm AEST on Instagram and LinkedIn.')
    expect(m.lines).toContain('Please answer by Thu 2 Oct, 4:00 pm AEST for the first one.')
    expect(m.cta).toBe('See everything waiting on you')
  })
  it('one post reads as one post; a test says it is a test', () => {
    const m = clientRoundEmail({ clientName: 'TKBG', hello: 'Jordan', senderName: 'Divina', posts: [posts[0]], test: true })
    expect(m.subject).toBe('[Test — what TKBG gets] Your post is ready to approve: Spring menu')
    expect(m.lines[0]).toMatch(/A test copy for you/)
  })
  it('the round key is the posts at their versions: same round same key, a new version a new key', () => {
    const a = clientRoundKey([{ id: 'p1', version: 1 }, { id: 'p2', version: 1 }])
    expect(clientRoundKey([{ id: 'p2', version: 1 }, { id: 'p1', version: 1 }])).toBe(a)
    expect(clientRoundKey([{ id: 'p1', version: 2 }, { id: 'p2', version: 1 }])).not.toBe(a)
    expect(a.length).toBeLessThan(24)
  })
  it('the outcome words say nothing changed when nothing was sent', () => {
    expect(roundOutcomeWords([{ email: 'a@b.co', result: 'failed' }])).toMatch(/Nothing has changed on the post/)
    expect(roundOutcomeWords([{ email: 'a@b.co', result: 'sent' }, { email: 'c@d.co', result: 'failed' }]))
      .toBe('Emailed a@b.co. Could not email c@d.co — send them the link yourself.')
  })
})

describe('links, titles and the older booked email', () => {
  it('a team email opens the post on the page its stage belongs to', () => {
    expect(teamPostPath({ id: 'p1', client_id: 'c1', stage: 'quality_check' })).toBe('/dashboard/scheduler?post=p1')
    expect(teamPostPath({ id: 'p1', client_id: 'c1', stage: 'booked' })).toBe('/dashboard/social/schedule?client=c1&post=p1')
  })
  it('the older booked email needs a real booking on the row (audit V14)', () => {
    expect(bookedFactProblem(null)).toBe('No post to check')
    expect(bookedFactProblem({ id: 'p', status: 'scheduled', publish_job_ids: [] })).toMatch(/no publish job/)
    expect(bookedFactProblem({ id: 'p', status: 'scheduled', publish_job_ids: ['j1'] })).toBeNull()
    expect(bookedFactProblem({ id: 'p', client_id: 'c', stage: 'booked', booking: { job_ids: [], pending: true } })).toMatch(/no finished booking/)
    expect(bookedFactProblem({ id: 'p', client_id: 'c', stage: 'booked', booking: { job_ids: ['j1'], pending: false } })).toBeNull()
    expect(bookedFactProblem({ id: 'p', client_id: 'c', stage: 'ready', problem: 'refused', publish_job_ids: ['j1'] })).toMatch(/Ready to post/)
  })
  it('the pure half does no I/O', () => {
    const src = readFileSync('app/lib/post-notify-core.ts', 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/db'|server-only|from '\.\/mailer'|fetch\(/)
  })
})
