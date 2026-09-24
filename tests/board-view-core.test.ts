import { describe, expect, it } from 'vitest'
import {
  BOOKED_LABEL, NEEDS_CLIENT_REASON, POSTED_LABEL, READY_FOR_CHECK_LABEL, SEND_BACK_LABEL, SHOW_FILTERS, SHOW_LABELS,
  COLUMN_EMPTY, LANE_EMPTY, OLDER_POSTS_NOTE, POSTED_DAYS,
  applyShow, boardHref, cardActions, cardLines, dropAction, dropOnLane, groupByLane, handedOver, handedToWords, initialsOf, isAssignedTo, needsWorkFirst, UPLOAD_FIRST,
  laneOf, moveTargets, overviewTiles, pageCards, pageLanes, reachableLanes, recentlyPosted, shortDate,
  postApprovalOffer, postWaitingLine,
  POST_APPROVE_LABEL, POST_CHANGES_LABEL, POST_WAITING_CLIENT, POST_WAITING_LINE, POST_WAITING_MANAGER,
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
    // the version is the hand-in round, never the count of link saves (16 Sep 2026)
    expect(l.version).toBe('version 1')
    expect(cardLines(card({ edit_round: 3 } as never), { today: TODAY }).version).toBe('version 3')
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
  it('an editor hands a draft on for the quality check, and that is the only button', () => {
    // once a finished edit is handed in (16 Sep 2026)
    const { primary, more } = cardActions(card({ link_url: 'https://drive.google.com/drive/folders/E', link_kind: 'drive', link_final: true } as never), editor)
    expect(primary).toEqual({ kind: 'transition', to: 'quality_check', label: 'Ready for quality check' })
    expect(READY_FOR_CHECK_LABEL).toBe('Ready for checking')
    expect(more).toEqual([])
  })

  it('an editor gets nothing on a card that is with the manager', () => {
    const { primary, more } = cardActions(card({ status: 'internal_review' }), editor)
    expect(primary).toBeNull()
    expect(more).toEqual([])
  })

  it('a manager on a legacy card sends it to the quality reviewer or sends it back with what to change', () => {
    const { primary, more } = cardActions(card({ status: 'internal_review' }), manager)
    expect(primary).toEqual({ kind: 'transition', to: 'quality_check', label: 'Send to the quality reviewer' })
    expect(more).toContainEqual({ kind: 'send_back', to: 'revision_required', label: SEND_BACK_LABEL })
    // the client is the quality reviewer's to send to, never the manager's
    expect(more.some(a => a.to === 'client_review')).toBe(false)
    expect(more.some(a => a.to === 'approved_for_scheduling')).toBe(false)
  })

  it('the hand-in to quality check is the holder’s own press — a manager or super admin gets it only on a card nobody holds, or their own (16 Sep 2026)', () => {
    const sa = { id: 'u-sa', role: 'super_admin' as const, quality_reviewer: false }
    const held = card({ status: 'draft_uploaded', owner_id: 'ed', link_url: 'https://drive.google.com/drive/folders/E', link_kind: 'drive', link_final: true } as never)
    const all = (c: BoardViewCard, v: BoardViewer) => { const a = cardActions(c, v); return [a.primary, ...a.more].filter(Boolean).map(x => x!.to) }
    expect(all(held, sa)).not.toContain('quality_check')
    expect(all(card({ status: 'draft_uploaded', owner_id: null, link_url: 'https://drive.google.com/drive/folders/E', link_kind: 'drive', link_final: true } as never), sa)).toContain('quality_check')
    expect(all(card({ status: 'draft_uploaded', owner_id: 'u-sa', link_url: 'https://drive.google.com/drive/folders/E', link_kind: 'drive', link_final: true } as never), sa)).toContain('quality_check')
    expect(all(card({ status: 'revision_required', owner_id: 'ed' }), { id: 'am', role: 'account_manager' as const, quality_reviewer: false })).not.toContain('quality_check')
    // the editor holding it keeps the press — once a finished edit is in; a folder to work from alone is not one
    const ed = { id: 'ed', role: 'editor' as const, quality_reviewer: false }
    expect(all(card({ status: 'draft_uploaded', owner_id: 'ed' }), ed)).not.toContain('quality_check')
    expect(all(card({ status: 'draft_uploaded', owner_id: 'ed', link_url: 'https://drive.google.com/drive/folders/F', link_kind: 'drive', raw_assets_url: 'https://drive.google.com/drive/folders/F' }), ed)).not.toContain('quality_check')
    expect(all(card({ status: 'draft_uploaded', owner_id: 'ed', link_url: 'https://drive.google.com/drive/folders/E', link_kind: 'drive', link_final: true } as never), ed)).toContain('quality_check')
  })

  it('the quality reviewer passes a card to the client, or sends it back; a manager only pulls it back', () => {
    const joy = { id: 'u-joy', role: 'editor' as const, quality_reviewer: true }
    const { primary, more } = cardActions(card({ status: 'quality_check' }), joy)
    expect(primary).toEqual({ kind: 'transition', to: 'client_review', label: 'Passed quality check' })
    expect(more.map(a => a.to)).toEqual(['revision_required'])
    // a second version says so on the button — it is a resend (16 Sep 2026)
    expect(cardActions(card({ status: 'quality_check', edit_round: 2 } as never), joy).primary)
      .toEqual({ kind: 'transition', to: 'client_review', label: 'Passed quality check — resend version 2 to the client' })
    expect(cardActions(card({ status: 'client_review', edit_round: 2 } as never), joy).primary?.label ?? '').not.toContain('resend version')
    // not the manager's turn, so no filled button — the pull-back sits in the dots
    const am = cardActions(card({ status: 'quality_check' }), manager)
    expect(am.primary).toBeNull()
    expect(am.more).toEqual([{ kind: 'send_back', to: 'revision_required', label: SEND_BACK_LABEL }])
  })

  it('offers "Approve without client" only to the quality reviewer, and only when the card does not need the client', () => {
    const joy = { id: 'u-joy', role: 'editor' as const, quality_reviewer: true }
    // …and with the client's approval switched off, it IS the pass — the filled button (18 Sep 2026)
    const { primary, more } = cardActions(card({ status: 'quality_check', client_approval_required: false }), joy)
    expect(primary).toEqual({ kind: 'transition', to: 'approved_for_scheduling', label: 'Passed quality check' })
    expect(more.some(a => a.kind === 'transition' && a.to === 'client_review' && a.label === 'Send to the client anyway')).toBe(true)
    const strict = cardActions(card({ status: 'quality_check' }), joy)
    expect(strict.more.some(a => a.to === 'approved_for_scheduling')).toBe(false)
  })

  it('with the client, a manager logs the answer or sends it back — never two "send back"s', () => {
    const { primary, more } = cardActions(card({ status: 'client_review' }), manager)
    // it is the client's turn, so nobody on the team gets a filled button
    expect(primary).toBeNull()
    expect(more.filter(a => a.kind === 'send_back')).toHaveLength(1)
    expect(more).toContainEqual({ kind: 'transition', to: 'approved_for_scheduling', label: "Log the client's approval" })
  })

  // 9 Sep 2026: an uploaded post is booked on the Schedule page and marked
  // posted one file at a time — the whole-card presses were a 400 or a lie
  it('an uploaded post offers no whole-card Booked in / Posted press', () => {
    const ready = cardActions(card({ status: 'approved_for_scheduling', adhoc_post: true } as Partial<BoardViewCard>), scheduler)
    expect([ready.primary, ...ready.more].filter(Boolean).some(a => a!.kind === 'transition' && (a!.to === 'scheduled' || a!.to === 'published'))).toBe(false)
    const booked = cardActions(card({ status: 'scheduled', adhoc_post: true } as Partial<BoardViewCard>), manager)
    expect([booked.primary, ...booked.more].filter(Boolean).some(a => a!.kind === 'transition' && a!.to === 'published')).toBe(false)
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
    const d = dropAction(card(), 'quality_check', editor)
    expect(d).toEqual({ ok: true, column: 'quality_check', action: { kind: 'transition', to: 'quality_check', label: 'Ready for quality check' } })
  })

  it('a manager dropping a client card back on Draft is asked what to change', () => {
    const d = dropAction(card({ status: 'client_review' }), 'draft', manager)
    expect(d.ok && d.action.kind).toBe('send_back')
  })

  it('a scheduler dropping on Booked in just moves the card — "Booked in", no dialog', () => {
    const d = dropAction(card({ status: 'approved_for_scheduling' }), 'booked', scheduler)
    expect(d).toEqual({ ok: true, column: 'booked', action: { kind: 'transition', to: 'scheduled', label: BOOKED_LABEL } })
    // …and never onto Posted: that column is for what is live
    expect(dropAction(card({ status: 'approved_for_scheduling' }), 'posted', scheduler).ok).toBe(false)
  })

  it('a refused drop carries the machine\'s own reason', () => {
    const d = dropAction(card(), 'with_client', editor)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/may not|Nothing moves/)
    const same = dropAction(card(), 'draft', editor)
    if (!same.ok) expect(same.reason).toBe('Already in Draft')
  })

  it('the keyboard gets the same targets as the mouse, in words', () => {
    // a legacy card at the old manager's check sits IN Quality check: the one
    // move a drag can express is back to Draft (send back for changes)
    const t = moveTargets(card({ status: 'internal_review' }), manager)
    expect(t.map(x => x.column)).toEqual(['draft'])
    expect(t[0].label).toBe('Move to Draft — Send back for changes')
    expect(moveTargets(card(), editor)[0].label).toBe('Move to Quality check — Ready for quality check')
    // a card that needs the client has no way straight to Ready to post
    expect(t.some(x => x.column === 'ready_to_post')).toBe(false)
    const joy = { id: 'u-joy', role: 'editor' as const, quality_reviewer: true }
    const d = dropAction(card({ status: 'quality_check' }), 'ready_to_post', joy)
    expect(d).toEqual({ ok: false, reason: NEEDS_CLIENT_REASON })
    // …unless the card does not need them — and only the quality reviewer holds that edge
    const free = moveTargets(card({ status: 'quality_check', client_approval_required: false }), joy)
    expect(free.some(x => x.column === 'ready_to_post')).toBe(true)
    const notMine = moveTargets(card({ status: 'internal_review', client_approval_required: false }), manager)
    expect(notMine.some(x => x.column === 'ready_to_post')).toBe(false)
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

  it('Production is everything the person may see, in eight lanes', () => {
    expect(pageCards('production', rows, manager).map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 't', 'u'])
    expect(pageLanes('production').map(l => l.key)).toEqual(BOARD_COLUMNS.map(c => c.key))
  })

  it('Editor is only what is assigned to the editor, whatever the kind', () => {
    expect(pageCards('editor', rows, editor).map(c => c.id)).toEqual(['a', 'c', 'u'])
    expect(pageLanes('editor').map(l => l.key)).toEqual(['in_progress', 'quality_check', 'with_client', 'for_handoff', 'done'])
  })

  it('a manager on the Editor page sees every lane — a card lives there from In Progress to Done (14 Sep 2026)', () => {
    // every card, whatever its kind, whoever holds it, approved and booked too
    expect(pageCards('editor', rows, manager).map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 't', 'u'])
  })

  it('Post approval is the end of the edit: only approved, booked and posted cards (13 Sep 2026)', () => {
    // …plus the card handed to THIS scheduler ('t'), whatever column it sits in
    expect(pageCards('scheduler', rows, scheduler).map(c => c.id)).toEqual(['c', 'd', 't'])
    expect(pageLanes('scheduler').map(l => l.key)).toEqual(BOARD_COLUMNS.map(c => c.key))
  })

  it('a tagged question counts as assignment', () => {
    expect(isAssignedTo(card({ owner_id: 'x', my_open_task: true }), 'ed')).toBe(true)
    expect(isAssignedTo(card({ owner_id: 'x', scheduler_ids: ['ed'] }), 'ed')).toBe(true)
    expect(isAssignedTo(card({ owner_id: 'x' }), 'ed')).toBe(false)
  })
})

describe('the lanes each page arranges the eight columns into', () => {
  const PAGES: BoardPage[] = ['production', 'editor', 'scheduler']

  it('Production is eight lanes, one column each, none folded', () => {
    const lanes = pageLanes('production')
    expect(lanes.map(l => l.columns)).toEqual(BOARD_COLUMNS.map(c => [c.key]))
    expect(lanes.every(l => !l.folded)).toBe(true)
    expect(lanes.map(l => l.label)).toEqual(BOARD_COLUMNS.map(c => c.label))
  })

  it('Production and Post approval have the same eight lanes — one column each', () => {
    // the owner's standing rule: work needs an internal check and the client's
    // word whoever is looking, so no page hides a stage. What differs is which
    // CARDS are shown and which button each role gets. Booked in is its own
    // column (11 Sep 2026): a post the channel holds is not yet posted.
    const keys = BOARD_COLUMNS.map(c => c.key)
    for (const page of ['production', 'scheduler'] as const) {
      const lanes = pageLanes(page)
      expect(lanes.map(l => l.key)).toEqual(keys)
      expect(lanes.every(l => l.columns.length === 1)).toBe(true)
      expect(lanes.every(l => !l.folded)).toBe(true)
    }
    expect(keys).toContain('booked')
  })

  it('the Editor page is five lanes: In Progress, Quality check, With client, For Handoff, Done', () => {
    // Abby's rule (11 Sep 2026): the maker's submit goes to Joy; the
    // client's look sits inside the same lane with a chip saying who has it
    const lanes = pageLanes('editor')
    expect(lanes.map(l => l.label)).toEqual(['In Progress', 'Quality check', 'With client', 'For Handoff', 'Done'])
    expect(lanes.map(l => l.folded)).toEqual([false, false, false, false, true])
    expect(lanes.map(l => l.columns)).toEqual([['draft'], ['quality_check'], ['with_client'], ['ready_to_post'], ['booked', 'posted', 'delivered']])
    // every column is in exactly one lane, so no card can fall off the page
    expect(lanes.flatMap(l => l.columns).sort()).toEqual(BOARD_COLUMNS.map(c => c.key).sort())
  })

  it('a column deep link lands on the lane it sits in', () => {
    expect(laneOf('production', 'posted')).toBe('posted')
    expect(laneOf('production', 'booked')).toBe('booked')
    expect(laneOf('editor', 'posted')).toBe('done')
    expect(laneOf('editor', 'booked')).toBe('done')
    expect(laneOf('editor', 'ready_to_post')).toBe('for_handoff')
    expect(laneOf('editor', 'draft')).toBe('in_progress')
    expect(laneOf('editor', 'quality_check')).toBe('quality_check')
    expect(laneOf('scheduler', 'draft')).toBe('draft')
    expect(laneOf('scheduler', 'with_client')).toBe('with_client')
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

    it('every card lands in its own column lane, in input order', () => {
      for (const page of PAGES) {
        const g = groupByLane(pageLanes(page), rows)
        expect(g.map(x => x.lane.key)).toEqual(pageLanes(page).map(l => l.key))
        const byKey = new Map(g.map(x => [x.lane.key, x.cards.map(c => c.id)]))
        for (const row of rows) {
          expect(byKey.get(laneOf(page, columnOf(row.status))), `${page}/${row.id}`).toContain(row.id)
        }
      }
      // the Editor's Done rail holds the booked AND the posted card, in input order
      const done = groupByLane(pageLanes('editor'), rows).find(x => x.lane.key === 'done')!
      expect(done.cards.map(c => c.id)).toEqual(['b', 'e'])
    })

    it('a lane made of several columns still holds them all, in input order', () => {
      // no page folds today, but the grouping supports it — pinned so a future
      // folded lane cannot quietly lose a card
      const folded = [{ key: 'done' as never, label: 'Done',
        columns: ['ready_to_post', 'posted'] as never, folded: true, empty: 'Nothing done yet.' }]
      const g = groupByLane(folded as never, rows)
      expect(g[0].cards.map(c => c.id)).toEqual(
        rows.filter(r => ['ready_to_post', 'posted'].includes(columnOf(r.status))).map(r => r.id))
    })

    it('lists every lane, empty ones included, and never loses a card', () => {
      expect(groupByLane(pageLanes('scheduler'), []).map(x => x.cards)).toEqual(BOARD_COLUMNS.map(() => []))
      for (const page of PAGES) {
        const total = groupByLane(pageLanes(page), rows).reduce((n, x) => n + x.cards.length, 0)
        expect(total, page).toBe(rows.length)
      }
    })
  })

  describe('dropping on a lane', () => {
    const lane = (page: BoardPage, key: string) => pageLanes(page).find(l => l.key === key)!

    it('the editor\'s Quality check lane is entered at the quality check', () => {
      const d = dropOnLane(card(), lane('editor', 'quality_check'), editor)
      expect(d).toEqual({ ok: true, lane: 'quality_check', column: 'quality_check', action: { kind: 'transition', to: 'quality_check', label: 'Ready for quality check' } })
    })

    it('a drop lands on the stage the rules allow, whoever drops it', () => {
      // the Editor's Done rail: a ready card dropped there is booked in, the
      // first stage inside the rail the rules allow
      const d = dropOnLane(card({ status: 'approved_for_scheduling' }), lane('editor', 'done'), scheduler)
      expect(d).toEqual({ ok: true, lane: 'done', column: 'booked', action: { kind: 'transition', to: 'scheduled', label: BOOKED_LABEL } })
      const joy = { id: 'u-joy', role: 'editor' as const, quality_reviewer: true }
      const free = dropOnLane(card({ status: 'quality_check', client_approval_required: false }), lane('editor', 'for_handoff'), joy)
      expect(free.ok && free.column).toBe('ready_to_post')
      expect(free.ok && free.action.to).toBe('approved_for_scheduling')
      const back = dropOnLane(card({ status: 'client_review' }), lane('scheduler', 'draft'), manager)
      expect(back.ok && back.column).toBe('draft')
    })

    it('a lane with no way in refuses in plain words', () => {
      // an editor cannot move a draft past the manager
      const d = dropOnLane(card(), lane('editor', 'done'), editor)
      expect(d.ok).toBe(false)
      if (!d.ok) expect(d.reason).toMatch(/may not|Nothing moves/)
      // a card that needs the client says so — to the one hat that could pass it
      const joy = { id: 'u-joy', role: 'editor' as const, quality_reviewer: true }
      const needs = dropOnLane(card({ status: 'quality_check' }), lane('editor', 'for_handoff'), joy)
      expect(needs).toEqual({ ok: false, reason: NEEDS_CLIENT_REASON })
      // …and a manager is told it is not their move
      const notMine = dropOnLane(card({ status: 'quality_check' }), lane('editor', 'for_handoff'), manager)
      expect(notMine.ok).toBe(false)
      if (!notMine.ok) expect(notMine.reason).toMatch(/may not/)
      // a card already in the lane, with nowhere else inside it, says so
      // the editor's Posted lane is called Done, so the refusal says so
      const same = dropOnLane(card({ status: 'published' }), lane('editor', 'done'), scheduler)
      expect(same).toEqual({ ok: false, reason: 'Already in Done' })
      expect(dropOnLane(card({ status: 'published' }), pageLanes('scheduler').find(l => l.key === 'posted')!, scheduler))
        .toEqual({ ok: false, reason: 'Already in Posted' })
      expect(dropOnLane(card(), lane('editor', 'in_progress'), editor)).toEqual({ ok: false, reason: 'Already in In Progress' })
      expect(dropOnLane(card(), lane('production', 'draft'), editor)).toEqual({ ok: false, reason: 'Already in Draft' })
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
    // a manager sees every lane, with the same cut on old posted cards
    expect(pageCards('editor', rows, manager, TODAY).map(c => c.id)).toEqual(['new', 'ready'])
    expect(pageCards('editor', [...rows, card({ id: 'mk', owner_id: 'x', status: 'draft_uploaded' })], manager, TODAY).map(c => c.id)).toEqual(['new', 'ready', 'mk'])
    // without a date nothing is cut — nothing here reads a clock
    expect(pageCards('production', rows, manager).map(c => c.id)).toEqual(['old', 'new', 'ready'])
    expect(pageCards('production', rows, manager, null).map(c => c.id)).toEqual(['old', 'new', 'ready'])
  })

  it('the cut-off never hides a card from a lane it is not in', () => {
    const rows = BOARD_COLUMNS.flatMap(c => c.statuses.map(s => card({ id: s, status: s, updated_at: '2020-01-01' })))
    const kept = pageCards('production', rows, manager, TODAY)
    const keptColumns = new Set(kept.map(c => columnOf(c.status)))
    // Booked in is never cut: a card the channel still holds is coming, not old
    expect([...keptColumns].sort()).toEqual((['booked', 'draft', 'quality_check', 'ready_to_post', 'with_client'] as BoardColumnKey[]).sort())
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
    expect(boardHref('production', { column: 'with_client' })).toBe('/dashboard/production?column=with_client')
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
    expect(tiles.map(t => t.key)).toEqual(['clients', 'decide', 'quality', 'with_client'])
    expect(tiles[0].stats[0].value).toBe(4)
    // c is a check nobody was asked for: not "waiting on you", but on its own line
    expect(tiles[1].stats).toEqual([{ value: 0, label: 'waiting on you' }, { value: 1, label: 'nobody asked yet' }])
    expect(tiles[1].href).toBe('/dashboard/scheduler?show=decide')
    expect(tiles[2].key).toBe('quality')
    // the checker's desk is the Editor page's Quality check lane (14 Sep 2026)
    expect(tiles[2].href).toBe('/dashboard/editor?column=quality_check')
    expect(tiles[3].stats[0].value).toBe(1)          // d
    expect(tiles[3].href).toBe('/dashboard/scheduler?column=with_client')
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

describe('a post made on the Schedule page is not production work', () => {
  const viewer = { id: 'u1', role: 'account_manager' as const }
  const rows = [
    { id: 'work', status: 'draft_uploaded' as ItemStatus, owner_id: 'u1', title: 'Work', client_id: 'c1', due_date: null },
    { id: 'adhoc', status: 'draft_uploaded' as ItemStatus, owner_id: 'u1', title: 'Post', client_id: 'c1', due_date: null, adhoc_post: true },
  ]
  it('keeps its card, stays off Production and Editor, and lives on Post approval (8 Sep 2026)', () => {
    for (const page of ['production', 'editor'] as const) {
      const ids = pageCards(page, rows, viewer).map(c => c.id)
      expect(ids, page).toEqual(['work'])
    }
    // Post approval is the END of the edit (13 Sep 2026): a card being
    // made or checked is not there; it arrives once approved and ready to post
    expect(pageCards('scheduler', rows, viewer).map(c => c.id)).toEqual(['adhoc'])
    const checking = { ...rows[0], status: 'quality_check' as ItemStatus }
    expect(pageCards('scheduler', [checking, rows[1]], viewer).map(c => c.id)).toEqual(['adhoc'])
    const ready = { ...rows[0], status: 'approved_for_scheduling' as ItemStatus }
    expect(pageCards('scheduler', [ready, rows[1]], viewer).map(c => c.id)).toEqual(['work', 'adhoc'])
  })
})

/* ── a post waiting on somebody ─────────────────────────────────── */

/**
 * `posting_approval_state === 'pending'` used to be reachable from the bell
 * and the email and nowhere else — the card drew nothing and the side panel
 * deliberately drew nothing. An account manager who works from the board was
 * holding somebody up with nothing on any screen to press.
 */
describe('a post waiting on somebody, said on the card', () => {
  const waiting = (over: Partial<BoardViewCard> = {}) => card({
    status: 'approved_for_scheduling', posting_approval_state: 'pending', ...over,
  })

  it('says nothing at all when no post is waiting', () => {
    expect(postWaitingLine(card(), manager)).toBeNull()
    expect(postApprovalOffer(card(), manager)).toBeNull()
    expect(postWaitingLine(waiting({ posting_approval_state: 'approved' }), manager)).toBeNull()
  })

  it('tells the person who can answer that it is theirs, and offers the two answers', () => {
    expect(postWaitingLine(waiting(), manager)).toBe(POST_WAITING_LINE)
    expect(POST_WAITING_LINE).toBe('A post is waiting on your OK')
    const offer = postApprovalOffer(waiting(), manager)
    expect(offer?.primary).toEqual({ kind: 'post_approval', to: 'approve', label: POST_APPROVE_LABEL })
    expect(offer?.changes).toEqual({ kind: 'post_approval', to: 'request_changes', label: POST_CHANGES_LABEL })
    expect(postApprovalOffer(waiting(), admin)).not.toBeNull()
  })

  it('tells everybody else whose wait it is, and offers them nothing to press', () => {
    expect(postWaitingLine(waiting(), scheduler)).toBe(POST_WAITING_MANAGER)
    expect(postApprovalOffer(waiting(), scheduler)).toBeNull()
    const withClient = waiting({ posting_client_required: true })
    expect(postWaitingLine(withClient, scheduler)).toBe(POST_WAITING_CLIENT)
    expect(POST_WAITING_CLIENT).toBe('A post is waiting on the client')
  })

  it('is the card\'s primary action for the person who may answer, with the ordinary move behind it', () => {
    const { primary, more } = cardActions(waiting(), manager)
    expect(primary).toEqual({ kind: 'post_approval', to: 'approve', label: POST_APPROVE_LABEL })
    expect(more).toContainEqual({ kind: 'post_approval', to: 'request_changes', label: POST_CHANGES_LABEL })
    // nothing is taken away: the move the card had is still offered
    const plain = cardActions(card({ status: 'approved_for_scheduling' }), manager)
    if (plain.primary) expect(more).toContainEqual(plain.primary)
  })

  it('changes nobody else\'s card', () => {
    expect(cardActions(waiting(), scheduler))
      .toEqual(cardActions(card({ status: 'approved_for_scheduling' }), scheduler))
  })

  /**
   * Media uploaded straight onto the Schedule page keeps its card off all
   * three boards (`adhoc_post`). A post on such a card waiting on THIS
   * person is the one exception, and only on the Scheduler board — nobody
   * should be asked for an answer they have no way to give.
   */
  it('keeps an ad-hoc piece on the Post approval board, every column, and off the other two (8 Sep 2026)', () => {
    const adhoc = waiting({ id: 'ad1', adhoc_post: true })
    expect(pageCards('scheduler', [adhoc], manager, TODAY).map(c => c.id)).toEqual(['ad1'])
    expect(pageCards('scheduler', [adhoc], scheduler, TODAY).map(c => c.id)).toEqual(['ad1'])
    expect(pageCards('production', [adhoc], manager, TODAY)).toEqual([])
    expect(pageCards('editor', [adhoc], manager, TODAY)).toEqual([])
    const answered = waiting({ id: 'ad1', adhoc_post: true, posting_approval_state: 'approved' })
    expect(pageCards('scheduler', [answered], manager, TODAY).map(c => c.id)).toEqual(['ad1'])
  })
})

/* ── an uploaded post is a "Post" on the card (8 Sep 2026) ─────────────── */

describe('the kind word on an uploaded post', () => {
  it('says Post, not the kind the upload was filed under', () => {
    const lines = cardLines({
      id: 'x', title: 'T', status: 'internal_review', adhoc_post: true,
      work_kinds: { name: 'Video edit' },
    } as never, { today: '2026-09-08' })
    expect(lines.kind).toBe('Post')
  })
})

/* ── a piece posted in parts (9 Sep 2026) ──────────────────────────────── */

describe('the card says how much of it has gone out', () => {
  it('"2 of 4 posted" while part-way, nothing otherwise', () => {
    const l = (posted_slides: unknown) => cardLines({
      id: 'x', title: 'T', status: 'approved_for_scheduling', client_id: 'c', owner_id: null, due_date: null, posted_slides,
    } as never, { today: '2026-09-09' })
    expect(l({ urls: ['a', 'b'], posted: 2, total: 4 }).posted).toBe('2 of 4 posted')
    expect(l({ urls: [], posted: 0, total: 4 }).posted).toBeNull()
    expect(l(undefined).posted).toBeNull()
  })
})

/* ── the three-dot menu never offers what a booked or posted card cannot take (10 Sep 2026) ── */

import { readFileSync } from 'node:fs'

describe('the card menu on a settled card', () => {
  const src = readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')
  it('hides Hand to and Change the kind of work once a card is booked or posted', () => {
    expect(src).toContain("const settled = card.status === 'scheduled' || card.status === 'published'")
    expect(src).toContain('{!settled && !adhocPost && !editorFace && !schedulerFace && (')
    expect(src).toContain('{onHandTo && !settled && (')
  })
})

/* ── the playbook's delivery date on the card face (11 Sep 2026) ── */

describe('the Sent to client line', () => {
  it('says when the final first reached the client, and nothing before that', () => {
    const base = {
      id: 'c1', client_id: 'k', title: 'Reel 1', status: 'approved_for_scheduling', owner_id: null,
      due_date: null, work_kinds: null, clients: { name: 'Acme' },
    } as unknown as Parameters<typeof cardLines>[0]
    const opts = { today: '2026-09-11', viewerId: 'me' }
    expect(cardLines(base, opts).delivered).toBeNull()
    expect(cardLines({ ...base, delivered_at: '2026-09-11T03:00:00Z' }, opts).delivered)
      .toMatch(/^Sent to client /)
  })
})

/* ── the tutorial walk of 11 Sep 2026 ── */

describe('a general user\u2019s Overview and an empty card', () => {
  it('gives a general user their own tiles, never the manager\u2019s decision tiles', () => {
    const general = { id: 'u-general', role: 'general' as const }
    const tiles = overviewTiles({ viewer: general, cards: [], today: TODAY })
    expect(tiles.map(t => t.key)).toEqual(['assigned', 'due', 'ready'])
    expect(tiles.some(t => /decision|quality/i.test(t.title))).toBe(false)
  })
  it('says an empty card needs the final before it goes for checking', () => {
    expect(needsWorkFirst({ current_version_number: null, link_url: null })).toBe(true)
    expect(needsWorkFirst({ current_version_number: 1, link_url: null })).toBe(false)
    // the open card's folder counts as work to post from (13 Sep 2026)
    expect(needsWorkFirst({ current_version_number: null, link_url: null, raw_assets_url: 'https://drive.google.com/drive/folders/1lbLSNbYXOn3Vbyk0' })).toBe(false)
    expect(needsWorkFirst({ current_version_number: 0, link_url: 'https://drive.google.com/x' })).toBe(false)
    // a designer's uploaded files count (17 Sep 2026)
    expect(needsWorkFirst({ current_version_number: null, link_url: null, final_files: [{ url: 'https://x/a.png', name: 'a.png', version: 1 }] })).toBe(false)
    expect(UPLOAD_FIRST).toBe('Upload the final first')
  })
})

describe('the quality reviewer’s "Ask for changes" asks for the words (14 Sep 2026)', () => {
  it('is a send-back with a note, like a manager’s, never a bare move', async () => {
    const { actionFor, SEND_BACK_LABEL } = await import('../app/lib/board-view-core')
    expect(actionFor('revision_required', 'Ask for changes', ['quality_reviewer'])).toEqual({ kind: 'send_back', to: 'revision_required', label: SEND_BACK_LABEL })
    expect(actionFor('revision_required', 'Ask for changes', ['account_manager'])).toEqual({ kind: 'send_back', to: 'revision_required', label: SEND_BACK_LABEL })
    // the editor's own move keeps its short face label
    expect(actionFor('quality_check', 'Revisions done — ready for quality check', ['editor'])).toEqual({ kind: 'transition', to: 'quality_check', label: 'Revisions done' })
  })
})

describe('handed to a scheduler — the editor\u2019s road ends in Done (17 Sep 2026)', () => {
  it('a card with schedulers sits in Done on the Editor page whatever its status, and stays put on pages without a Done lane', () => {
    const rows = [
      { id: 'h', status: 'draft_uploaded', scheduler_ids: ['s1'] },
      { id: 'e', status: 'draft_uploaded' },
      { id: 'p', status: 'draft_uploaded', scheduler_ids: ['s1'], adhoc_post: true },
    ] as never[]
    const editor = groupByLane(pageLanes('editor'), rows)
    expect(editor.find(x => x.lane.key === 'done')!.cards.map(c => (c as { id: string }).id)).toEqual(['h'])
    expect(editor.find(x => x.lane.key === 'in_progress')!.cards.map(c => (c as { id: string }).id)).toEqual(['e', 'p'])
    const scheduler = groupByLane(pageLanes('scheduler'), rows)
    expect(scheduler.find(x => x.lane.key === 'draft')!.cards.length).toBe(3)
    expect(handedOver({ scheduler_ids: ['s1'] })).toBe(true)
    // the owner, 24 Sep 2026: handed over is Done on the Editor page whatever the client is doing
    expect(handedOver({ scheduler_ids: ['s1'], status: 'client_review' })).toBe(true)
    expect(handedOver({ scheduler_ids: [] })).toBe(false)
    expect(handedOver({ scheduler_ids: ['s1'], adhoc_post: true })).toBe(false)
    expect(handedToWords({ scheduler_ids: ['s1', 's2'] }, new Map([['s1', 'Cath']]))).toBe('Handed to Cath')
    expect(handedToWords({ scheduler_ids: ['s9'] }, new Map())).toBe('Handed to a scheduler')
  })
})

describe('the Done lane\u2019s compact row names the scheduler (17 Sep 2026)', () => {
  it('a handed-over card reads "Handed to …" instead of its Draft stage', () => {
    const s = readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')
    expect(s).toContain("{handedOver(card as never) ? handedToWords(card as never, names ?? new Map()) : lines.stage}")
    expect(readFileSync('app/dashboard/board/Board.tsx', 'utf8')).toContain('<CompactCard card={c} today={today} onOpen={open} names={names} />')
  })
})

describe('an uploaded post is approved outright (18 Sep 2026)', () => {
  it('the pass does not ask a manager to hand a New post to a scheduler — its maker books it on the Schedule page', () => {
    const src = readFileSync('app/dashboard/board/useCardActs.tsx', 'utf8')
    expect(src).toContain("if (action.to === 'approved_for_scheduling' && ['account_manager', 'super_admin', 'general'].includes(viewer.role) && card.deliver_only !== true && card.adhoc_post !== true) {")
  })
})

describe('who may delete a card (21 Sep 2026)', () => {
  it('a manager any unposted card; an editor their own, while it is still theirs; nobody else', async () => {
    const { mayDeleteCard } = await import('../app/lib/board-view-core')
    const am = { id: 'am', role: 'account_manager' }, sa = { id: 'sa', role: 'super_admin' }, ed = { id: 'ed', role: 'editor' }, sch = { id: 'sc', role: 'scheduler' }, gen = { id: 'g', role: 'general' }
    expect(mayDeleteCard(am, { status: 'client_review', owner_id: 'x' })).toBe(true)
    expect(mayDeleteCard(sa, { status: 'scheduled', owner_id: 'x' })).toBe(true)
    expect(mayDeleteCard(am, { status: 'published', owner_id: 'x' })).toBe(false)
    // the editor's own card — held or made — at any editing stage
    expect(mayDeleteCard(ed, { status: 'draft_uploaded', owner_id: 'ed' })).toBe(true)
    expect(mayDeleteCard(ed, { status: 'quality_check', owner_id: 'x', assigned_by: 'ed' })).toBe(true)
    expect(mayDeleteCard(ed, { status: 'client_review', owner_id: 'ed' })).toBe(true)
    // not somebody else's, not once handed to a scheduler, booked in or posted
    expect(mayDeleteCard(ed, { status: 'draft_uploaded', owner_id: 'x' })).toBe(false)
    expect(mayDeleteCard(ed, { status: 'approved_for_scheduling', owner_id: 'ed', scheduler_ids: ['sc'] })).toBe(false)
    expect(mayDeleteCard(ed, { status: 'scheduled', owner_id: 'ed' })).toBe(false)
    expect(mayDeleteCard(ed, { status: 'published', owner_id: 'ed' })).toBe(false)
    expect(mayDeleteCard(sch, { status: 'draft_uploaded', owner_id: 'sc' })).toBe(false)
    expect(mayDeleteCard(gen, { status: 'draft_uploaded', owner_id: 'g' })).toBe(false)
    // the board and the server read the same rule
    expect(readFileSync('app/dashboard/board/Board.tsx', 'utf8')).toContain('canDelete={mayDeleteCard(viewer, c as never)}')
    const route = readFileSync('app/api/production/items/[id]/route.ts', 'utf8')
    expect(route).toContain("if (!mayDeleteCard(user, item)) throw new AuthzError('Only a manager, or the editor who holds this card, can delete it', 403)")
  })
})

describe('the order of a board (21 Sep 2026)', () => {
  it('board order keeps the lane; last edited newest first; last viewed by this person, never-opened last', async () => {
    const { sortCards, BOARD_SORTS, SORT_LABELS, isBoardSort } = await import('../app/lib/board-view-core')
    const cards = [{ id: 'a', updated_at: '2026-09-01' }, { id: 'b', updated_at: '2026-09-03' }, { id: 'c', updated_at: '2026-09-02' }]
    const viewed = new Map([['c', '2026-09-20T10:00'], ['a', '2026-09-21T09:00']])
    expect(sortCards(cards, 'board', viewed).map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(sortCards(cards, 'edited', viewed).map(c => c.id)).toEqual(['b', 'c', 'a'])
    expect(sortCards(cards, 'viewed', viewed).map(c => c.id)).toEqual(['a', 'c', 'b'])
    expect(BOARD_SORTS).toEqual(['board', 'created', 'edited', 'viewed'])
    expect(SORT_LABELS.created).toBe('Newest first')
    expect(sortCards([{ id: 'a', created_at: '2026-09-01' }, { id: 'b', created_at: '2026-09-03' }], 'created', new Map()).map(c => c.id)).toEqual(['b', 'a'])
    expect(SORT_LABELS.viewed).toBe('Last viewed')
    expect(isBoardSort('edited')).toBe(true)
    expect(isBoardSort('x')).toBe(false)
    // the board reads it for both views, and the sheet and the card page stamp a view
    const board = readFileSync('app/dashboard/board/Board.tsx', 'utf8')
    expect(board).toContain("usePersistedChoice(`board-sort.${page}`, BOARD_SORTS, 'board', 'sort')")
    expect(board).toContain('cards: sortCards(g.cards, sort, viewedAt)')
    expect(readFileSync('app/dashboard/board/CardSheet.tsx', 'utf8')).toContain('void fetch(`/api/production/items/${cardId}/viewed`, { method: \'POST\' })')
    expect(readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')).toContain('void fetch(`/api/production/items/${id}/viewed`, { method: \'POST\' })')
    const route = readFileSync('app/api/production/items/[id]/viewed/route.ts', 'utf8')
    expect(route).toContain('const user = await requireSignedIn()')
    expect(route).toContain('await loadItemForUser(user, id)')
    expect(route).toContain("await table<CardView>('card_views').upsert({ id: `${user.id}__${id}`, user_id: user.id, item_id: id, viewed_at })")
  })
})

describe('a card says when it was made (21 Sep 2026)', () => {
  it('the lines carry "Made <date>", the card wears it as a chip, the list as a column', async () => {
    const { cardLines } = await import('../app/lib/board-view-core')
    const lines = cardLines({ id: 'c', title: 'T', status: 'draft_uploaded', client_id: 'k', owner_id: null, created_at: '2026-09-18T01:00:00Z' } as never, { today: '2026-09-21' })
    expect(lines.made).toMatch(/^Made 18 Sep/)
    expect(cardLines({ id: 'c', title: 'T', status: 'draft_uploaded', client_id: 'k', owner_id: null } as never, { today: '2026-09-21' }).made).toBeNull()
    expect(readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')).toContain('{lines.made && <Chip tone="muted">{lines.made}</Chip>}')
    expect(readFileSync('app/dashboard/board/BoardList.tsx', 'utf8')).toContain('<th scope="col" className={th}>Made</th>')
  })
})
