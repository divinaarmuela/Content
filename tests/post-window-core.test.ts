import { describe, expect, it, vi } from 'vitest'
import {
  answerProblem, applyInstagramChoice, bodyEditable, buildActRequest, defaultPostTime,
  draftPostsOf, footerButtons, frozenCopyOf, hourIsPast, instagramChoices, instagramCounter,
  minuteIsPast, minuteOptions, noteCounts, noteVersionOf, nowChip, parseNoteInput, pressAction,
  questionFor, readPostNotes, STAYS_OPEN, timeHint, unsavedPost, windowHeader, withWorkingCopy, workingCopyOf,
  type PostWindowApi, type WorkingCopy,
} from '@/app/lib/post-window-core'
import {
  compositionProblems, notesForFile, postActions, ROW_OF,
  type AccountRef, type PostHat, type PostState,
} from '@/app/lib/post-stage-core'
import { TIME_TOO_SOON, TIME_TOO_SOON_OR_NOW } from '@/app/lib/social-schedule-core'
import type { PostActRequest, PostActResponse } from '@/app/lib/post-act-contract'
import { splitClock } from '@/app/lib/schedule-compose-core'
import type { Slide } from '@/app/lib/version-files-core'

/**
 * THE POST WINDOW'S PURE HALF (package P3, 29 Sep 2026). The buttons and the
 * stage come from post-stage-core (P0) and are tested there; this pins what
 * the window adds: the top's words, what each button asks, the clock, the
 * Instagram ten, notes per file, and the press itself against a fake server
 * (P1 is mocked — nothing here reaches a route, a channel or a client).
 */

const NOW = Date.parse('2026-09-29T02:00:00.000Z') // 12 pm Melbourne
const MELB = 'Australia/Melbourne'
const inHours = (h: number) => new Date(NOW + h * 3600_000).toISOString()

const slide = (n: number): Slide => ({ url: `https://files.example.test/${n}.jpg`, name: `${n}.jpg`, type: 'image' } as Slide)
const slides = (n: number) => Array.from({ length: n }, (_, i) => slide(i + 1))

const ACCOUNTS: AccountRef[] = [
  { id: 'ig', platform: 'instagram', live: true, name: 'cafe' },
  { id: 'li', platform: 'linkedin', live: true, name: 'Cafe Co' },
]

const working = (over: Partial<WorkingCopy> = {}): WorkingCopy => ({
  slides: slides(2), caption: 'Hello', channels: ['ig'], perChannel: {}, scheduledFor: inHours(24), ...over,
})

function post(over: Partial<PostState> = {}): PostState {
  return { ...unsavedPost({ clientId: 'c1', createdBy: 'maker', working: working() }), id: 'p1', rev: 3, ...over }
}

describe('a post that is not saved yet gets the same footer as a saved draft', () => {
  it('is a draft by the person looking, with no id and rev 0', () => {
    const p = unsavedPost({ clientId: 'c1', createdBy: 'u1', working: working(), sourceItemId: 'item1' })
    expect(p).toMatchObject({ id: '', stage: 'draft', rev: 0, created_by: 'u1', draft_version: 1, sent_version: null, source_item_id: 'item1' })
    expect(bodyEditable(p)).toBe(true)
  })

  it('offers a scheduler who made it "Send for quality check" as the main button, and Delete draft as the bin', () => {
    const p = unsavedPost({ clientId: 'c1', createdBy: 'u1', working: working() })
    const list = postActions(p, ['creator', 'scheduler'], NOW, { accounts: ACCOUNTS })
    expect(list.primary?.action).toBe('send_to_qc')
    expect(list.primary?.label).toBe('Send for quality check')
    expect(list.danger?.action).toBe('delete_draft')
    expect(footerButtons(list).map(b => b.kind)).toEqual(['primary', ...list.secondary.map(() => 'secondary'), 'danger'])
  })

  it('judges what is ON SCREEN while it is a draft, and the frozen copy after', () => {
    const draft = post({ caption: 'old' })
    expect(withWorkingCopy(draft, working({ caption: 'typed' })).caption).toBe('typed')
    const sent = post({ stage: 'quality_check', caption: 'frozen', sent_version: 1 })
    expect(withWorkingCopy(sent, working({ caption: 'typed' })).caption).toBe('frozen')
    expect(bodyEditable(sent)).toBe(false)
  })
})

describe('the top of the window says the stage and who has it (audit B5, W5)', () => {
  it('a post with the client says so to a manager — never "waiting on you"', () => {
    const p = post({
      stage: 'with_client', sent_version: 2, draft_version: 3,
      client_send: { version: 2, at: inHours(-1), to: ['jordan@client.test'], via: 'email', approve_by: inHours(20), for_time: inHours(24) },
    })
    const h = windowHeader(p, NOW, { tz: MELB, frozenAt: inHours(-1) })
    expect(h.label).toBe('With client')
    expect(h.line).toBe('Waiting on the client')
    expect(h.line.toLowerCase()).not.toContain('you')
    expect(h.sendLine).toBe('Emailed to jordan@client.test')
    expect(h.versionLine).toMatch(/^Version 2 · frozen /)
  })

  it('says who asked for a change, with the note', () => {
    const p = post({ changes_asked: { version: 1, by: 'joy', who: 'team', to: 'maker', note: 'Crop slide 2', at: inHours(-2) }, sent_version: 1, draft_version: 2 })
    const h = windowHeader(p, NOW, { nameOf: id => (id === 'joy' ? 'Joy' : id === 'maker' ? 'Sam' : null) })
    expect(h.changeLine).toBe('Joy asked for a change')
    expect(h.changeNote).toBe('Crop slide 2')
    expect(h.versionLine).toMatch(/becomes version 2/)
  })

  it('a manager\'s yes for the client reads as theirs, never "Client approved"', () => {
    const p = post({
      stage: 'ready', sent_version: 1,
      approval: { version: 1, by: 'akmal', hat: 'account_manager', on_behalf_of_client: true, agreed_via: 'whatsapp', note: null, at: inHours(-1) },
    })
    const h = windowHeader(p, NOW, { nameOf: () => 'Akmal' })
    expect(h.approvalLine).toBe('Approved by Akmal for the client — on WhatsApp')
    expect(h.approvalLine).not.toMatch(/^Client approved/)
  })

  it('a missed time turns the chip red and says so', () => {
    const p = post({
      stage: 'with_client', sent_version: 1,
      client_send: { version: 1, at: inHours(-5), to: ['a@b.test'], via: 'email', approve_by: inHours(-1), for_time: inHours(1) },
    })
    const h = windowHeader(p, NOW)
    expect(h.tone).toBe('red')
    expect(h.missed).toBe('Missed — needs a new time')
  })

  it('an unsaved post says nothing is saved', () => {
    const h = windowHeader(unsavedPost({ clientId: 'c', createdBy: 'u', working: working() }), NOW, { unsaved: true })
    expect(h.versionLine).toBe('New post — not saved yet')
    expect(h.line).toMatch(/Nothing is saved yet/)
  })
})

describe('what a button asks before it goes, and the request it becomes', () => {
  const offered = (action: keyof typeof ROW_OF) => ({
    action, label: ROW_OF[action].label, needs: ROW_OF[action].needs ?? [], confirm: ROW_OF[action].confirm ?? null,
  })

  it('a press with nothing to ask goes straight through', () => {
    expect(questionFor(offered('send_to_qc'))).toBeNull()
    expect(questionFor(offered('pass'))).toBeNull()
    expect(questionFor(offered('rebook'))).toBeNull()
  })

  it('Ask for a change needs a note and names who makes it — the maker by default', () => {
    const q = questionFor(offered('ask_change'))!
    expect(q.needs).toEqual(['note', 'assign_to'])
    expect(answerProblem(q, { note: '  ' }, NOW)).toMatch(/Say what needs changing/)
    expect(answerProblem(q, { note: 'Fix the crop' }, NOW)).toBeNull()
    const p = post({ stage: 'quality_check', sent_version: 1 })
    const req = buildActRequest(p, 'ask_change', { note: 'Fix the crop' })
    expect(req).toEqual({ action: 'ask_change', expect_rev: 3, version: 1, note: 'Fix the crop', assign_to: 'maker' })
  })

  it('Approve for the client needs how the client agreed; "another way" needs words', () => {
    const q = questionFor(offered('approve_for_client'))!
    expect(answerProblem(q, {}, NOW)).toMatch(/Say how the client agreed/)
    expect(answerProblem(q, { agreed_via: 'other' }, NOW)).toBe('Say how the client agreed.')
    expect(answerProblem(q, { agreed_via: 'whatsapp' }, NOW)).toBeNull()
    const req = buildActRequest(post({ stage: 'with_client', sent_version: 2 }), 'approve_for_client', { agreed_via: 'call' })
    expect(req).toMatchObject({ action: 'approve_for_client', version: 2, agreed_via: 'call' })
  })

  it('a client send names who gets it, or copies the link instead', () => {
    const q = questionFor(offered('pass_send_client'))!
    expect(answerProblem(q, { send_to: [] }, NOW)).toMatch(/Tick who gets it/)
    expect(answerProblem(q, { via: 'link' }, NOW)).toBeNull()
    const p = post({ stage: 'quality_check', sent_version: 1 })
    expect(buildActRequest(p, 'pass_send_client', { send_to: ['a@b.test', 'a@b.test', ' '] }))
      .toMatchObject({ via: 'email', send_to: ['a@b.test'], version: 1 })
    expect(buildActRequest(p, 'pass_send_client', { via: 'link' })).toMatchObject({ via: 'link' })
  })

  it('Change time refuses a time too soon, and mentions Post now only when it is offered (audit W3)', () => {
    const q = questionFor(offered('change_time'))!
    expect(answerProblem(q, { scheduled_for: inHours(0.1) }, NOW)).toBe(TIME_TOO_SOON)
    expect(answerProblem(q, { scheduled_for: inHours(0.1) }, NOW, { postNowOffered: true })).toBe(TIME_TOO_SOON_OR_NOW)
    expect(answerProblem(q, { scheduled_for: inHours(2) }, NOW)).toBeNull()
    expect(buildActRequest(post({ stage: 'ready' }), 'change_time', { scheduled_for: inHours(2) }))
      .toEqual({ action: 'change_time', expect_rev: 3, scheduled_for: inHours(2) })
  })

  it('Cancel, Delete draft and Post now ask a yes, and send confirm: true', () => {
    for (const a of ['cancel', 'delete_draft', 'post_now', 'edit_booked'] as const) {
      const q = questionFor(offered(a))!
      expect(q.needs).toContain('confirm')
      expect(q.stay).not.toBe(q.go)
      expect(buildActRequest(post(), a, {}).confirm).toBe(true)
    }
  })

  it('the moves that keep someone working leave the window open', () => {
    expect(STAYS_OPEN).toEqual(expect.arrayContaining(['save', 'edit', 'rebook']))
    expect(STAYS_OPEN).not.toContain('send_to_qc')
  })
})

describe('the clock (audit W3, W9)', () => {
  it('offers five-minute steps and keeps the post\'s own odd minute', () => {
    expect(minuteOptions(30)).toHaveLength(12)
    expect(minuteOptions(7)).toEqual([0, 5, 7, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    expect(minuteOptions(null)).toHaveLength(12)
  })

  it('starts a new post on the next quarter-hour at least 15 minutes out — never a time already gone', () => {
    const at = Date.parse(defaultPostTime(Date.parse('2026-09-29T08:07:00.000Z')))
    expect(new Date(at).toISOString()).toBe('2026-09-29T08:30:00.000Z')
    expect(at - Date.parse('2026-09-29T08:07:00.000Z')).toBeGreaterThanOrEqual(15 * 60_000)
    expect(defaultPostTime(Date.parse('2026-09-29T08:00:00.000Z'))).toBe('2026-09-29T08:15:00.000Z')
  })

  it('marks an hour that has gone, in the client\'s zone', () => {
    const today = splitClock(NOW, MELB)!   // 12:00 pm in Melbourne
    expect(hourIsPast({ ...today, meridiem: 'am' }, 11, MELB, NOW)).toBe(true)
    expect(hourIsPast({ ...today, meridiem: 'pm' }, 12, MELB, NOW)).toBe(false)
    expect(hourIsPast({ ...today, meridiem: 'pm' }, 3, MELB, NOW)).toBe(false)
    expect(minuteIsPast({ ...today, hour12: 12, meridiem: 'pm' }, 0, MELB, NOW)).toBe(true)
    expect(minuteIsPast({ ...today, hour12: 12, meridiem: 'pm' }, 30, MELB, NOW)).toBe(false)
  })

  it('the Now chip is Post now: open for an approved post, disabled with the reason anywhere else', () => {
    const draft = postActions(post(), ['creator', 'scheduler'], NOW, { accounts: ACCOUNTS })
    expect(nowChip(draft)).toEqual({ enabled: false, reason: expect.stringMatching(/^Approve first/) })
    const ready = post({ stage: 'ready', sent_version: 1, approval: { version: 1, by: 'joy', hat: 'quality_reviewer', on_behalf_of_client: false, agreed_via: null, note: null, at: inHours(-1) } })
    expect(nowChip(postActions(ready, ['scheduler'], NOW, { accounts: ACCOUNTS }))).toEqual({ enabled: true, reason: null })
    expect(timeHint(inHours(0.1), NOW, false)).toBe(TIME_TOO_SOON)
    expect(timeHint(inHours(3), NOW, false)).toBeNull()
  })
})

describe('Instagram takes ten (decision 10)', () => {
  it('the eleventh is refused by the same rule the server runs', () => {
    const p = post({ slides: slides(11), channels: ['ig'] })
    expect(compositionProblems(p, ACCOUNTS, NOW).join(' ')).toMatch(/Instagram takes 10/)
    expect(instagramCounter(workingCopyOf(p), ACCOUNTS)).toMatchObject({ count: 11, max: 10, over: true, line: 'Instagram 11 of 10' })
  })

  it('offers drop and split; and "its own ten" only when another network keeps them all', () => {
    expect(instagramChoices(working({ slides: slides(11), channels: ['ig'] }), ACCOUNTS)!.choices.map(c => c.key)).toEqual(['drop', 'split'])
    expect(instagramChoices(working({ slides: slides(11), channels: ['ig', 'li'] }), ACCOUNTS)!.choices.map(c => c.key)).toEqual(['drop', 'split', 'own'])
    expect(instagramChoices(working({ slides: slides(10), channels: ['ig'] }), ACCOUNTS)).toBeNull()
  })

  it('drop keeps the first ten; split hands the rest to a second post; own gives Instagram its ten', () => {
    const w = working({ slides: slides(12), channels: ['ig', 'li'] })
    const drop = applyInstagramChoice(w, 'drop', ACCOUNTS)
    expect(drop.working.slides).toHaveLength(10)
    expect(drop.splitOff).toBeNull()
    expect(drop.words).toMatch(/last 2 files were taken out/)

    const split = applyInstagramChoice(w, 'split', ACCOUNTS)
    expect(split.working.slides.map(s => s.name)).toEqual(slides(10).map(s => s.name))
    expect(split.splitOff!.map(s => s.name)).toEqual(['11.jpg', '12.jpg'])

    const own = applyInstagramChoice(w, 'own', ACCOUNTS)
    expect(own.working.slides).toHaveLength(12)
    expect(own.working.perChannel.ig.slides).toHaveLength(10)
    expect(own.working.perChannel.li).toBeUndefined()
    // …and the post then passes: LinkedIn keeps its 12 beside Instagram's own 10
    const after = post({ slides: own.working.slides, channels: ['ig', 'li'], per_channel: own.working.perChannel })
    expect(compositionProblems(after, ACCOUNTS, NOW).join(' ')).not.toMatch(/Instagram takes 10/)
  })
})

describe('notes are per file, in two threads, Team by default (decision 9)', () => {
  const rows = [
    { id: 'n1', post_id: 'p1', file_url: slide(2).url, visibility: 'team', body: 'Crop tighter', author_name: 'Joy', created_at: '2026-09-29T01:00:00Z', version: 1 },
    { id: 'n2', post_id: 'p1', file_url: null, visibility: 'client', body: 'Love it', author_name: 'Jordan', created_at: '2026-09-29T01:05:00Z', version: 1 },
    { id: 'n3', post_id: 'p1', file_url: slide(2).url, visibility: 'odd', body: 'Unknown thread reads as team', created_at: '2026-09-29T00:59:00Z' },
    { id: 'n4', post_id: 'p1', body: '   ', created_at: '2026-09-29T02:00:00Z' },
  ]

  it('reads rows oldest first, drops empty ones, and treats anything but "client" as team', () => {
    const notes = readPostNotes(rows)
    expect(notes.map(n => n.id)).toEqual(['n3', 'n1', 'n2'])
    expect(notes.find(n => n.id === 'n3')!.visibility).toBe('team')
  })

  it('pins a note to the FILE, so moving the pictures cannot move it (audit P10)', () => {
    const notes = readPostNotes(rows)
    expect(notesForFile(notes, slide(2).url, { thread: 'team' }).map(n => n.id)).toEqual(['n3', 'n1'])
    expect(notesForFile(notes, null, { thread: 'client' }).map(n => n.id)).toEqual(['n2'])
    expect(notesForFile(notes, null, { thread: 'team' })).toEqual([])
    expect(noteCounts(notes).get(slide(2).url)).toBe(2)
  })

  it('a new note is Team unless someone chose the client thread', () => {
    expect(parseNoteInput({ body: ' Check the logo ' })).toEqual({
      ok: true, note: { body: 'Check the logo', file_url: null, slide_index: null, version: null, visibility: 'team' },
    })
    expect(parseNoteInput({ body: 'x', visibility: 'client', file_url: slide(1).url, slide_index: 0, version: 2 }))
      .toMatchObject({ ok: true, note: { visibility: 'client', file_url: slide(1).url, slide_index: 0, version: 2 } })
    expect(parseNoteInput({ body: '' })).toEqual({ ok: false, reason: 'Write the note first.' })
    expect(parseNoteInput({ body: 'x', visibility: 'everyone' })).toMatchObject({ ok: false })
    expect(parseNoteInput({ body: 'x', file_url: 'javascript:alert(1)' })).toMatchObject({ ok: false })
  })

  it('belongs to the version on screen', () => {
    expect(noteVersionOf(post({ stage: 'draft', draft_version: 3, sent_version: 2 }))).toBe(3)
    expect(noteVersionOf(post({ stage: 'with_client', draft_version: 3, sent_version: 2 }))).toBe(2)
  })
})

describe('the rest of the window\'s small rules', () => {
  it('an edit from the week toolbar lands only on a DRAFT post of that piece (audit S10)', () => {
    const posts = [
      { id: 'cancelled', item_id: 'i1', stage: 'cancelled' },
      { id: 'posted', item_id: 'i1', stage: 'posted' },
      { id: 'draft-a', item_id: 'i1', stage: 'draft' },
      { id: 'draft-b', source_item_id: 'i1', item_id: 'i1', stage: 'draft' },
      { id: 'other', item_id: 'i2', stage: 'draft' },
    ]
    expect(draftPostsOf(posts, 'i1').map(p => p.id)).toEqual(['draft-a', 'draft-b'])
    expect(draftPostsOf(posts, 'i3')).toEqual([])
  })

  it('reads a frozen version row as a working copy', () => {
    const f = frozenCopyOf({ id: 'p1_v2', post_id: 'p1', n: 2, slides: slides(1), caption: 'Frozen words', channels: ['ig'], per_channel: {}, scheduled_for: inHours(5), frozen_at: inHours(-1), from_migration: true })
    expect(f).toMatchObject({ caption: 'Frozen words', n: 2, frozenAt: inHours(-1), fromMigration: true, channels: ['ig'] })
    expect(frozenCopyOf(null)).toBeNull()
  })
})

/* ── the press, against a fake server (P1 mocked) ───────────────────────── */

function fakeApi(over: Partial<PostWindowApi> = {}) {
  const calls: { kind: string; arg: unknown }[] = []
  const raw = (p: Partial<PostState>) => ({ ...post(), ...p }) as unknown as Record<string, unknown>
  const api: PostWindowApi = {
    create: vi.fn(async body => { calls.push({ kind: 'create', arg: body }); return { ok: true as const, row: raw({ id: 'new1', rev: 0 }) } }),
    save: vi.fn(async (id, body) => { calls.push({ kind: 'save', arg: { id, ...body } }); return { ok: true as const, row: raw({ id, rev: body.expect_rev + 1 }) } }),
    act: vi.fn(async (id: string, req: PostActRequest): Promise<PostActResponse> => {
      calls.push({ kind: 'act', arg: { id, ...req } })
      return { ok: true, post: post({ id, rev: req.expect_rev + 1, stage: 'quality_check', sent_version: 1 }), stage: 'quality_check', words: 'Send for quality check — now in Quality check' }
    }),
    ...over,
  }
  return { api, calls }
}

describe('one press, start to finish (with the server mocked)', () => {
  const base = { itemId: 'item1', working: working(), timezone: MELB, answers: {} }

  it('a new post is created, then sent — carrying the rev the create answered', async () => {
    const { api, calls } = fakeApi()
    const r = await pressAction(api, { ...base, post: null, dirty: true, action: 'send_to_qc' })
    expect(calls.map(c => c.kind)).toEqual(['create', 'act'])
    expect(calls[0].arg).toMatchObject({ item_id: 'item1', caption: 'Hello', channels: ['ig'], timezone: MELB })
    expect(calls[1].arg).toMatchObject({ id: 'new1', action: 'send_to_qc', expect_rev: 0 })
    expect(r).toMatchObject({ ok: true, postId: 'new1', stage: 'quality_check', words: 'Send for quality check — now in Quality check' })
  })

  it('a changed draft is saved before it is sent, so what is sent is what is on screen', async () => {
    const { api, calls } = fakeApi()
    await pressAction(api, { ...base, post: post({ rev: 7 }), dirty: true, action: 'send_to_qc' })
    expect(calls.map(c => c.kind)).toEqual(['save', 'act'])
    expect(calls[0].arg).toMatchObject({ id: 'p1', expect_rev: 7, caption: 'Hello' })
    expect(calls[1].arg).toMatchObject({ expect_rev: 8 })
  })

  it('Save alone saves and says where it is — no act', async () => {
    const { api, calls } = fakeApi()
    const r = await pressAction(api, { ...base, post: post(), dirty: true, action: 'save' })
    expect(calls.map(c => c.kind)).toEqual(['save'])
    expect(r).toMatchObject({ ok: true, words: 'Saved — still in Draft', stage: 'draft' })
  })

  it('a move that is not about the words does not save them first', async () => {
    const { api, calls } = fakeApi()
    await pressAction(api, { ...base, post: post({ stage: 'ready' }), dirty: false, action: 'book' })
    expect(calls.map(c => c.kind)).toEqual(['act'])
  })

  it('a refusal comes back as words for the button, with the fresh post (never assumed)', async () => {
    const fresh = post({ rev: 9, stage: 'with_client' })
    const { api } = fakeApi({
      act: vi.fn(async () => ({ ok: false as const, code: 'stale' as const, reason: 'Someone changed this post while you had it open.', post: fresh })),
    })
    const r = await pressAction(api, { ...base, post: post({ stage: 'ready' }), dirty: false, action: 'book' })
    expect(r).toEqual({ ok: false, reason: 'Someone changed this post while you had it open.', problems: [], post: fresh, postId: 'p1' })
  })

  it('a booking the server could not make is reported as it is — not "Booked in" (audit W4)', async () => {
    const { api } = fakeApi({
      act: vi.fn(async () => ({ ok: false as const, code: 'delivery' as const, reason: 'The channel refused the booking. It is back in Ready to post.', post: post({ stage: 'ready', problem: 'Refused' }) })),
    })
    const r = await pressAction(api, { ...base, post: post({ stage: 'ready' }), dirty: false, action: 'book' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.post?.stage).toBe('ready')
  })

  it('a save refused keeps the reason and every problem', async () => {
    const { api, calls } = fakeApi({
      save: vi.fn(async () => ({ ok: false as const, reason: 'Pick a channel', problems: ['Pick a channel', 'Add a caption'] })),
    })
    const r = await pressAction(api, { ...base, post: post(), dirty: true, action: 'send_to_qc' })
    expect(calls.map(c => c.kind)).toEqual([])
    expect(r).toMatchObject({ ok: false, reason: 'Pick a channel', problems: ['Pick a channel', 'Add a caption'] })
  })

  it('a dropped connection changes nothing and says so', async () => {
    const { api } = fakeApi({ act: vi.fn(async () => { throw new Error('offline') }) })
    const r = await pressAction(api, { ...base, post: post({ stage: 'ready' }), dirty: false, action: 'book' })
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/did not reach the server — nothing has changed/) })
  })

  it('deleting a draft that was never saved asks nobody', async () => {
    const { api, calls } = fakeApi()
    const r = await pressAction(api, { ...base, post: null, dirty: true, action: 'delete_draft' })
    expect(calls).toEqual([])
    expect(r).toMatchObject({ ok: true, stage: 'deleted' })
  })

  it('a create that comes back without a stage is not treated as a post', async () => {
    const { api } = fakeApi({ create: vi.fn(async () => ({ ok: true as const, row: { id: 'x' } })) })
    const r = await pressAction(api, { ...base, post: null, dirty: true, action: 'send_to_qc' })
    expect(r).toMatchObject({ ok: false, postId: 'x', reason: expect.stringMatching(/did not say which stage/) })
  })

  it('passes on the new post a move made, and a client link', async () => {
    const { api } = fakeApi({
      act: vi.fn(async () => ({ ok: true as const, post: post({ stage: 'posted' }), stage: 'posted' as const, words: 'Duplicate — now in Posted', created_post_id: 'dup1', link: 'https://app.test/portal/t/post/p1' })),
    })
    const r = await pressAction(api, { ...base, post: post({ stage: 'posted' }), dirty: false, action: 'duplicate' })
    expect(r).toMatchObject({ ok: true, createdPostId: 'dup1', link: 'https://app.test/portal/t/post/p1' })
  })
})

describe('every stage has a way forward in the window (no dead ends, audit W2)', () => {
  const team: PostHat[][] = [['scheduler'], ['am'], ['sa'], ['creator', 'scheduler']]
  it('a cancelled post offers Re-book as the main button', () => {
    for (const hats of team) {
      const list = postActions(post({ stage: 'cancelled', cancelled: { by: 'x', at: inHours(-1), from_stage: 'booked', reason: null } }), hats, NOW, { accounts: ACCOUNTS })
      expect(list.primary?.action, hats.join()).toBe('rebook')
    }
  })
  it('a manager never gets Approve as the main button while the client has it (audit B7)', () => {
    const p = post({
      stage: 'with_client', sent_version: 1,
      client_send: { version: 1, at: inHours(-1), to: ['a@b.test'], via: 'email', approve_by: inHours(20), for_time: inHours(24) },
    })
    const list = postActions(p, ['am'], NOW, { accounts: ACCOUNTS })
    expect(list.primary?.action).not.toBe('approve_for_client')
    expect(footerButtons(list).map(b => b.offered.action)).toContain('approve_for_client')
  })
})

describe('Schedule it in the window (a super admin, 29 Sep 2026)', () => {
  it('is a footer button for a super admin on a Draft and at the quality check — not for anyone else', () => {
    for (const stage of ['draft', 'quality_check'] as const) {
      const p = post({ stage, sent_version: stage === 'draft' ? null : 1, draft_version: stage === 'draft' ? 1 : 2 })
      expect(footerButtons(postActions(p, ['sa'], NOW, { accounts: ACCOUNTS })).map(b => b.offered.action), stage).toContain('schedule_direct')
      for (const hats of [['scheduler'], ['am'], ['qr'], ['creator', 'scheduler']] as PostHat[][]) {
        expect(footerButtons(postActions(p, hats, NOW, { accounts: ACCOUNTS })).map(b => b.offered.action), `${stage} ${hats}`).not.toContain('schedule_direct')
      }
    }
  })

  it('asks for the time, and a changed draft is saved first so what is booked is what is on screen', async () => {
    const q = questionFor({ action: 'schedule_direct', label: 'Schedule it', needs: ['time'], confirm: null })
    expect(q).toMatchObject({ go: 'Schedule it', needs: ['time'] })
    expect(answerProblem(q!, { scheduled_for: inHours(-1) }, NOW)).toBeTruthy()
    const { api, calls } = fakeApi()
    const when = inHours(30)
    await pressAction(api, { itemId: 'item1', working: working(), timezone: MELB, post: post({ rev: 7 }), dirty: true, action: 'schedule_direct', answers: { scheduled_for: when } })
    expect(calls.map(c => c.kind)).toEqual(['save', 'act'])
    expect(calls[1].arg).toMatchObject({ action: 'schedule_direct', expect_rev: 8, scheduled_for: when })
    // a never-sent draft has no version to name; at the quality check the version seen rides with it
    expect((calls[1].arg as Record<string, unknown>).version).toBeUndefined()
    expect(buildActRequest(post({ stage: 'quality_check', sent_version: 1 }), 'schedule_direct', { scheduled_for: when })).toMatchObject({ version: 1, scheduled_for: when })
  })

  it('the approval line says the check was skipped, never "Passed"', () => {
    const p = post({
      stage: 'booked', sent_version: 1,
      approval: { version: 1, by: 'akmal', hat: 'super_admin', on_behalf_of_client: false, agreed_via: null, note: null, at: inHours(-1), skipped_check: true },
    })
    const h = windowHeader(p, NOW, { nameOf: id => (id === 'akmal' ? 'Akmal' : null) })
    expect(h.approvalLine).toBe('Scheduled without the quality check by Akmal')
  })
})
