import { describe, expect, it } from 'vitest'
import {
  BOOKED_LABEL, NEEDS_CLIENT_REASON, POSTED_LABEL, READY_FOR_CHECK_LABEL, SEND_BACK_LABEL, SHOW_FILTERS, SHOW_LABELS,
  COLUMN_EMPTY, LANE_EMPTY, OLDER_POSTS_NOTE, POSTED_DAYS,
  applyShow, boardHref, cardActions, cardLines, dropAction, dropOnLane, groupByLane, initialsOf, isAssignedTo,
  laneOf, moveTargets, overviewTiles, pageCards, pageLanes, reachableLanes, recentlyPosted, shortDate,
  type BoardPage, type BoardViewCard, type BoardViewer,
} from '../app/lib/board-view-core'
import { BOARD_COLUMNS, columnOf, type BoardColumnKey } from '../app/lib/board-core'
import { ITEM_STATUSES, TRANSITIONS, type ItemStatus } from '../app/lib/workflow-core'

/**
 * What a card shows, what a card offers, what the Overview counts — the pure
 * half of the three pages, pinned. Every offer here must be one the item page
 * would make: the tests compare against `workflow-core` through `board-core`
 * rather than restating the funnel.
 */

const TODAY = '2026-09-06'

const card = (over: Partial<BoardViewCard> = {}): BoardViewCard => ({
  id: 'i1', title: 'Spring reel', status: 'draft_uploaded', client_id: 'c1',
  clients: { name: 'Pure Allure' }, work_kinds: { name: 'Video edit', slug: 'edit', color: 'sky' },
  link_url: null, link_kind: null, brief: null, owner_id: 'ed', due_date: null,
  current_version_number: 1, change_note: null, client_approval_required: true,
  ...over,
})

const editor: BoardViewer = { id: 'ed', role: 'editor' }
const manager: BoardViewer = { id: 'am', role: 'account_manager' }
const scheduler: BoardViewer = { id: 'sc', role: 'scheduler' }
const admin: BoardViewer = { id: 'sa', role: 'super_admin' }

describe('the lines on a card', () => {
  it('are one each: client, title, kind, link with its label, what needs doing, assignee, due, version', () => {
    const l = cardLines(card({
      link_url: 'https://drive.google.com/x', link_kind: 'drive',
      brief: '  Cut to 30s, captions on, end card with the logo  ',
      due_date: '2026-09-12', current_version_number: 3,
    }), { today: TODAY, names: new Map([['ed', 'Jess M']]), viewerId: 'am' })
    expect(l.client).toBe('Pure Allure')
    expect(l.title).toBe('Spring reel')
    expect(l.kind).toBe('Video edit')
    expect(l.link).toEqual({ url: 'https://drive.google.com/x', label: 'Google Drive' })
    expect(l.brief).toBe('Cut to 30s, captions on, end card with the logo')
    expect(l.assignee).toBe('Jess M')
    expect(l.due).toBe('Due 12 Sep')
    expect(l.dueNow).toBe(false)
    expect(l.version).toBe('version 3')
    expect(l.stage).toBe('Draft')
  })

  it('carries what needs doing as plain text, and null when nobody has said', () => {
    expect(cardLines(card({ brief: 'Two versions: square and story' }), { today: TODAY }).brief).toBe('Two versions: square and story')
    expect(cardLines(card({ brief: '   ' }), { today: TODAY }).brief).toBeNull()
    expect(cardLines(card({ brief: undefined }), { today: TODAY }).brief).toBeNull()
    expect(cardLines(card(), { today: TODAY }).brief).toBeNull()
  })

  it('says "You" to the person holding it and "Nobody yet" when nobody is', () => {
    expect(cardLines(card(), { today: TODAY, viewerId: 'ed' }).assignee).toBe('You')
    expect(cardLines(card({ owner_id: null }), { today: TODAY }).assignee).toBe('Nobody yet')
  })

  it('reads the date the way a person would', () => {
    expect(cardLines(card({ due_date: TODAY }), { today: TODAY }).due).toBe('Due today')
    const late = cardLines(card({ due_date: '2026-09-03' }), { today: TODAY })
    expect(late.due).toBe('Overdue · 3 Sep')
    expect(late.dueNow).toBe(true)
    // a posted card is never "overdue"
    expect(cardLines(card({ due_date: '2026-09-03', status: 'published' }), { today: TODAY }).dueNow).toBe(false)
    expect(shortDate('2026-01-05T10:00:00Z')).toBe('5 Jan')
    expect(shortDate('nonsense')).toBeNull()
  })

  it('shows the manager\'s words only on a card that came back', () => {
    const back = card({ status: 'revision_required', change_note: 'Trim the intro' })
    expect(cardLines(back, { today: TODAY }).changeNote).toBe('Trim the intro')
    const moved = card({ status: 'internal_review', change_note: 'Trim the intro' })
    expect(cardLines(moved, { today: TODAY }).changeNote).toBeNull()
  })

  it('labels an unknown link kind as a plain Link', () => {
    expect(cardLines(card({ link_url: 'https://vimeo.com/1', link_kind: 'other' }), { today: TODAY }).link?.label).toBe('Link')
  })

  it('makes initials', () => {
    expect(initialsOf('Jess Murphy')).toBe('JM')
    expect(initialsOf('Jess')).toBe('J')
    expect(initialsOf('')).toBe('—')
  })
})

describe('the control on a card', () => {
  it('an editor hands a draft on for checking, and that is the only button', () => {
    const { primary, more } = cardActions(card(), editor)
    expect(primary).toEqual({ kind: 'transition', to: 'internal_review', label: READY_FOR_CHECK_LABEL })
    expect(READY_FOR_CHECK_LABEL).toBe('Ready for checking')
    expect(more).toEqual([])
  })

  it('an editor gets nothing on a card that is with the manager', () => {
    const { primary, more } = cardActions(card({ status: 'internal_review' }), editor)
    expect(primary).toBeNull()
    expect(more).toEqual([])
  })

  it('a manager checking a card can send it to the client or send it back with what to change', () => {
    const { primary, more } = cardActions(card({ status: 'internal_review' }), manager)
    expect(primary).toEqual({ kind: 'transition', to: 'client_review', label: 'Send to client' })
    expect(more).toContainEqual({ kind: 'send_back', to: 'revision_required', label: SEND_BACK_LABEL })
    // client approval is required on this card, so "Approve without client" is not offered
    expect(more.some(a => a.to === 'approved_for_scheduling')).toBe(false)
  })

  it('offers "Approve without client" only when the card does not need the client', () => {
    const { more } = cardActions(card({ status: 'internal_review', client_approval_required: false }), manager)
    expect(more.some(a => a.kind === 'transition' && a.to === 'approved_for_scheduling')).toBe(true)
  })

  it('with the client, a manager logs the answer or sends it back — never two "send back"s', () => {
    const { primary, more } = cardActions(card({ status: 'client_review' }), manager)
    // it is the client's turn, so nobody on the team gets a filled button
    expect(primary).toBeNull()
    expect(more.filter(a => a.kind === 'send_back')).toHaveLength(1)
    expect(more).toContainEqual({ kind: 'transition', to: 'approved_for_scheduling', label: "Log the client's approval" })
  })

  it('a scheduler moves a ready card to Booked in, then to Posted — plain moves, nothing asked', () => {
    expect(cardActions(card({ status: 'approved_for_scheduling' }), scheduler).primary)
      .toEqual({ kind: 'transition', to: 'scheduled', label: BOOKED_LABEL })
    expect(cardActions(card({ status: 'scheduled' }), scheduler).primary)
      .toEqual({ kind: 'transition', to: 'published', label: POSTED_LABEL })
    expect(BOOKED_LABEL).toBe('Booked in')
    expect(POSTED_LABEL).toBe('Posted')
  })

  it('the card never asks anyone to post: no action on any card, for anyone, is a book or publish dialog', () => {
    // posting happens on the Schedule page; the board only records that it did
    for (const status of ITEM_STATUSES) {
      for (const v of [editor, manager, scheduler, admin]) {
        const { primary, more } = cardActions(card({ status }), v)
        for (const a of [primary, ...more]) {
          if (!a) continue
          expect(['transition', 'send_back']).toContain(a.kind)
        }
        for (const t of moveTargets(card({ status }), v)) {
          expect(['transition', 'send_back']).toContain(t.action.kind)
        }
      }
    }
  })

  it('a scheduler handed nothing on a card someone else holds gets no button', () => {
    const held = card({ status: 'approved_for_scheduling', scheduler_ids: ['other'] })
    expect(cardActions(held, scheduler)).toEqual({ primary: null, more: [] })
  })

  it('a super admin is offered the manager\'s moves, worded as the manager\'s', () => {
    const { primary, more } = cardActions(card({ status: 'internal_review' }), admin)
    expect(primary?.to).toBe('client_review')
    expect(more).toContainEqual({ kind: 'send_back', to: 'revision_required', label: SEND_BACK_LABEL })
  })

  it('never offers a move the state machine does not', () => {
    for (const status of ITEM_STATUSES) {
      for (const v of [editor, manager, scheduler, admin]) {
        const { primary, more } = cardActions(card({ status }), v)
        for (const a of [primary, ...more]) {
          if (!a) continue
          const from = status as ItemStatus
          // a send_back from With client goes through client_changes_requested
          // first; everything else must be a direct edge
          const legal = a.kind === 'send_back' && from === 'client_review'
            ? true
            : Object.keys(TRANSITIONS[from] ?? {}).includes(a.to)
          expect(legal, `${v.role} offered ${a.to} from ${from}`).toBe(true)
        }
      }
    }
  })
})

describe('dragging a card', () => {
  it('lands on the status a button would, worded as the action', () => {
    const d = dropAction(card(), 'internal_check', editor)
    expect(d).toEqual({ ok: true, column: 'internal_check', action: { kind: 'transition', to: 'internal_review', label: READY_FOR_CHECK_LABEL } })
  })

  it('a manager dropping a client card on Internal check is asked what to change', () => {
    const d = dropAction(card({ status: 'client_review' }), 'internal_check', manager)
    expect(d.ok && d.action.kind).toBe('send_back')
  })

  it('a scheduler dropping on Posted just moves the card — "Booked in", no dialog', () => {
    const d = dropAction(card({ status: 'approved_for_scheduling' }), 'posted', scheduler)
    expect(d).toEqual({ ok: true, column: 'posted', action: { kind: 'transition', to: 'scheduled', label: BOOKED_LABEL } })
  })

  it('a refused drop carries the machine\'s own reason', () => {
    const d = dropAction(card(), 'with_client', editor)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/may not|Nothing moves/)
    const same = dropAction(card(), 'draft', editor)
    if (!same.ok) expect(same.reason).toBe('Already in Draft')
  })

  it('the keyboard gets the same targets as the mouse, in words', () => {
    const t = moveTargets(card({ status: 'internal_review' }), manager)
    expect(t.map(x => x.column)).toEqual(['with_client'])
    expect(t[0].label).toBe('Move to With client — Send to client')
    expect(moveTargets(card(), editor)[0].label).toBe('Move to Internal check — Ready for checking')
    // a card that needs the client has no way straight to Ready to post
    expect(t.some(x => x.column === 'ready_to_post')).toBe(false)
    const d = dropAction(card({ status: 'internal_review' }), 'ready_to_post', manager)
    expect(d).toEqual({ ok: false, reason: NEEDS_CLIENT_REASON })
    // …unless the card does not need them
    const free = moveTargets(card({ status: 'internal_review', client_approval_required: false }), manager)
    expect(free.some(x => x.column === 'ready_to_post')).toBe(true)
  })
})

describe('what each page shows', () => {
  const rows: BoardViewCard[] = [
    card({ id: 'a', owner_id: 'ed', status: 'draft_uploaded' }),
    card({ id: 'b', owner_id: 'other', status: 'internal_review' }),
    card({ id: 'c', owner_id: 'ed', status: 'approved_for_scheduling' }),
    card({ id: 'd', owner_id: 'other', status: 'scheduled', scheduler_ids: ['sc'] }),
    // an internal task handed to the scheduler, still being written
    card({ id: 't', owner_id: 'sc', status: 'draft_uploaded', work_kinds: { name: 'Research', slug: 'task' } }),
    // a task handed to the editor
    card({ id: 'u', owner_id: 'ed', status: 'internal_review', work_kinds: { name: 'Copy', slug: 'task' } }),
  ]

  it('Production is everything the person may see, in five lanes', () => {
    expect(pageCards('production', rows, manager).map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 't', 'u'])
    expect(pageLanes('production').map(l => l.key)).toEqual(BOARD_COLUMNS.map(c => c.key))
  })

  it('Editor is only what is assigned to the editor, whatever the kind', () => {
    expect(pageCards('editor', rows, editor).map(c => c.id)).toEqual(['a', 'c', 'u'])
    // three full lanes, then Done folded
    expect(pageLanes('editor').map(l => l.key)).toEqual(['draft', 'internal_check', 'with_client', 'done'])
  })

  it('a manager on the Editor page sees the making, not the posting', () => {
    // every card still being made, whatever its kind and whoever holds it
    expect(pageCards('editor', rows, manager).map(c => c.id)).toEqual(['a', 'b', 't', 'u'])
  })

  it('Scheduler is the same cards as Production — the whole flow, so they see what is coming', () => {
    // every card for the clients they hold — not only the queue; the lanes
    // say what is ready
    expect(pageCards('scheduler', rows, scheduler).map(c => c.id)).toEqual(pageCards('production', rows, manager).map(c => c.id))
    expect(pageCards('scheduler', rows, scheduler).map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 't', 'u'])
    // …Coming up folded, then two full lanes
    expect(pageLanes('scheduler').map(l => l.key)).toEqual(['coming_up', 'ready_to_post', 'posted'])
  })

  it('a tagged question counts as assignment', () => {
    expect(isAssignedTo(card({ owner_id: 'x', my_open_task: true }), 'ed')).toBe(true)
    expect(isAssignedTo(card({ owner_id: 'x', scheduler_ids: ['ed'] }), 'ed')).toBe(true)
    expect(isAssignedTo(card({ owner_id: 'x' }), 'ed')).toBe(false)
  })
})

describe('the lanes each page arranges the five columns into', () => {
  const PAGES: BoardPage[] = ['production', 'editor', 'scheduler']

  it('Production is five lanes, one column each, none folded', () => {
    const lanes = pageLanes('production')
    expect(lanes.map(l => l.columns)).toEqual(BOARD_COLUMNS.map(c => [c.key]))
    expect(lanes.every(l => !l.folded)).toBe(true)
    expect(lanes.map(l => l.label)).toEqual(BOARD_COLUMNS.map(c => c.label))
  })

  it('Editor gives room to Draft, Internal check and With client, and folds the rest into Done', () => {
    const lanes = pageLanes('editor')
    expect(lanes.map(l => ({ key: l.key, columns: l.columns, folded: l.folded }))).toEqual([
      { key: 'draft', columns: ['draft'], folded: false },
      { key: 'internal_check', columns: ['internal_check'], folded: false },
      { key: 'with_client', columns: ['with_client'], folded: false },
      { key: 'done', columns: ['ready_to_post', 'posted'], folded: true },
    ])
    expect(lanes[3].label).toBe('Done')
    expect(lanes[3].empty).toBe('Nothing done yet.')
  })

  it('Scheduler folds Draft, Internal check and With client into Coming up, then Ready to post and Posted', () => {
    const lanes = pageLanes('scheduler')
    expect(lanes.map(l => ({ key: l.key, columns: l.columns, folded: l.folded }))).toEqual([
      { key: 'coming_up', columns: ['draft', 'internal_check', 'with_client'], folded: true },
      { key: 'ready_to_post', columns: ['ready_to_post'], folded: false },
      { key: 'posted', columns: ['posted'], folded: false },
    ])
    expect(lanes[0].label).toBe('Coming up')
    expect(lanes[0].empty).toBe('Nothing coming up.')
  })

  it('on every page the five columns are all there, once each, in board order', () => {
    for (const page of PAGES) {
      const flat = pageLanes(page).flatMap(l => l.columns)
      expect(flat, page).toEqual(BOARD_COLUMNS.map(c => c.key))
      for (const l of pageLanes(page)) {
        expect(l.label).not.toMatch(/_/)
        expect(l.empty).toMatch(/^Nothing /)
        expect(l.folded).toBe(l.columns.length > 1)
      }
    }
  })

  it('a column deep link lands on the lane it sits in', () => {
    expect(laneOf('production', 'posted')).toBe('posted')
    expect(laneOf('editor', 'posted')).toBe('done')
    expect(laneOf('editor', 'ready_to_post')).toBe('done')
    expect(laneOf('editor', 'draft')).toBe('draft')
    expect(laneOf('scheduler', 'draft')).toBe('coming_up')
    expect(laneOf('scheduler', 'with_client')).toBe('coming_up')
    expect(laneOf('scheduler', 'ready_to_post')).toBe('ready_to_post')
  })

  it('every lane has an empty sentence, and the columns keep theirs', () => {
    for (const k of Object.keys(LANE_EMPTY)) expect(LANE_EMPTY[k as keyof typeof LANE_EMPTY]).toMatch(/^Nothing .*\.$/)
    for (const c of BOARD_COLUMNS) expect(COLUMN_EMPTY[c.key]).toBe(LANE_EMPTY[c.key])
    expect(OLDER_POSTS_NOTE).toBe("Older posts are on the client's page.")
  })

  describe('grouping by lane', () => {
    const rows = [
      card({ id: 'a', status: 'draft_uploaded' }),
      card({ id: 'b', status: 'published' }),
      card({ id: 'c', status: 'revision_required' }),
      card({ id: 'd', status: 'approved_for_scheduling' }),
      card({ id: 'e', status: 'scheduled' }),
      card({ id: 'f', status: 'client_review' }),
    ]

    it('a folded lane holds every card from every column inside it, in input order', () => {
      const g = groupByLane(pageLanes('editor'), rows)
      expect(g.map(x => x.lane.key)).toEqual(['draft', 'internal_check', 'with_client', 'done'])
      expect(g[0].cards.map(c => c.id)).toEqual(['a'])
      expect(g[1].cards.map(c => c.id)).toEqual(['c'])
      expect(g[2].cards.map(c => c.id)).toEqual(['f'])
      expect(g[3].cards.map(c => c.id)).toEqual(['b', 'd', 'e'])

      const s = groupByLane(pageLanes('scheduler'), rows)
      expect(s.map(x => x.lane.key)).toEqual(['coming_up', 'ready_to_post', 'posted'])
      expect(s[0].cards.map(c => c.id)).toEqual(['a', 'c', 'f'])
      expect(s[1].cards.map(c => c.id)).toEqual(['d'])
      expect(s[2].cards.map(c => c.id)).toEqual(['b', 'e'])
    })

    it('lists every lane, empty ones included, and never loses a card', () => {
      expect(groupByLane(pageLanes('scheduler'), []).map(x => x.cards)).toEqual([[], [], []])
      for (const page of PAGES) {
        const total = groupByLane(pageLanes(page), rows).reduce((n, x) => n + x.cards.length, 0)
        expect(total, page).toBe(rows.length)
      }
    })
  })

  describe('dropping on a lane', () => {
    const lane = (page: BoardPage, key: string) => pageLanes(page).find(l => l.key === key)!

    it('a one-column lane is that column\'s drop', () => {
      const d = dropOnLane(card(), lane('editor', 'internal_check'), editor)
      expect(d).toEqual({ ok: true, lane: 'internal_check', column: 'internal_check', action: { kind: 'transition', to: 'internal_review', label: READY_FOR_CHECK_LABEL } })
    })

    it('a folded lane is entered at the FIRST stage inside it the rules allow', () => {
      // a scheduler dropping a ready card on Posted (the only stage they reach)
      const d = dropOnLane(card({ status: 'approved_for_scheduling' }), lane('editor', 'done'), scheduler)
      expect(d).toEqual({ ok: true, lane: 'done', column: 'posted', action: { kind: 'transition', to: 'scheduled', label: BOOKED_LABEL } })
      // a manager dropping a checked card that needs no client on Done lands
      // on Ready to post — the first column in the lane — not Posted
      const free = dropOnLane(card({ status: 'internal_review', client_approval_required: false }), lane('editor', 'done'), manager)
      expect(free.ok && free.column).toBe('ready_to_post')
      expect(free.ok && free.action.to).toBe('approved_for_scheduling')
      // a manager dropping a client card on Coming up is sending it back —
      // Internal check is the first stage in the lane they may reach
      const back = dropOnLane(card({ status: 'client_review' }), lane('scheduler', 'coming_up'), manager)
      expect(back.ok && back.column).toBe('internal_check')
      expect(back.ok && back.action.kind).toBe('send_back')
    })

    it('a folded lane with no way in refuses in plain words', () => {
      // an editor cannot move a draft past the manager
      const d = dropOnLane(card(), lane('editor', 'done'), editor)
      expect(d.ok).toBe(false)
      if (!d.ok) expect(d.reason).toMatch(/may not|Nothing moves/)
      // a card that needs the client says so
      const needs = dropOnLane(card({ status: 'internal_review' }), lane('editor', 'done'), manager)
      expect(needs).toEqual({ ok: false, reason: NEEDS_CLIENT_REASON })
      // a card already in the lane, with nowhere else inside it, says so
      const same = dropOnLane(card({ status: 'published' }), lane('editor', 'done'), scheduler)
      expect(same).toEqual({ ok: false, reason: 'Already in Done' })
      expect(dropOnLane(card(), lane('editor', 'draft'), editor)).toEqual({ ok: false, reason: 'Already in Draft' })
    })

    it('agrees with dropAction on every page, status, lane and viewer', () => {
      for (const page of PAGES) for (const status of ITEM_STATUSES) for (const v of [editor, manager, scheduler, admin]) {
        const c = card({ status })
        for (const l of pageLanes(page)) {
          const d = dropOnLane(c, l, v)
          const first = l.columns.map(col => ({ col, d: dropAction(c, col, v) })).find(x => x.d.ok)
          if (first) {
            expect(d, `${page}/${status}/${l.key}/${v.role}`).toMatchObject({ ok: true, column: first.col })
          } else {
            expect(d.ok, `${page}/${status}/${l.key}/${v.role}`).toBe(false)
          }
        }
        // the reachable lanes are exactly the ones a drop would take
        expect(reachableLanes(page, c, v)).toEqual(pageLanes(page).filter(l => dropOnLane(c, l, v).ok).map(l => l.key))
      }
    })
  })
})

describe('Posted keeps the last two weeks', () => {
  it('a card posted within the window stays; older leaves; unposted cards are never touched', () => {
    expect(POSTED_DAYS).toBe(14)
    expect(recentlyPosted(card({ status: 'published', updated_at: '2026-09-01T10:00:00Z' }), TODAY)).toBe(true)
    expect(recentlyPosted(card({ status: 'scheduled', updated_at: '2026-08-23T23:59:00Z' }), TODAY)).toBe(true)   // exactly 14 days
    expect(recentlyPosted(card({ status: 'published', updated_at: '2026-08-22T10:00:00Z' }), TODAY)).toBe(false)  // 15 days
    expect(recentlyPosted(card({ status: 'published', updated_at: '2026-07-01' }), TODAY)).toBe(false)
    // the cut-off is the status change when the row records one
    expect(recentlyPosted(card({ status: 'published', updated_at: '2026-09-05', status_changed_at: '2026-08-01' }), TODAY)).toBe(false)
    expect(recentlyPosted(card({ status: 'published', updated_at: '2026-08-01', status_changed_at: '2026-09-05' }), TODAY)).toBe(true)
    // a different window
    expect(recentlyPosted(card({ status: 'published', updated_at: '2026-09-01' }), TODAY, 3)).toBe(false)
    // no timestamp: nothing is hidden on a guess
    expect(recentlyPosted(card({ status: 'published', updated_at: null }), TODAY)).toBe(true)
    // not posted: untouched, however old
    expect(recentlyPosted(card({ status: 'draft_uploaded', updated_at: '2025-01-01' }), TODAY)).toBe(true)
    expect(recentlyPosted(card({ status: 'approved_for_scheduling', updated_at: '2025-01-01' }), TODAY)).toBe(true)
  })

  it('pageCards applies the cut on all three pages, and only with a date', () => {
    const rows = [
      card({ id: 'old', owner_id: 'ed', status: 'published', updated_at: '2026-07-01T00:00:00Z' }),
      card({ id: 'new', owner_id: 'ed', status: 'scheduled', updated_at: '2026-09-05T00:00:00Z' }),
      card({ id: 'ready', owner_id: 'ed', status: 'approved_for_scheduling', updated_at: '2026-07-01T00:00:00Z' }),
    ]
    expect(pageCards('production', rows, manager, TODAY).map(c => c.id)).toEqual(['new', 'ready'])
    expect(pageCards('scheduler', rows, scheduler, TODAY).map(c => c.id)).toEqual(['new', 'ready'])
    expect(pageCards('editor', rows, editor, TODAY).map(c => c.id)).toEqual(['new', 'ready'])
    // a manager looking in sees the making — posted cards were never theirs here
    expect(pageCards('editor', rows, manager, TODAY).map(c => c.id)).toEqual([])
    expect(pageCards('editor', [...rows, card({ id: 'mk', owner_id: 'x', status: 'draft_uploaded' })], manager, TODAY).map(c => c.id)).toEqual(['mk'])
    // without a date nothing is cut — nothing here reads a clock
    expect(pageCards('production', rows, manager).map(c => c.id)).toEqual(['old', 'new', 'ready'])
    expect(pageCards('production', rows, manager, null).map(c => c.id)).toEqual(['old', 'new', 'ready'])
  })

  it('the cut-off never hides a card from a lane it is not in', () => {
    const rows = BOARD_COLUMNS.flatMap(c => c.statuses.map(s => card({ id: s, status: s, updated_at: '2020-01-01' })))
    const kept = pageCards('production', rows, manager, TODAY)
    const keptColumns = new Set(kept.map(c => columnOf(c.status)))
    expect([...keptColumns].sort()).toEqual((['draft', 'internal_check', 'ready_to_post', 'with_client'] as BoardColumnKey[]).sort())
  })
})

describe('the Overview\'s lenses', () => {
  const ctx = {
    viewer: editor, today: TODAY,
    postingToday: new Set(['p']), connectedClientIds: new Set(['c1']),
  }
  it('each filter has a label and a meaning', () => {
    for (const f of SHOW_FILTERS) expect(SHOW_LABELS[f].length).toBeGreaterThan(3)
    expect(applyShow([card({ owner_id: 'ed' }), card({ id: 'x', owner_id: 'z' })], 'mine', ctx).map(c => c.id)).toEqual(['i1'])
    expect(applyShow([card({ due_date: '2026-09-01' }), card({ id: 'x', due_date: '2026-10-01' })], 'due', ctx).map(c => c.id)).toEqual(['i1'])
    expect(applyShow([card({ status: 'revision_required' }), card({ id: 'x' })], 'back', ctx).map(c => c.id)).toEqual(['i1'])
    expect(applyShow([card({ status: 'revision_complete' }), card({ id: 'x' })], 'decide', ctx).map(c => c.id)).toEqual(['i1'])
    expect(applyShow([card({ id: 'p', status: 'scheduled' }), card({ id: 'x', status: 'scheduled' })], 'today', ctx).map(c => c.id)).toEqual(['p'])
    expect(applyShow([
      card({ status: 'approved_for_scheduling', client_id: 'c9' }),
      card({ id: 'x', status: 'approved_for_scheduling', client_id: 'c1' }),
    ], 'account', ctx).map(c => c.id)).toEqual(['i1'])
    expect(applyShow([card()], null, ctx)).toHaveLength(1)
  })

  it('a board address carries the view, the column and the lens', () => {
    expect(boardHref('production', { column: 'with_client' })).toBe('/dashboard/production?view=board&column=with_client')
    expect(boardHref('editor', { show: 'due' })).toBe('/dashboard/editor?show=due')
    expect(boardHref('scheduler')).toBe('/dashboard/scheduler')
  })
})

describe('each role\'s Overview', () => {
  const rows: BoardViewCard[] = [
    card({ id: 'a', owner_id: 'ed', status: 'draft_uploaded', due_date: '2026-09-01' }),
    card({ id: 'b', owner_id: 'ed', status: 'revision_required' }),
    card({ id: 'c', owner_id: 'other', status: 'internal_review' }),
    card({ id: 'd', owner_id: 'other', status: 'client_review' }),
    card({ id: 'e', owner_id: 'ed', status: 'approved_for_scheduling', client_id: 'c9' }),
    card({ id: 'f', owner_id: 'other', status: 'scheduled' }),
    card({ id: 'g', owner_id: 'ed', status: 'published', due_date: '2026-09-01' }),
  ]

  it('an editor: assigned, due, came back — each a link into those cards', () => {
    const tiles = overviewTiles({ viewer: editor, cards: rows, today: TODAY })
    expect(tiles.map(t => t.key)).toEqual(['assigned', 'due', 'back'])
    expect(tiles[0].stats[0].value).toBe(3)         // a, b, e — g is posted
    expect(tiles[1].stats[0].value).toBe(1)         // a
    expect(tiles[1].href).toBe('/dashboard/editor?show=due')
    expect(tiles[2].stats[0].value).toBe(1)         // b
    expect(tiles[2].href).toBe('/dashboard/editor?show=back')
  })

  it('a scheduler: ready, going out today, waiting on an account', () => {
    const tiles = overviewTiles({
      viewer: scheduler, cards: rows, today: TODAY,
      postingToday: new Set(['f']), connectedClientIds: new Set(['c1']),
    })
    expect(tiles.map(t => t.key)).toEqual(['ready', 'today', 'account'])
    expect(tiles[0].stats[0].value).toBe(1)
    expect(tiles[0].href).toBe('/dashboard/scheduler?column=ready_to_post')
    expect(tiles[1].stats[0].value).toBe(1)
    expect(tiles[2].stats[0].value).toBe(1)          // e — client c9 has no channel
  })

  it('an account manager: their clients, what needs their decision, what is with clients', () => {
    const tiles = overviewTiles({ viewer: manager, cards: rows, today: TODAY, clientCount: 4 })
    expect(tiles.map(t => t.key)).toEqual(['clients', 'decide', 'with_client'])
    expect(tiles[0].stats[0].value).toBe(4)
    expect(tiles[1].stats[0].value).toBe(1)          // c
    expect(tiles[1].href).toBe('/dashboard/production?view=board&show=decide')
    expect(tiles[2].stats[0].value).toBe(1)          // d
    expect(tiles[2].href).toBe('/dashboard/production?view=board&column=with_client')
  })

  it('a super admin: the agency at a glance, plus Leads', () => {
    const tiles = overviewTiles({ viewer: admin, cards: rows, today: TODAY, leadsWeek: 3 })
    expect(tiles[0].key).toBe('glance')
    expect(tiles[0].stats.map(s => s.value)).toEqual(
      BOARD_COLUMNS.map(c => rows.filter(r => columnOf(r.status) === c.key).length))
    expect(tiles.some(t => t.key === 'leads' && t.stats[0].value === 3)).toBe(true)
    expect(tiles.find(t => t.key === 'leads')?.href).toBe('/dashboard/leads')
  })

  it('every tile has a link and a plain label', () => {
    for (const v of [editor, scheduler, manager, admin]) {
      for (const t of overviewTiles({ viewer: v, cards: rows, today: TODAY })) {
        expect(t.href.startsWith('/dashboard')).toBe(true)
        expect(t.actionLabel.length).toBeGreaterThan(2)
        for (const s of t.stats) expect(s.label).toMatch(/^[a-z]/)
      }
    }
  })
})
