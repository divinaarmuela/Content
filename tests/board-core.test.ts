import { describe, expect, it } from 'vitest'
import {
  ALL_STATUSES, BOARD_COLUMNS, boardColumn, canMoveTo, columnOf, columnsForRole,
  groupByColumn, reachableColumns, statusesIn, type BoardColumnKey,
} from '../app/lib/board-core'
import {
  actingRoles, availableTransitionsAs, ITEM_STATUSES, TRANSITIONS, type ItemStatus,
} from '../app/lib/workflow-core'
import type { Role } from '../app/lib/identity-core'

/**
 * The five columns are a PRESENTATION of the nine statuses. Every rule about
 * moving a card comes from workflow-core; this file proves the columns never
 * disagree with it, and that every surface reading them gets the same answer.
 */

const KEYS: BoardColumnKey[] = ['draft', 'internal_check', 'with_client', 'ready_to_post', 'posted']

describe('the five columns', () => {
  it('are exactly five, in board order, with plain labels and one-line meanings', () => {
    expect(BOARD_COLUMNS.map(c => c.key)).toEqual(KEYS)
    expect(BOARD_COLUMNS.map(c => c.label)).toEqual([
      'Draft', 'Internal check', 'With client', 'Ready to post', 'Posted',
    ])
    for (const c of BOARD_COLUMNS) {
      expect(c.meaning.length).toBeGreaterThan(10)
      expect(c.meaning.split('\n')).toHaveLength(1)
      // never the raw database word
      expect(c.label).not.toMatch(/_/)
      expect(c.meaning).not.toMatch(/_/)
    }
  })

  it('hold the statuses the owner named', () => {
    expect(statusesIn('draft')).toEqual(['draft_uploaded'])
    expect(statusesIn('internal_check')).toEqual(['internal_review', 'revision_required', 'revision_complete'])
    expect(statusesIn('with_client')).toEqual(['client_review', 'client_changes_requested'])
    expect(statusesIn('ready_to_post')).toEqual(['approved_for_scheduling'])
    expect(statusesIn('posted')).toEqual(['scheduled', 'published'])
  })

  it('every ItemStatus belongs to exactly one column', () => {
    const seen = new Map<ItemStatus, BoardColumnKey[]>()
    for (const c of BOARD_COLUMNS) {
      for (const s of c.statuses) seen.set(s, [...(seen.get(s) ?? []), c.key])
    }
    for (const s of ITEM_STATUSES) {
      expect(seen.get(s), s).toHaveLength(1)
      expect(columnOf(s)).toBe(seen.get(s)![0])
    }
    // and nothing in a column that is not a status
    expect([...seen.keys()].sort()).toEqual([...ITEM_STATUSES].sort())
    expect(ALL_STATUSES).toEqual(ITEM_STATUSES)
  })

  it('statusesIn and columnOf are inverses', () => {
    for (const k of KEYS) for (const s of statusesIn(k)) expect(columnOf(s)).toBe(k)
    expect(boardColumn('posted').label).toBe('Posted')
  })
})

describe('columnsForRole — the same board, a different lens', () => {
  it('an editor sees Draft through With client', () => {
    expect(columnsForRole('editor')).toEqual(['draft', 'internal_check', 'with_client'])
  })
  it('a scheduler sees Ready to post and Posted', () => {
    expect(columnsForRole('scheduler')).toEqual(['ready_to_post', 'posted'])
  })
  it('account managers and super admins see all five', () => {
    expect(columnsForRole('account_manager')).toEqual(KEYS)
    expect(columnsForRole('super_admin')).toEqual(KEYS)
  })
  it('a client is shown With client — the portal — and an unknown role nothing', () => {
    expect(columnsForRole('client')).toEqual(['with_client'])
    expect(columnsForRole(null)).toEqual([])
  })
  it('every role sees columns in board order', () => {
    for (const role of ['editor', 'scheduler', 'account_manager', 'super_admin'] as Role[]) {
      const cols = columnsForRole(role)
      expect(cols).toEqual(KEYS.filter(k => cols.includes(k)))
    }
  })
})

describe('groupByColumn', () => {
  const cards = [
    { id: 'a', status: 'draft_uploaded' },
    { id: 'b', status: 'published' },
    { id: 'c', status: 'revision_required' },
    { id: 'd', status: 'draft_uploaded' },
  ]
  it('puts every card in its column, keeps order, and lists empty columns', () => {
    const g = groupByColumn(cards)
    expect(g.map(x => x.column.key)).toEqual(KEYS)
    expect(g[0].cards.map(c => c.id)).toEqual(['a', 'd'])
    expect(g[1].cards.map(c => c.id)).toEqual(['c'])
    expect(g[2].cards).toEqual([])
    expect(g[4].cards.map(c => c.id)).toEqual(['b'])
  })
  it('limits itself to the columns a role sees', () => {
    const g = groupByColumn(cards, columnsForRole('scheduler'))
    expect(g.map(x => x.column.key)).toEqual(['ready_to_post', 'posted'])
    expect(g[1].cards.map(c => c.id)).toEqual(['b'])
  })
})

describe('canMoveTo — a drag may do nothing a button could not', () => {
  const AM: Role[] = ['account_manager']
  const ED: Role[] = ['editor']
  const SC: Role[] = ['scheduler']
  const SA: Role[] = ['super_admin']

  it('an editor hands a draft on for checking', () => {
    expect(canMoveTo({ status: 'draft_uploaded' }, 'internal_check', ED))
      .toEqual({ ok: true, to: 'internal_review', label: 'Submit for review' })
  })

  it('an editor cannot send work to the client', () => {
    const d = canMoveTo({ status: 'internal_review' }, 'with_client', ED)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe('editor may not perform "Send to client"')
  })

  it('a manager dropping on With client sends it to the client', () => {
    expect(canMoveTo({ status: 'internal_review' }, 'with_client', AM))
      .toEqual({ ok: true, to: 'client_review', label: 'Send to client' })
  })

  it('a multi-status column is entered at the FIRST status the person may reach', () => {
    // from With client (changes requested), the manager holds one edge into
    // Internal check: revision_required. internal_review is skipped.
    expect(canMoveTo({ status: 'client_changes_requested' }, 'internal_check', AM))
      .toEqual({ ok: true, to: 'revision_required', label: 'Send for revision' })
    // from Draft an editor reaches internal_review, the first status
    expect(canMoveTo({ status: 'draft_uploaded' }, 'internal_check', ED).ok).toBe(true)
  })

  it('an editor who finished revisions lands on "Revisions done"', () => {
    // revision_required → revision_complete is within Internal check, so a
    // drag cannot express it (same column) — that stays a button
    const d = canMoveTo({ status: 'revision_required' }, 'internal_check', ED)
    expect(d).toEqual({ ok: false, reason: 'Already in Internal check' })
  })

  it('a scheduler books a ready card in, and cannot pull it back', () => {
    expect(canMoveTo({ status: 'approved_for_scheduling' }, 'posted', SC))
      .toEqual({ ok: true, to: 'scheduled', label: 'Mark scheduled' })
    const back = canMoveTo({ status: 'approved_for_scheduling' }, 'with_client', SC)
    expect(back.ok).toBe(false)
  })

  it('never offers the app\'s own automatic moves — not even to a super admin', () => {
    // client_review → internal_review is `auto`
    const d = canMoveTo({ status: 'client_review' }, 'internal_check', SA)
    expect(d.ok).toBe(false)
    // approved_for_scheduling → client_review is `auto` too
    expect(canMoveTo({ status: 'approved_for_scheduling' }, 'with_client', SA).ok).toBe(false)
  })

  it('a super admin may make any defined, non-automatic move', () => {
    expect(canMoveTo({ status: 'internal_review' }, 'ready_to_post', SA))
      .toEqual({ ok: true, to: 'approved_for_scheduling', label: 'Approve without client' })
  })

  it('refuses a column with no way in, in plain words', () => {
    const d = canMoveTo({ status: 'published' }, 'draft', AM)
    expect(d).toEqual({ ok: false, reason: 'Nothing moves from Published to Draft' })
    const skip = canMoveTo({ status: 'draft_uploaded' }, 'posted', AM)
    expect(skip).toEqual({ ok: false, reason: 'Nothing moves from Drafting to Posted' })
  })

  it('with no hats at all, nothing moves', () => {
    for (const s of ITEM_STATUSES) for (const k of KEYS) {
      expect(canMoveTo({ status: s }, k, []).ok).toBe(false)
    }
  })

  it('agrees with availableTransitionsAs on every status, column and hat set', () => {
    const hatSets: Role[][] = [AM, ED, SC, SA, ['client'], ['editor', 'scheduler'], ['account_manager', 'editor']]
    for (const hats of hatSets) for (const from of ITEM_STATUSES) for (const k of KEYS) {
      const d = canMoveTo({ status: from }, k, hats)
      const offered = availableTransitionsAs(hats, from).map(o => o.to)
      const intoColumn = statusesIn(k).filter(s => offered.includes(s))
      if (columnOf(from) === k) {
        expect(d.ok, `${hats}/${from}→${k}`).toBe(false)
      } else if (intoColumn.length > 0) {
        expect(d, `${hats}/${from}→${k}`).toMatchObject({ ok: true, to: intoColumn[0] })
      } else {
        expect(d.ok, `${hats}/${from}→${k}`).toBe(false)
      }
    }
  })

  it('every legal, non-automatic edge between columns is reachable by SOME hat', () => {
    for (const from of ITEM_STATUSES) {
      for (const [to, rule] of Object.entries(TRANSITIONS[from] ?? {}) as [ItemStatus, { roles: Role[]; auto?: true }][]) {
        if (rule.auto || columnOf(from) === columnOf(to)) continue
        const d = canMoveTo({ status: from }, columnOf(to), rule.roles)
        expect(d.ok, `${from}→${to}`).toBe(true)
      }
    }
  })

  it('reads hats the way the item page does — through actingRoles', () => {
    const me = { id: 'u1', role: 'editor' as const }
    const mine = { status: 'draft_uploaded' as const, owner_id: 'u1' }
    const theirs = { status: 'draft_uploaded' as const, owner_id: 'u2' }
    expect(canMoveTo(mine, 'internal_check', actingRoles(me, mine)).ok).toBe(true)
    expect(canMoveTo(theirs, 'internal_check', actingRoles(me, theirs)).ok).toBe(false)
  })

  it('reachableColumns lists where a drag may land', () => {
    expect(reachableColumns({ status: 'internal_review' }, AM).map(r => r.column))
      .toEqual(['ready_to_post', 'with_client'].sort((a, b) => KEYS.indexOf(a as BoardColumnKey) - KEYS.indexOf(b as BoardColumnKey)))
    expect(reachableColumns({ status: 'published' }, SA)).toEqual([])
  })
})
