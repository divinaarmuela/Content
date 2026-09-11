import { describe, expect, it } from 'vitest'
import {
  CHECK_LINES, CHECK_LINE_FALLBACK, CHECK_STATUSES, CLIENT_LINE,
  askedLine, countOnYou, othersLabel, postHref, sinceWords, splitWaiting,
  waitingRow, waitingRows, waitingTitle, UNASKED_LINE, UNASKED_QUALITY_LINE,
} from '../app/lib/waiting-core'
import {
  POST_APPROVE_LABEL, POST_CHANGES_LABEL, POST_WAITING_CLIENT, POST_WAITING_LINE,
  POST_WAITING_MANAGER, SEND_BACK_LABEL, cardActions,
  type BoardViewCard, type BoardViewer,
} from '../app/lib/board-view-core'
import { availableTransitionsAs, actingRoles } from '../app/lib/workflow-core'

/**
 * "Waiting on you" — the pile above the Scheduler board, pinned.
 *
 * The rule these tests exist to hold: a row never offers an answer the server
 * would refuse. Every action is compared against `workflow-core`'s own
 * transitions rather than restated, exactly as board-view-core's tests do.
 */

const TODAY = '2026-09-08' // a Tuesday

const card = (over: Partial<BoardViewCard> = {}): BoardViewCard => ({
  id: 'i1', title: 'Spring reel', status: 'draft_uploaded', client_id: 'c1',
  clients: { name: 'Pure Allure' }, work_kinds: { name: 'Video edit', slug: 'edit', color: 'sky' },
  link_url: null, link_kind: null, brief: null, owner_id: 'ed', due_date: null,
  current_version_number: 1, change_note: null, client_approval_required: true,
  updated_at: '2026-09-08T01:00:00.000Z',
  ...over,
})

const editor: BoardViewer = { id: 'ed', role: 'editor' }
const manager: BoardViewer = { id: 'am', role: 'account_manager' }
const scheduler: BoardViewer = { id: 'sc', role: 'scheduler' }
const admin: BoardViewer = { id: 'sa', role: 'super_admin' }

describe('how long it has been waiting, in words', () => {
  it('says today, yesterday, the weekday, then the date', () => {
    expect(sinceWords('2026-09-08T09:00:00.000Z', TODAY)).toBe('since today')
    expect(sinceWords('2026-09-07T09:00:00.000Z', TODAY)).toBe('since yesterday')
    // 2026-09-02 is a Wednesday, six days back — still inside the week
    expect(sinceWords('2026-09-02T09:00:00.000Z', TODAY)).toBe('since Wednesday')
    // past six days a weekday name stops naming one day
    expect(sinceWords('2026-08-30T09:00:00.000Z', TODAY)).toBe('since 30 Aug')
  })

  it('says nothing rather than something odd', () => {
    expect(sinceWords(null, TODAY)).toBeNull()
    expect(sinceWords(undefined, TODAY)).toBeNull()
    expect(sinceWords('not a date', TODAY)).toBeNull()
    expect(sinceWords('2026-09-20T09:00:00.000Z', TODAY)).toBeNull() // the future
  })
})

describe('a post sent for its final sign-off', () => {
  const pending = card({
    status: 'approved_for_scheduling', posting_approval_state: 'pending',
    updated_at: '2026-09-07T02:00:00.000Z',
  })

  it('is on the manager who may answer it — and the answer is given on Schedule, not here', () => {
    const row = waitingRow(pending, manager, TODAY)!
    expect(row.kind).toBe('post')
    expect(row.onYou).toBe(true)
    expect(row.who).toBe('you')
    expect(row.line).toBe(POST_WAITING_LINE)
    expect(row.since).toBe('since yesterday')
    // no inline Approve / Send back (8 Sep 2026): the row is the way to the
    // composer, where the frames are; the labels still exist for the composer
    expect(row.actions).toEqual([])
    expect([POST_APPROVE_LABEL, POST_CHANGES_LABEL].every(Boolean)).toBe(true)
  })

  it('opens the composer on its own preview, not the card', () => {
    const row = waitingRow(pending, manager, TODAY)!
    expect(row.open).toEqual({ kind: 'post', href: postHref('c1', 'i1') })
    expect(postHref('c1', 'i1')).toBe('/dashboard/social/schedule?client=c1&item=i1')
  })

  it('is informational for the scheduler who sent it — and names whose it is', () => {
    const row = waitingRow(pending, scheduler, TODAY)!
    expect(row.onYou).toBe(false)
    expect(row.actions).toEqual([])
    expect(row.line).toBe(POST_WAITING_MANAGER)
    expect(row.who).toBe('manager')
  })

  it('names the CLIENT when the client is the one who was asked', () => {
    const row = waitingRow(card({
      status: 'approved_for_scheduling',
      posting_approval_state: 'pending', posting_client_required: true,
    }), scheduler, TODAY)!
    expect(row.line).toBe(POST_WAITING_CLIENT)
    expect(row.who).toBe('client')
    expect(row.actions).toEqual([])
  })

  it('leaves the list the moment it is answered', () => {
    for (const state of ['approved', 'changes', 'draft', null, undefined]) {
      const answered = card({ status: 'approved_for_scheduling', posting_approval_state: state })
      const row = waitingRow(answered, manager, TODAY)
      expect(row?.kind === 'post').toBeFalsy()
    }
  })
})

describe("a piece waiting on the team's own check", () => {
  /** the manager, asked by name — the row is theirs */
  const askedManager = (status: (typeof CHECK_STATUSES)[number]) =>
    card({ status, asked_ids: ['am'], asked_at: '2026-09-07T00:00:00.000Z' })
  /** who checks at each stage: the quality reviewer in the gate, a manager elsewhere */
  const joy: BoardViewer = { id: 'joy', role: 'editor', quality_reviewer: true }
  const checker = (status: (typeof CHECK_STATUSES)[number]) => (status === 'quality_check' ? joy : manager)

  it('is on the person asked, worded by the stage it is stuck at', () => {
    for (const status of CHECK_STATUSES) {
      const who = checker(status)
      const row = waitingRow(card({ status, asked_ids: [who.id], asked_at: '2026-09-07T00:00:00.000Z' }), who, TODAY)!
      expect(row.kind).toBe('check')
      expect(row.onYou).toBe(true)
      expect(row.line).toBe(CHECK_LINES[status] ?? CHECK_LINE_FALLBACK)
      expect(row.open).toEqual({ kind: 'card', id: 'i1' })
    }
  })

  it('with nobody asked it is the empty seat: shown to whoever could take it, with the answers, never as theirs', () => {
    // the owner, 11 Sep 2026: "the Your turn is confusing when it's not assigned"
    const row = waitingRow(card({ status: 'internal_review' }), manager, TODAY)!
    expect(row.kind).toBe('check')
    expect(row.onYou).toBe(false)
    expect(row.who).toBe('manager')
    expect(row.line).toBe(UNASKED_LINE)
    expect(row.actions.length).toBeGreaterThan(0)
    const gate = waitingRow(card({ status: 'quality_check' }), joy, TODAY)!
    expect(gate.onYou).toBe(false)
    expect(gate.line).toBe(UNASKED_QUALITY_LINE)
    // a manager without the quality hat is not shown the gate's seat at all
    expect(waitingRow(card({ status: 'quality_check' }), manager, TODAY)).toBeNull()
  })

  it('offers only moves the machine already allows', () => {
    for (const status of CHECK_STATUSES) {
      const who = checker(status)
      const c = status === 'quality_check' ? card({ status, asked_ids: ['joy'], asked_at: '2026-09-07T00:00:00.000Z' }) : askedManager(status)
      const row = waitingRow(c, who, TODAY)!
      const legal = availableTransitionsAs(actingRoles(who, c), status).map(t => t.to)
      for (const action of row.actions) {
        // a send-back is the machine's revision_required edge, asked for with
        // words; everything else is a plain transition
        expect(legal).toContain(action.to)
      }
      // …and it is the same set the board's own card would draw
      const board = cardActions(c, who)
      expect(row.actions[0]).toEqual(board.primary)
    }
  })

  it('carries the send-back answer where the rules allow one', () => {
    const row = waitingRow(card({ status: 'internal_review' }), manager, TODAY)!
    expect(row.actions.map(a => a.label)).toContain(SEND_BACK_LABEL)
    expect(row.actions.find(a => a.label === SEND_BACK_LABEL)!.kind).toBe('send_back')
  })

  it('is not on an editor, who cannot check their own work', () => {
    expect(waitingRow(card({ status: 'internal_review' }), editor, TODAY)).toBeNull()
  })

  it('is on exactly the person asked, and nobody else', () => {
    const asked = card({ status: 'internal_review', asked_ids: ['am2'], asked_at: '2026-09-06T00:00:00.000Z' })
    expect(waitingRow(asked, manager, TODAY)).toBeNull()
    expect(waitingRow(asked, { id: 'am2', role: 'account_manager' }, TODAY)!.onYou).toBe(true)
  })
})

describe('a piece sitting with the client', () => {
  const withClient = card({ status: 'client_review', updated_at: '2026-09-06T00:00:00.000Z' })

  it('is shown, says whose it is, and offers nothing', () => {
    const row = waitingRow(withClient, manager, TODAY)!
    expect(row.kind).toBe('client')
    expect(row.line).toBe(CLIENT_LINE)
    expect(row.since).toBe('since Sunday')
    expect(row.onYou).toBe(false)
    expect(row.who).toBe('client')
    expect(row.actions).toEqual([])
  })

  it('offers nothing even to a super admin, who may do anything', () => {
    expect(waitingRow(withClient, admin, TODAY)!.actions).toEqual([])
  })
})

describe('anything this person was asked for', () => {
  it('is theirs whatever the stage says', () => {
    const row = waitingRow(card({
      status: 'approved_for_scheduling', asked_ids: ['sc'], asked_at: '2026-09-07T00:00:00.000Z',
    }), scheduler, TODAY)!
    expect(row.kind).toBe('asked')
    expect(row.onYou).toBe(true)
    expect(row.line).toBe('You were asked to post')
    expect(row.since).toBe('since yesterday')
  })

  it('words the ask in the stage\'s own verb', () => {
    expect(askedLine('internal_review')).toBe('You were asked to check')
    expect(askedLine('draft_uploaded')).toBe('You were asked to make')
    expect(askedLine('scheduled')).toBe('You were asked to post')
    expect(askedLine('published')).toBe('You were asked to take a look')
  })

  it('is nothing to anybody who was not asked', () => {
    const asked = card({ status: 'approved_for_scheduling', asked_ids: ['sc'] })
    expect(waitingRow(asked, { id: 'sc2', role: 'scheduler' }, TODAY)).toBeNull()
  })
})

describe('most of the board is not waiting on anybody', () => {
  it('answers null for a draft, a booked post and a published one', () => {
    for (const status of ['draft_uploaded', 'revision_required', 'scheduled', 'published'] as const) {
      expect(waitingRow(card({ status }), manager, TODAY)).toBeNull()
      expect(waitingRow(card({ status }), scheduler, TODAY)).toBeNull()
    }
  })
})

describe('the list itself', () => {
  const rows = () => waitingRows([
    card({ id: 'a', title: 'A', status: 'client_review', updated_at: '2026-09-01T00:00:00.000Z' }),
    card({ id: 'b', title: 'B', status: 'internal_review', updated_at: '2026-09-07T00:00:00.000Z' }),
    card({ id: 'c', title: 'C', status: 'draft_uploaded' }),
    card({
      id: 'd', title: 'D', status: 'approved_for_scheduling',
      posting_approval_state: 'pending', updated_at: '2026-09-05T00:00:00.000Z',
    }),
  ], manager, TODAY)

  it('keeps only what somebody is held up by', () => {
    expect(rows().map(r => r.id)).not.toContain('c')
  })

  it('puts this person\'s own first, longest wait at the top of each half', () => {
    // b is a check nobody was asked for: shown, but with the others, not as yours
    expect(rows().map(r => r.id)).toEqual(['d', 'a', 'b'])
    expect(countOnYou(rows())).toBe(1)
  })

  it('counts itself in its heading', () => {
    expect(waitingTitle(rows())).toBe('1 waiting on you · 2 with someone else')
  })

  it('says something honest when nothing is on this person', () => {
    const onlyTheirs = waitingRows([card({ status: 'client_review' })], manager, TODAY)
    expect(waitingTitle(onlyTheirs)).toBe('1 waiting on someone else')
    expect(waitingTitle([])).toBe('Nothing is waiting')
  })

  it('splits into what can be answered and what is out with somebody else', () => {
    const { yours, others } = splitWaiting(rows())
    expect(yours.map(r => r.id)).toEqual(['d'])
    expect(others.map(r => r.id)).toEqual(['a', 'b'])
    // a card yours to answer carries its answers; a POST yours to answer
    // carries none here — it is answered on Schedule — but is still yours
    expect(yours.every(r => r.actions.length > 0 || r.kind === 'post')).toBe(true)
    // the empty seat still carries its answers — anyone who could take it can
    expect(others.find(r => r.id === 'b')!.actions.length).toBeGreaterThan(0)
    expect(others.find(r => r.id === 'a')!.actions).toEqual([])
  })

  it('names the folded half by who actually holds it', () => {
    expect(othersLabel([])).toBe('')
    const client = waitingRows([card({ status: 'client_review' })], manager, TODAY)
    expect(othersLabel(client)).toBe('1 more, with the client')
    const mixed = waitingRows([
      card({ id: 'a', status: 'client_review' }),
      card({ id: 'b', status: 'approved_for_scheduling', posting_approval_state: 'pending' }),
    ], scheduler, TODAY)
    expect(othersLabel(mixed)).toBe('2 more, with somebody else')
  })

  it('is empty when nothing is waiting, so the section can hide itself', () => {
    expect(waitingRows([card({ status: 'draft_uploaded' })], manager, TODAY)).toEqual([])
  })
})

describe('the words are for a person, not a database', () => {
  it('never prints a raw status or an id', () => {
    const all = [
      ...Object.values(CHECK_LINES), CHECK_LINE_FALLBACK, CLIENT_LINE,
      askedLine('internal_review'), askedLine('published'),
    ]
    for (const line of all) {
      expect(line).not.toMatch(/_/)
      expect(line[0]).toMatch(/[A-Z]/)
    }
  })
})
