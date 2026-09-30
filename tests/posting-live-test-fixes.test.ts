import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import type { TeamUser } from '@/app/lib/authz'
import {
  POST_TRANSITIONS, ROW_OF, REMIND_MISSED, checkPostTransition, clientSendLine, isReminderSend,
  planPostTransition, postActions, readPostState, reminderWords,
  type PostHat, type PostStage, type PostState, type TransitionContext,
} from '@/app/lib/post-stage-core'
import {
  PAGE_ACTIONS, addressWithClient, boardActions, clientDropdownChoices, clientFromAddress, offeredList, postApprovalHref, postCardFace,
} from '@/app/lib/post-board-core'
import { TEAM_ACT_ACTIONS, parsePostActRequest } from '@/app/lib/post-act-contract'
import {
  CLOSE_QUESTION, answerProblem, buildActRequest, closeChoices, hasUnsavedChanges, questionFor, type WorkingCopy,
} from '@/app/lib/post-window-core'
import { clientRoundEmail, factProblem } from '@/app/lib/post-notify-core'
import { RAIL_ALREADY_POSTED, RAIL_BEING_APPROVED, railStanding } from '@/app/lib/schedule-stage-core'

/**
 * THE LIVE CLICK-THROUGH OF 29 SEP 2026 — issues 1 and 4, pinned.
 *
 *   1. Unsaved changes in the post window were lost on close with no warning. The rule is one pure
 *      function (`hasUnsavedChanges`); closing asks "Save your changes?" (Save / Discard / Keep editing)
 *      and a reload gets the browser's own prompt — only while something real is unsaved.
 *   4. "Remind the client": a one-press nudge while a post is With client. The SAME frozen version's link
 *      again, through the client round sender; no new version, the approve-by and posting time stay.
 */

const NOW_MS = Date.parse('2026-10-20T00:00:00.000Z')
const NOW = new Date(NOW_MS).toISOString()
const at = (hours: number) => new Date(NOW_MS + hours * 3_600_000).toISOString()
const CTX: TransitionContext = {
  now: NOW, clientHasContact: true,
  accounts: [{ id: 'acc-ig', platform: 'instagram', live: true }, { id: 'acc-li', platform: 'linkedin', live: true }],
}
const SEND = { version: 1, at: at(-20), to: ['jordan@example.invalid'], via: 'email' as const, approve_by: at(70), for_time: at(72) }

function withClient(over: Partial<PostState> = {}): PostState {
  return {
    id: 'post-1', client_id: 'client-1', created_by: 'u-maker', stage: 'with_client', rev: 5, stage_at: at(-20),
    draft_version: 2, sent_version: 1, scheduled_for: at(72), timezone: 'Australia/Melbourne', channels: ['acc-ig'],
    slides: [{ url: 'https://media.mdmmarketing.com.au/t/1.png', name: '1.png', type: 'image' }] as never,
    caption: 'Hello', per_channel: {}, approval_steps: null, approval: null,
    qc_pass: { version: 1, by: 'u-qr', at: at(-21) }, changes_asked: null, client_send: SEND, last_client_send: null,
    booking: null, outcomes: {}, problem: null, cancelled: null, assigned_to: null, source_item_id: 'item-1', source_deleted: false,
    ...over,
  }
}
const AM = { id: 'u-am', hats: ['am'] as PostHat[] }

/* ── 4. Remind the client, the rule ──────────────────────────────────────── */

describe('Remind the client — the row', () => {
  it('is With client → With client, managers only, needs recipients, NOT versioned, no confirm', () => {
    const row = ROW_OF.remind_client
    expect(row).toMatchObject({ from: ['with_client'], to: 'with_client', label: 'Remind the client', needs: ['recipients'] })
    expect([...row.who].sort()).toEqual(['am', 'sa'])
    expect(row.versioned).toBeUndefined()
    expect(row.confirm).toBeUndefined()
    expect(POST_TRANSITIONS.filter(r => r.action === 'remind_client')).toHaveLength(1)
    expect(isReminderSend('remind_client')).toBe(true)
    expect(isReminderSend('resend_new_time')).toBe(false)
  })

  it('keeps the version, the approve-by and the posting time; freezes nothing; records the reminder', () => {
    const p = withClient()
    const plan = planPostTransition(p, 'remind_client', AM, { expect_rev: 5, delivered_to: ['jordan@example.invalid'] }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('with_client')
    expect(plan.patch.stage).toBeUndefined()
    expect(plan.patch.sent_version).toBeUndefined()
    expect(plan.patch.draft_version).toBeUndefined()
    expect(plan.patch.scheduled_for).toBeUndefined()
    expect(plan.effects.filter(e => e.kind === 'freeze')).toEqual([])
    expect(plan.effects.filter(e => e.kind === 'notify')).toEqual([])
    expect(plan.patch.client_send).toEqual({ ...SEND, reminded_at: NOW, reminded_to: ['jordan@example.invalid'] })
    expect(plan.event).toMatchObject({ action: 'remind_client', from: 'with_client', to: 'with_client', version: 1, note: 'Reminded jordan@example.invalid' })
    expect(plan.words).toMatch(/^Reminder sent to jordan@example\.invalid/)
  })

  it('an approve_by sent with the press is ignored — the first one stands', () => {
    const plan = planPostTransition(withClient(), 'remind_client', AM, { delivered_to: ['a@b.invalid'], approve_by: at(10) }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.client_send?.approve_by).toBe(SEND.approve_by)
  })

  it('moves nothing when nothing reached the client', () => {
    const plan = planPostTransition(withClient(), 'remind_client', AM, { delivered_to: [] }, CTX)
    expect(plan).toMatchObject({ ok: false, code: 'delivery' })
  })

  it('is refused once the slot is missed — New time and resend is the way', () => {
    const missed = withClient({ client_send: { ...SEND, approve_by: at(-1) } })
    expect(checkPostTransition(missed, 'remind_client', AM, { delivered_to: ['x@y.invalid'] }, CTX)).toMatchObject({ ok: false, reason: REMIND_MISSED })
    const list = postActions(missed, ['am'], NOW, CTX)
    expect(list.primary?.action).toBe('resend_new_time')
    expect(list.secondary.find(a => a.action === 'remind_client')?.blocked).toBe(REMIND_MISSED)
  })

  it('is an email: a copied link is refused, and so is a client with nobody to send to', () => {
    expect(checkPostTransition(withClient(), 'remind_client', AM, { via: 'link' }, CTX)).toMatchObject({ ok: false, code: 'invalid' })
    expect(checkPostTransition(withClient(), 'remind_client', AM, {}, { ...CTX, clientHasContact: false })).toMatchObject({ ok: false, code: 'contact' })
  })

  it('never for a scheduler, a creator or the client', () => {
    for (const hat of ['scheduler', 'creator', 'client', 'qr'] as PostHat[]) {
      expect(checkPostTransition(withClient(), 'remind_client', { id: 'x', hats: [hat] }, { delivered_to: ['a@b.invalid'] }, CTX)).toMatchObject({ ok: false, code: 'not_allowed' })
    }
  })

  it('only from With client', () => {
    for (const stage of ['draft', 'quality_check', 'ready', 'booked', 'posted', 'cancelled'] as PostStage[]) {
      expect(checkPostTransition(withClient({ stage }), 'remind_client', AM, { delivered_to: ['a@b.invalid'] }, CTX)).toMatchObject({ ok: false, code: 'wrong_stage' })
    }
  })
})

describe('Remind the client — offered on the board card AND in the window (one list)', () => {
  it('a manager gets it, unblocked, as a secondary button — never the main one', () => {
    for (const hats of [['am'], ['sa']] as PostHat[][]) {
      const list = postActions(withClient(), hats, NOW, CTX)
      expect(list.primary).toBeNull()
      const remind = list.secondary.find(a => a.action === 'remind_client')
      expect(remind).toMatchObject({ label: 'Remind the client', blocked: null, needs: ['recipients'] })
      const board = boardActions(withClient(), hats, NOW, CTX)
      expect(offeredList(board).find(a => a.action === 'remind_client')).toEqual(remind)
    }
    expect(PAGE_ACTIONS.with_client).toContain('remind_client')
  })

  it('the act route accepts it; the client and the app still cannot send theirs', () => {
    expect(TEAM_ACT_ACTIONS).toContain('remind_client')
    expect(parsePostActRequest({ action: 'remind_client', expect_rev: 5, send_to: ['jordan@example.invalid'], via: 'email' }))
      .toMatchObject({ ok: true, request: { action: 'remind_client', send_to: ['jordan@example.invalid'] } })
  })

  it('the window asks only who gets it: no copied link, no answer-by', () => {
    const q = questionFor({ action: 'remind_client', label: 'Remind the client', needs: ['recipients'], confirm: null })!
    expect(q.go).toBe('Send the reminder')
    const req = buildActRequest(withClient(), 'remind_client', { send_to: ['jordan@example.invalid'], via: 'link', approve_by: at(5) })
    expect(req).toEqual({ action: 'remind_client', expect_rev: 5, via: 'email', send_to: ['jordan@example.invalid'] })
    expect(req.version).toBeUndefined()
    expect(answerProblem(q, { send_to: [], via: 'link' }, NOW)).toBe('Tick who gets the reminder.')
    expect(answerProblem(q, { send_to: ['jordan@example.invalid'], via: 'email' }, NOW)).toBeNull()
  })

  it('the card and the window say "Reminded <date>" after the send line', () => {
    const reminded = withClient({ client_send: { ...SEND, reminded_at: '2026-10-21T01:00:00.000Z', reminded_to: ['jordan@example.invalid'] } })
    expect(reminderWords(reminded.client_send)).toBe('Reminded 21 Oct')
    expect(reminderWords(SEND)).toBeNull()
    expect(clientSendLine(reminded.client_send)).toBe('Emailed to jordan@example.invalid · Reminded 21 Oct')
    const face = postCardFace(reminded, { now: NOW, today: '2026-10-20', clientName: 'Jordan' })
    expect(face.sent).toMatch(/^Emailed to jordan@example\.invalid · .+ · Reminded 21 Oct$/)
    expect(postCardFace(withClient(), { now: NOW, today: '2026-10-20' }).sent).not.toMatch(/Reminded/)
  })

  it('a stored reminder reads back from the row', () => {
    const p = readPostState({ ...withClient(), client_send: { ...SEND, reminded_at: at(1), reminded_to: { a: 'x@y.invalid' } } } as never)!
    expect(p.client_send).toMatchObject({ reminded_at: at(1), reminded_to: ['x@y.invalid'] })
  })

  it('the email says it is a reminder; the fact it reports is checked like any client send', () => {
    const one = [{ id: 'p', title: 'Launch', caption: 'Hi', when: 'Fri 23 Oct', networks: ['instagram'], link: 'https://x.invalid', approve_by: 'Thu 22 Oct' }]
    const m = clientRoundEmail({ clientName: 'Acme', hello: 'Jordan', senderName: 'Divina', posts: one as never, reminder: true })
    expect(m.subject).toBe('Reminder: Your post is ready to approve: Launch')
    expect(m.lines.join(' ')).toMatch(/A reminder from Divina: Launch is still waiting for your answer/)
    expect(clientRoundEmail({ clientName: 'Acme', hello: 'Jordan', senderName: 'Divina', posts: one as never }).subject).not.toMatch(/Reminder/)
    expect(factProblem('remind_client', withClient(), 1)).toBeNull()
    expect(factProblem('remind_client', withClient({ stage: 'ready' }), 1)).not.toBeNull()
  })
})

/* ── 4. Remind the client, through the one writer (in-memory database) ──── */

const engine = await import('../app/lib/post-stage')
const person = (id: string, role: string) => ({
  id, role, email: `${id}@x.invalid`, name: id.replace('u-', '').toUpperCase(), clerk_user_id: null,
  employment_type: 'employee', timezone: 'Australia/Melbourne', client_id: null, active_status: true,
}) as unknown as TeamUser
const SCHED = person('u-sch', 'scheduler')
const MANAGER = person('u-am', 'account_manager')
const QR = person('u-qr', 'quality_checker')
const IN = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

describe('Remind the client — the writer sends the same version once and records it', () => {
  let fake: ReturnType<typeof seedDb>
  let undo: () => void
  const deliverToClient = vi.fn(async (input: { emails: string[]; post: { id: string } }) => ({
    delivered: input.emails, failed: [] as string[], link: `https://app.test/portal/tok-1/post/${input.post.id}`,
  }))
  beforeEach(() => {
    fake = seedDb({
      clients: [{ id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne', share_token: 'tok-1', email: 'owner@acme.invalid', client_approval_required: false }] as unknown as Row[],
      client_contacts: [{ id: 'cc1', client_id: 'c1', name: 'Jordan', email: 'jordan@acme.invalid', is_primary: true }] as unknown as Row[],
      social_accounts: [{ id: 'acc-ig', client_id: 'c1', platform: 'instagram', provider_account_id: 'p-ig', name: 'Acme IG', active: true }] as unknown as Row[],
      content_items: [{ id: 'item-1', client_id: 'c1', title: 'Launch', status: 'approved_for_scheduling' }] as unknown as Row[],
      team_users: [SCHED, MANAGER, QR] as unknown as Row[],
      social_posts: [], post_versions: [], post_events: [], publish_jobs: [], claim_locks: [],
    } as never)
    deliverToClient.mockClear()
    undo = engine.usePostEngineDeps({
      deliverToClient, notify: vi.fn(async () => {}), announce: vi.fn(), mayActOnClient: vi.fn(async () => true),
    } as never)
  })
  afterEach(() => { undo(); fake.restore() })

  it('one email, the same version and answer-by, reminder flagged; no new version; an event', async () => {
    const draft = await engine.insertDraftPost({
      client_id: 'c1', item_id: 'item-1', created_by: SCHED.id,
      slides: [{ url: 'https://media.mdmmarketing.com.au/one.jpg', name: 'one.jpg', type: 'image' }] as never,
      caption: 'Hello', channels: ['acc-ig'], per_channel: {}, scheduled_for: IN(48), timezone: 'Australia/Melbourne',
    })
    const as = async (u: TeamUser) => engine.teamActorFor(u, (await engine.loadPostState(draft.id)).post!)
    let p = (await engine.loadPostState(draft.id)).post!
    expect((await engine.performPostTransition(draft.id, 'send_to_qc', await as(SCHED), { expect_rev: p.rev })).ok).toBe(true)
    p = (await engine.loadPostState(draft.id)).post!
    expect((await engine.performPostTransition(draft.id, 'pass_send_client', await as(QR), {
      expect_rev: p.rev, version: p.sent_version, send_to: ['jordan@acme.invalid'],
    })).ok).toBe(true)
    const before = (await engine.loadPostState(draft.id)).post!
    const versionsBefore = fake.rows('post_versions').length
    deliverToClient.mockClear()

    const r = await engine.actOnPost(MANAGER, draft.id, { action: 'remind_client', expect_rev: before.rev, send_to: ['jordan@acme.invalid'], via: 'email' })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    expect(deliverToClient).toHaveBeenCalledTimes(1)
    expect(deliverToClient.mock.calls[0][0]).toMatchObject({
      version: before.sent_version, emails: ['jordan@acme.invalid'], via: 'email', approveBy: before.client_send!.approve_by, reminder: true,
    })
    const after = (await engine.loadPostState(draft.id)).post!
    expect(after.stage).toBe('with_client')
    expect(after.sent_version).toBe(before.sent_version)
    expect(after.draft_version).toBe(before.draft_version)
    expect(after.scheduled_for).toBe(before.scheduled_for)
    expect(after.client_send).toMatchObject({ version: before.sent_version, approve_by: before.client_send!.approve_by, reminded_to: ['jordan@acme.invalid'] })
    expect(after.client_send?.reminded_at).toBeTruthy()
    expect(fake.rows('post_versions').length).toBe(versionsBefore)
    expect(fake.rows('post_events').some(e => (e as Record<string, unknown>).action === 'remind_client')).toBe(true)
  })

  it('an address not on the client is refused before anything is emailed', async () => {
    const draft = await engine.insertDraftPost({
      client_id: 'c1', item_id: 'item-1', created_by: SCHED.id,
      slides: [{ url: 'https://media.mdmmarketing.com.au/one.jpg', name: 'one.jpg', type: 'image' }] as never,
      caption: 'Hello', channels: ['acc-ig'], per_channel: {}, scheduled_for: IN(48), timezone: 'Australia/Melbourne',
    })
    const as = async (u: TeamUser) => engine.teamActorFor(u, (await engine.loadPostState(draft.id)).post!)
    let p = (await engine.loadPostState(draft.id)).post!
    await engine.performPostTransition(draft.id, 'send_to_qc', await as(SCHED), { expect_rev: p.rev })
    p = (await engine.loadPostState(draft.id)).post!
    await engine.performPostTransition(draft.id, 'pass_send_client', await as(QR), { expect_rev: p.rev, version: p.sent_version, send_to: ['jordan@acme.invalid'] })
    p = (await engine.loadPostState(draft.id)).post!
    deliverToClient.mockClear()
    const r = await engine.actOnPost(MANAGER, draft.id, { action: 'remind_client', expect_rev: p.rev, send_to: ['stranger@evil.invalid'], via: 'email' })
    expect(r.ok).toBe(false)
    expect(deliverToClient).not.toHaveBeenCalled()
  })
})

describe('Remind the client — the real mailer path is the round sender, as its own email', () => {
  const src = readFileSync('app/lib/post-stage.ts', 'utf8')
  it('the default deliverer passes again + reminder to sendClientRound (no "duplicate" counted as sent)', () => {
    expect(src).toMatch(/CLIENT_SENDS[^\n]*'remind_client'/)
    expect(src).toMatch(/input\.reminder \? \{ again: true, reminder: true \}/)
    expect(readFileSync('app/lib/post-notify.ts', 'utf8')).toMatch(/reminder: input\.reminder === true/)
  })
})

/* ── 1. Unsaved changes are never lost silently ─────────────────────────── */

const W = (over: Partial<WorkingCopy> = {}): WorkingCopy => ({
  slides: [{ url: 'https://x.invalid/1.png', name: '1.png', type: 'image' }] as never,
  caption: 'Hello', channels: ['acc-ig'], perChannel: {}, scheduledFor: '2026-10-21T00:00:00.000Z', ...over,
})

describe('hasUnsavedChanges — only real changes', () => {
  it('untouched is never unsaved, whatever differs (the app filling in a default is not the person)', () => {
    expect(hasUnsavedChanges(W(), W({ caption: 'Other' }), false)).toBe(false)
  })
  it('a caption, a channel, a time or a file changed is unsaved', () => {
    expect(hasUnsavedChanges(W(), W({ caption: 'Hello!' }), true)).toBe(true)
    expect(hasUnsavedChanges(W(), W({ channels: ['acc-ig', 'acc-li'] }), true)).toBe(true)
    expect(hasUnsavedChanges(W(), W({ scheduledFor: '2026-10-22T00:00:00.000Z' }), true)).toBe(true)
    expect(hasUnsavedChanges(W(), W({ slides: [] }), true)).toBe(true)
    expect(hasUnsavedChanges(W(), W({ perChannel: { 'acc-ig': { firstComment: 'x' } } as never }), true)).toBe(true)
  })
  it('typed and rubbed out, or the same instant written differently, is not a change', () => {
    expect(hasUnsavedChanges(W(), W({ caption: 'Hello' }), true)).toBe(false)
    expect(hasUnsavedChanges(W(), W({ scheduledFor: '2026-10-21T11:00:00+11:00' }), true)).toBe(false)
    expect(hasUnsavedChanges(W({ perChannel: { a: { note: undefined } } as never }), W({ perChannel: { a: {} } as never }), true)).toBe(false)
  })
  it('a post never saved, touched, with nothing to compare to, is unsaved', () => {
    expect(hasUnsavedChanges(null, W(), true)).toBe(true)
  })
})

describe('closing with unsaved changes asks "Save your changes?"', () => {
  const offered = (action: string, blocked: string | null = null) => ({ action, label: action, blocked, needs: [], confirm: null }) as never
  it('Save / Discard / Keep editing when this person may save', () => {
    expect(CLOSE_QUESTION).toBe('Save your changes?')
    expect(closeChoices({ primary: offered('send_to_qc'), secondary: [offered('save')], danger: null }).map(c => c.label))
      .toEqual(['Save', 'Discard', 'Keep editing'])
  })
  it('no Save when saving is not theirs or is blocked', () => {
    expect(closeChoices({ primary: null, secondary: [], danger: null }).map(c => c.key)).toEqual(['discard', 'keep'])
    expect(closeChoices({ primary: null, secondary: [offered('save', 'no')], danger: null }).map(c => c.key)).toEqual(['discard', 'keep'])
  })

  const win = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
  it('the window wires the one rule to X, Escape, the backdrop, the footer line and the browser prompt', () => {
    expect(win).toMatch(/const changed = editable && hasUnsavedChanges\(/)
    expect(win).toMatch(/if \(changedRef\.current\) \{ setClosing\(true\)/)
    expect(win).toMatch(/onMouseDown=\{e => \{ if \(e\.target === e\.currentTarget\) requestClose\(\) \}\}/)
    expect(win).toMatch(/onClick=\{requestClose\}/)
    expect(win).toMatch(/requestCloseRef\.current\(\)/)
    expect(win).toMatch(/\{changed && <span[^>]*>Not saved yet<\/span>\}/)
    expect(win).toMatch(/if \(!changed\) return\s+const warn = \(e: BeforeUnloadEvent\)/)
    expect(win).toMatch(/addEventListener\('beforeunload', warn\)/)
    expect(win).toMatch(/removeEventListener\('beforeunload', warn\)/)
    expect(win).toMatch(/closeChoices\(list\)/)
    expect(win).toMatch(/const ok = await go\('save', \{\}\)\s+if \(ok\) onClose\(\)/)
    // the old "Close and lose them" that did not offer to save is gone
    expect(win).not.toMatch(/Close and lose them/)
  })
})

/* ── 2. The Schedule rail reads the post's stage, not the card's old status ── */

describe('the media rail says where a piece stands from its posts\' stages', () => {
  const s = (...stages: PostStage[]) => stages.map(stage => ({ stage }))
  it('"zz test 1": its post went out — "Already posted", and it leaves "Approved, not yet posted"', () => {
    expect(railStanding(s('posted'))).toEqual({ label: RAIL_ALREADY_POSTED, used: true })
    expect(railStanding(s('posted', 'cancelled'))).toEqual({ label: RAIL_ALREADY_POSTED, used: true })
  })
  it('a post still in Draft, Quality check or With client — "Being approved"', () => {
    for (const st of ['draft', 'quality_check', 'with_client'] as PostStage[]) {
      expect(railStanding(s(st))).toEqual({ label: RAIL_BEING_APPROVED, used: false })
      expect(railStanding(s('posted', st))).toEqual({ label: RAIL_BEING_APPROVED, used: false })
    }
  })
  it('Ready to post / Booked in are approved, not yet out — never "Still being made"', () => {
    expect(railStanding(s('ready'))).toEqual({ label: 'Ready to post', used: false })
    expect(railStanding(s('booked', 'posted'))).toEqual({ label: 'Booked in', used: false })
    for (const st of ['ready', 'booked', 'posted'] as PostStage[]) expect(railStanding(s(st))?.label).not.toBe('Still being made')
  })
  it('no posts (or only cancelled ones): the card\'s own funnel stays the truth', () => {
    expect(railStanding([])).toBeNull()
    expect(railStanding(s('cancelled'))).toBeNull()
  })
  it('the rail\'s list is wired to it', () => {
    const src = readFileSync('app/dashboard/social/schedule/useSchedulePosts.ts', 'utf8')
    expect(src).toMatch(/const standing = railStanding\(ownStates\)/)
    expect(src).toMatch(/reason: elig\.ok \? null : standing\?\.label \?\? elig\.reason/)
    expect(src).toMatch(/\(!elig\.ok && standing\?\.used === true\)/)
  })
})

/* ── 3. ?client= on Post approval ───────────────────────────────────────── */

describe('Post approval reads ?client= and writes the dropdown back to the address', () => {
  it('reads the client an address names; nothing named is every client', () => {
    expect(clientFromAddress('?client=c-42')).toBe('c-42')
    expect(clientFromAddress('?post=p1&client=c-42&lane=draft')).toBe('c-42')
    expect(clientFromAddress('')).toBe('')
    expect(clientFromAddress('?client=')).toBe('')
    expect(clientFromAddress(null)).toBe('')
  })
  it('writes the choice in, keeping ?post= and ?lane=; every client takes it out', () => {
    expect(addressWithClient('', 'c-42')).toBe('?client=c-42')
    expect(addressWithClient('?post=p1&lane=draft', 'c-42')).toBe('?post=p1&lane=draft&client=c-42')
    expect(addressWithClient('?client=c-1&post=p1', 'c-2')).toBe('?client=c-2&post=p1')
    expect(addressWithClient('?client=c-1&post=p1', '')).toBe('?post=p1')
    expect(addressWithClient('?client=c-1', '')).toBe('')
    expect(postApprovalHref('c 1')).toBe('/dashboard/scheduler?client=c+1')
    expect(postApprovalHref('')).toBe('/dashboard/scheduler')
  })
  it('the dropdown keeps the chosen client even when it has nothing on the board', () => {
    const onBoard = [{ id: 'b', name: 'Bravo' }, { id: 'a', name: 'Alpha' }]
    expect(clientDropdownChoices(onBoard, '', () => null).map(c => c.id)).toEqual(['a', 'b'])
    expect(clientDropdownChoices(onBoard, 'z', () => 'Zulu')).toEqual([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'z', name: 'Zulu' }])
    expect(clientDropdownChoices(onBoard, 'a', () => 'X')).toHaveLength(2)
  })
  it('the page starts from the address, writes the dropdown back, and the window closes to it', () => {
    const page = readFileSync('app/dashboard/scheduler/page.tsx', 'utf8')
    expect(page).toMatch(/useState<string>\(\s*\(\) => \(typeof window === 'undefined' \? '' : clientFromAddress\(window\.location\.search\)\)\)/)
    expect(page).toMatch(/addressWithClient\(window\.location\.search, clientId\)/)
    expect(page).toMatch(/window\.history\.replaceState\(/)
    expect(page).toMatch(/onChange=\{e => setClientId\(e\.target\.value\)\}/)
    expect(page).toMatch(/<PostWindowFromAddress clientId=\{clientId\} \/>/)
    const win = readFileSync('app/dashboard/scheduler/PostWindowFromAddress.tsx', 'utf8')
    // closed in place, not through the router, which swallowed it after a page loaded from a link (30 Sep 2026)
    expect(win).toMatch(/rewrite\(postApprovalHref\(clientId\)\)/)
  })
})

describe('our own save is never "someone else changed this post" (live test, 29 Sep 2026)', () => {
  it('holds the conflict line while a press is in flight, and clears it when the save lands', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(src).toContain('if (samePost && state.dirty && savingRef.current) return')
    expect(src).toContain('}).finally(() => { savingRef.current = false })')
    expect(src).toContain('// the server took it against the rev we held, so nobody else moved it under us')
  })
})

describe('moving a booked post books it again (live test, 29 Sep 2026)', () => {
  it('the one-live-job guard reads the jobs fresh, not the request cache that still holds the pulled job', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/lib/publish.ts', 'utf8')
    expect(src).toContain("const held = await table<PublishJobRow>('publish_jobs').get(holder, { fresh: true })")
    expect(src).toMatch(/limit: 1,[\s\S]{0,400}fresh: true,/)
  })
})

describe('a page tour never covers an open post window (live test, 29 Sep 2026)', () => {
  it('waits while ?post= or a dialog is open, except the window\'s own tour', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/dashboard/social/schedule/Tour.tsx', 'utf8')
    expect(src).toContain("tourId !== 'post-window'")
    expect(src).toContain("new URLSearchParams(window.location.search).has('post') || !!document.querySelector('[role=\"dialog\"]')")
    expect(src).toContain('if (windowOpen()) return')
  })
})

describe('opening a post never flashes "That post is not there any more" (29 Sep 2026)', () => {
  it('warns only after the database answered for that post', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/dashboard/scheduler/PostWindowFromAddress.tsx', 'utf8')
    expect(src).toContain('if (postId && live.loading) asked.current = postId')
    expect(src).toContain('asked.current !== postId')
  })
})

describe('the post window shows a scrollbar (the owner, 29 Sep 2026)', () => {
  it('the window is marked and the dashboard CSS brings its scrollbar back', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')).toContain('data-window-scroll className="flex max-h-')
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toContain('.dbx [data-window-scroll]::-webkit-scrollbar { display: block; width: 10px; }')
    expect(css).toContain('.dbx [data-window-scroll] { scrollbar-width: thin;')
  })
})

describe('closing the post window (the owner, 29 Sep 2026: "now I cannot close the modal with X")', () => {
  it('values the window fills in by itself are not the person\'s changes', async () => {
    const { composerReducer, initialComposer } = await import('../app/lib/schedule-compose-core')
    const s0 = initialComposer({ itemId: 'i', postId: 'p', slides: [], scheduledFor: null, channels: ['a'] })
    const seeded = composerReducer(s0, { type: 'extra', channel: 'a', patch: { allowComment: false }, seeded: true })
    expect(seeded.dirty).toBe(false)
    const typed = composerReducer(s0, { type: 'extra', channel: 'a', patch: { allowComment: false } })
    expect(typed.dirty).toBe(true)
  })
  it('the "Save your changes?" question sits under the X, not at the footer', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(src.indexOf('data-close-question')).toBeGreaterThan(src.indexOf('aria-label="Close"'))
    expect(src.indexOf('data-close-question')).toBeLessThan(src.indexOf('{/* ── MIDDLE') === -1 ? src.indexOf('data-stage-chip') + 4000 : src.indexOf('{/* ── MIDDLE'))
    expect(src).toContain("dispatch({ type: 'extra', channel: account.id, patch, seeded: true })")
  })
  it('a post opened on Schedule opens there, whatever its stage', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/dashboard/social/schedule/page.tsx', 'utf8')
    expect(src).toContain('const openPost = useCallback((row: SchedulePostRow) => { flow.openPost(row) }, [flow.openPost])')
    expect(src).not.toContain("STAGE_PAGE[row.stage] === 'post_approval'")
  })
})

describe('no sudden jump to the other page (the owner, 29 Sep 2026)', () => {
  it('Post approval opens every post in place and never bounces an approved post to Schedule', async () => {
    const { readFileSync } = await import('node:fs')
    const addr = readFileSync('app/dashboard/scheduler/PostWindowFromAddress.tsx', 'utf8')
    expect(addr).not.toContain('belongsToSchedule')
    expect(addr).not.toContain('SCHEDULE_PAGE')
    const board = readFileSync('app/dashboard/scheduler/board/PostBoard.tsx', 'utf8')
    expect(board).toContain('windowHref={postApprovalWindowHref(bp.post)}')
    expect(readFileSync('app/dashboard/scheduler/WaitingOnYou.tsx', 'utf8')).toContain('postApprovalWindowHref(row.post)')
    const { postApprovalWindowHref } = await import('../app/lib/post-board-core')
    expect(postApprovalWindowHref({ id: 'p1' })).toBe('/dashboard/scheduler?post=p1')
  })
})

// 29 Sep 2026: Justin's 2m41s, 1080 x 1920, 736 MB video booked for 9 am said "Will not post"
// on Facebook and LinkedIn. Both were the check, not the channel: Facebook's 1280 x 720 was read
// as a WIDTH, and the window budgeted LinkedIn's copy for 30 minutes because it never passed the
// clip's length. The server (which knows the length) was already making the LinkedIn copy.
describe('a vertical phone video is not "Will not post" on Facebook or LinkedIn', () => {
  const probe = { url: 'x.mp4', type: 'video' as const, bytes: 771815881, seconds: 160.98, width: 1080, height: 1920 }
  const platforms = ['tiktok', 'instagram', 'facebook', 'linkedin'] as const

  it('Facebook\'s 1280 x 720 minimum is a size either way round', async () => {
    const { assessAssets } = await import('../app/lib/media-fit-core')
    const fb = assessAssets({ probes: [probe], platforms: ['facebook'] }).filter(f => f.level === 'blocked')
    expect(fb).toEqual([])
    // still refused when it really is too small, vertical or not
    const small = assessAssets({ probes: [{ ...probe, width: 540, height: 960, bytes: 1e6 }], platforms: ['facebook'] })
    expect(small.some(f => f.level === 'blocked' && f.headline === 'Below the minimum resolution')).toBe(true)
  })

  it('knowing the length, the window asks for a LinkedIn copy and calls it a clean copy', async () => {
    const { copiesToPrepare } = await import('../app/lib/encode-ahead-core')
    const { assessAssets } = await import('../app/lib/media-fit-core')
    const copies = copiesToPrepare({ probes: [probe], platforms: [...platforms] }).map(a => a.platform)
    expect(copies).toContain('linkedin')
    const blocked = assessAssets({ probes: [probe], platforms: [...platforms], copies, linkedinPersonal: true }).filter(f => f.level === 'blocked')
    expect(blocked).toEqual([])
    expect(readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')).toMatch(/seconds: video\.seconds/)
  })
})
