import { describe, expect, it } from 'vitest'
import {
  BOOK_LABEL, NEEDS_CLIENT_REASON, PUBLISH_LABEL, SEND_BACK_LABEL, SHOW_FILTERS, SHOW_LABELS,
  applyShow, boardHref, cardActions, cardLines, dropAction, initialsOf, isAssignedTo,
  moveTargets, overviewTiles, pageCards, pageColumns, shortDate,
  type BoardViewCard, type BoardViewer,
} from '../app/lib/board-view-core'
import { BOARD_COLUMNS, columnOf } from '../app/lib/board-core'
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
  link_url: null, link_kind: null, owner_id: 'ed', due_date: null,
  current_version_number: 1, change_note: null, client_approval_required: true,
  ...over,
})

const editor: BoardViewer = { id: 'ed', role: 'editor' }
const manager: BoardViewer = { id: 'am', role: 'account_manager' }
const scheduler: BoardViewer = { id: 'sc', role: 'scheduler' }
const admin: BoardViewer = { id: 'sa', role: 'super_admin' }

describe('the lines on a card', () => {
  it('are one each: client, title, kind, link with its label, assignee, due, version', () => {
    const l = cardLines(card({
      link_url: 'https://drive.google.com/x', link_kind: 'drive',
      due_date: '2026-09-12', current_version_number: 3,
    }), { today: TODAY, names: new Map([['ed', 'Jess M']]), viewerId: 'am' })
    expect(l.client).toBe('Pure Allure')
    expect(l.title).toBe('Spring reel')
    expect(l.kind).toBe('Video edit')
    expect(l.link).toEqual({ url: 'https://drive.google.com/x', label: 'Google Drive' })
    expect(l.assignee).toBe('Jess M')
    expect(l.due).toBe('Due 12 Sep')
    expect(l.dueNow).toBe(false)
    expect(l.version).toBe('version 3')
    expect(l.stage).toBe('Drafting')
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
    expect(primary).toEqual({ kind: 'transition', to: 'internal_review', label: 'Submit for review' })
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

  it('a scheduler books a ready card in, then marks it posted', () => {
    expect(cardActions(card({ status: 'approved_for_scheduling' }), scheduler).primary)
      .toEqual({ kind: 'book', to: 'scheduled', label: BOOK_LABEL })
    expect(cardActions(card({ status: 'scheduled' }), scheduler).primary)
      .toEqual({ kind: 'publish', to: 'published', label: PUBLISH_LABEL })
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
    expect(d).toEqual({ ok: true, column: 'internal_check', action: { kind: 'transition', to: 'internal_review', label: 'Submit for review' } })
  })

  it('a manager dropping a client card on Internal check is asked what to change', () => {
    const d = dropAction(card({ status: 'client_review' }), 'internal_check', manager)
    expect(d.ok && d.action.kind).toBe('send_back')
  })

  it('a scheduler dropping on Posted is asked to book it in', () => {
    const d = dropAction(card({ status: 'approved_for_scheduling' }), 'posted', scheduler)
    expect(d.ok && d.action.kind).toBe('book')
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
  const asset = (c: BoardViewCard) => c.work_kinds?.slug !== 'task'
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

  it('Production is everything the person may see', () => {
    expect(pageCards('production', rows, manager).map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 't', 'u'])
    expect(pageColumns('production', manager)).toEqual(BOARD_COLUMNS.map(c => c.key))
  })

  it('Editor is only what is assigned to the editor, whatever the kind', () => {
    expect(pageCards('editor', rows, editor, { isAsset: asset }).map(c => c.id)).toEqual(['a', 'c', 'u'])
    expect(pageColumns('editor', editor, rows)).toEqual(BOARD_COLUMNS.map(c => c.key))
  })

  it('a manager on the Editor page sees the making, not the posting', () => {
    // every card still being made, whatever its kind and whoever holds it
    expect(pageCards('editor', rows, manager, { isAsset: asset }).map(c => c.id)).toEqual(['a', 'b', 't', 'u'])
  })

  it('Scheduler is the posting queue PLUS anything handed to the scheduler', () => {
    // 'c' and 'd' are the queue; 't' is a task the scheduler holds and would
    // otherwise be on no page they can open
    expect(pageCards('scheduler', rows, scheduler, { isAsset: asset }).map(c => c.id)).toEqual(['c', 'd', 't'])
    // …and Draft appears on their board while that task sits there
    expect(pageColumns('scheduler', scheduler, rows)).toEqual(BOARD_COLUMNS.map(c => c.key))
    expect(pageColumns('scheduler', scheduler, [])).toEqual(BOARD_COLUMNS.map(c => c.key))
  })

  it('a tagged question counts as assignment', () => {
    expect(isAssignedTo(card({ owner_id: 'x', my_open_task: true }), 'ed')).toBe(true)
    expect(isAssignedTo(card({ owner_id: 'x', scheduler_ids: ['ed'] }), 'ed')).toBe(true)
    expect(isAssignedTo(card({ owner_id: 'x' }), 'ed')).toBe(false)
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
