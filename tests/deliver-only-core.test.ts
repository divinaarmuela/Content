import { describe, expect, it } from 'vitest'
import {
  DELIVER_ONLY_REASON, DELIVERED_LINE, deliverOnly, isDelivered,
} from '../app/lib/deliver-only-core'
import { stageWordFor, DELIVERED_STAGE_WORD } from '../app/lib/deliver-only-core'
import { cardColumn, BOARD_COLUMNS, columnOf, OUT_COLUMNS } from '../app/lib/board-core'
import {
  cardActions, cardLines, dropAction, groupByLane, pageCards, pageLanes, type BoardViewCard,
} from '../app/lib/board-view-core'
import { cardLine } from '../app/lib/portal-core'
import { scopeContextOf, visibleItems } from '../app/lib/scope-client'

/* ── the client posts their own content (the playbook's Bond Street) ── */

const SELF = { posts_own_content: true }
const US = { posts_own_content: false }

describe('deliverOnly — the card’s word, else the client’s', () => {
  it('follows the client when the card says nothing', () => {
    expect(deliverOnly({ deliver_only: null }, SELF)).toBe(true)
    expect(deliverOnly({}, US)).toBe(false)
    expect(deliverOnly({}, null)).toBe(false)
  })
  it('the card’s own word wins either way', () => {
    expect(deliverOnly({ deliver_only: false }, SELF)).toBe(false)
    expect(deliverOnly({ deliver_only: true }, US)).toBe(true)
  })
  it('is delivered once approved, and only then', () => {
    expect(isDelivered({ status: 'approved_for_scheduling' }, SELF)).toBe(true)
    expect(isDelivered({ status: 'client_review' }, SELF)).toBe(false)
    expect(isDelivered({ status: 'approved_for_scheduling' }, US)).toBe(false)
    // a file marked posted by hand moves the status on; it is read as before
    expect(isDelivered({ status: 'published' }, SELF)).toBe(false)
  })
})

const card = (over: Partial<BoardViewCard> = {}): BoardViewCard => ({
  id: 'c1', title: 'Menu reel', status: 'approved_for_scheduling', client_id: 'k',
  clients: { name: 'Bond Street', posts_own_content: true }, owner_id: 'ed', due_date: null,
  work_kinds: { name: 'Video edit', slug: 'video_edit' }, scheduler_ids: [], client_approval_required: true,
  ...over,
})

describe('the Delivered column', () => {
  it('exists, last, holds no status of its own, and is an out column', () => {
    const keys = BOARD_COLUMNS.map(c => c.key)
    expect(keys[keys.length - 1]).toBe('delivered')
    expect(BOARD_COLUMNS.find(c => c.key === 'delivered')!.statuses).toEqual([])
    expect(OUT_COLUMNS).toContain('delivered')
    // the status map is untouched: approved still means Ready to post by status
    expect(columnOf('approved_for_scheduling')).toBe('ready_to_post')
  })
  it('a deliver-only approved card sits in Delivered; everybody else where their status says', () => {
    expect(cardColumn(card())).toBe('delivered')
    expect(cardColumn(card({ clients: { name: 'Acme', posts_own_content: false } }))).toBe('ready_to_post')
    expect(cardColumn(card({ deliver_only: false }))).toBe('ready_to_post')
    expect(cardColumn(card({ status: 'client_review' }))).toBe('with_client')
    expect(cardColumn(card({ status: 'published' }))).toBe('posted')
  })
  it('groups by the card’s column, and the Editor page folds Delivered into Done', () => {
    const lanes = pageLanes('scheduler')
    const grouped = groupByLane(lanes, [card(), card({ id: 'c2', deliver_only: false })])
    expect(grouped.find(g => g.lane.key === 'delivered')!.cards.map(c => c.id)).toEqual(['c1'])
    expect(grouped.find(g => g.lane.key === 'ready_to_post')!.cards.map(c => c.id)).toEqual(['c2'])
    const editor = pageLanes('editor')
    expect(editor.find(l => l.key === 'done')!.columns).toContain('delivered')
  })
})

describe('what a deliver-only card offers and refuses', () => {
  const am = { id: 'am', role: 'account_manager' as const }
  const sch = { id: 'sch', role: 'scheduler' as const }
  it('never a Booked in or Posted button, and a drag there is refused in plain words', () => {
    const c = card({ scheduler_ids: ['sch'] })
    const all = [cardActions(c, am).primary, ...cardActions(c, am).more, cardActions(c, sch).primary, ...cardActions(c, sch).more]
    expect(all.some(a => a && a.kind === 'transition' && (a.to === 'scheduled' || a.to === 'published'))).toBe(false)
    // the scheduler handed it may move an ordinary card to Booked in; this one, never
    const d = dropAction(c, 'booked', sch)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe(DELIVER_ONLY_REASON)
  })
  it('wears the chip, and the words are the playbook’s', () => {
    expect(cardLines(card(), { today: '2026-09-11' }).deliverOnly).toBe(true)
    expect(cardLines(card({ deliver_only: false }), { today: '2026-09-11' }).deliverOnly).toBe(false)
    expect(DELIVERED_LINE).toMatch(/client posts this themselves/)
  })
  it('a scheduler never sees it on any page, even when handed it', () => {
    const c = card({ scheduler_ids: ['sch'] })
    expect(pageCards('scheduler', [c], sch, '2026-09-11')).toEqual([])
    expect(pageCards('scheduler', [c], am, '2026-09-11').map(x => x.id)).toEqual(['c1'])
    // …and the server’s scope agrees, from the card’s word or the client’s
    const items = [
      { id: 'a', client_id: 'k', status: 'approved_for_scheduling', owner_id: null, scheduler_ids: ['sch'], deliver_only: true },
      { id: 'b', client_id: 'bond', status: 'approved_for_scheduling', owner_id: null, scheduler_ids: ['sch'] },
      { id: 'c', client_id: 'acme', status: 'approved_for_scheduling', owner_id: null, scheduler_ids: ['sch'] },
    ]
    const ctx = scopeContextOf({ viewer: sch, clients: [{ id: 'bond', posts_own_content: true }, { id: 'acme', posts_own_content: false }] })
    expect(visibleItems(sch, items as never, [], ctx).map(i => i.id)).toEqual(['c'])
    // a manager still sees all three
    expect(visibleItems({ id: 'am', role: 'account_manager' }, items as never, [{ team_user_id: 'am', client_id: 'k' }, { team_user_id: 'am', client_id: 'bond' }, { team_user_id: 'am', client_id: 'acme' }], ctx).length).toBe(3)
  })
})

describe('the client’s own card', () => {
  it('says the finals are theirs to post', () => {
    expect(cardLine('approved_for_scheduling', { selfPosts: true })).toMatch(/yours to post/)
    expect(cardLine('approved_for_scheduling')).toMatch(/book a posting time/)
  })
})

/* ── what the live role-play of 11 Sep 2026 caught ── */

describe('a deliver-only client with a card already booked or out', () => {
  const opts = { today: '2026-09-11', viewerId: 'me' }
  const base = { id: 'x', client_id: 'k', title: 'B', owner_id: null, due_date: null, work_kinds: null, clients: { name: 'Acme', posts_own_content: true } }
  it('wears "Client posts it" only while the card is still ours to hand over', () => {
    expect(cardLines({ ...base, status: 'approved_for_scheduling' } as never, opts).deliverOnly).toBe(true)
    expect(cardLines({ ...base, status: 'scheduled' } as never, opts).deliverOnly).toBe(false)
    expect(cardLines({ ...base, status: 'published' } as never, opts).deliverOnly).toBe(false)
  })
  it('is "Delivered" in the emails at the approval, never "Ready to post"', () => {
    expect(stageWordFor('approved_for_scheduling', true, 'Ready to post')).toBe(DELIVERED_STAGE_WORD)
    expect(stageWordFor('approved_for_scheduling', false, 'Ready to post')).toBe('Ready to post')
    expect(stageWordFor('client_review', true, 'With client')).toBe('With client')
  })
})
