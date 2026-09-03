import { describe, expect, it } from 'vitest'
import {
  availableBatchTransitions, batchSatisfiesLock, canCreateItemsUnder,
  checkBatchTransition, isInProduction, shootDeletion,
} from '../app/lib/batch-brief-core'
import type { Role } from '../app/lib/identity-core'

describe('checkBatchTransition', () => {
  it('lets an editor lock and mark shot, but not unlock or wrap', () => {
    expect(checkBatchTransition('editor', 'brief', 'locked').ok).toBe(true)
    expect(checkBatchTransition('editor', 'locked', 'shot').ok).toBe(true)
    expect(checkBatchTransition('editor', 'locked', 'brief').ok).toBe(false)
    expect(checkBatchTransition('editor', 'locked', 'wrapped').ok).toBe(false)
  })

  it('reserves unlock and wrap for account managers, super admin passes all', () => {
    expect(checkBatchTransition('account_manager', 'locked', 'brief').ok).toBe(true)
    expect(checkBatchTransition('account_manager', 'shot', 'wrapped').ok).toBe(true)
    expect(checkBatchTransition('super_admin', 'locked', 'brief').ok).toBe(true)
    expect(checkBatchTransition('scheduler', 'brief', 'locked').ok).toBe(false)
  })

  it('rejects impossible edges outright', () => {
    expect(checkBatchTransition('super_admin', 'brief', 'shot').ok).toBe(false)
    expect(checkBatchTransition('super_admin', 'wrapped', 'brief').ok).toBe(false)
    expect(checkBatchTransition('super_admin', 'brief', 'wrapped').ok).toBe(false)
  })
})

describe('availableBatchTransitions', () => {
  it('renders exactly the buttons each role may press', () => {
    expect(availableBatchTransitions('editor', 'brief').map(t => t.to)).toEqual(['locked'])
    expect(availableBatchTransitions('account_manager', 'locked').map(t => t.to).sort())
      .toEqual(['brief', 'shot', 'wrapped'])
    expect(availableBatchTransitions('scheduler', 'brief')).toEqual([])
    expect(availableBatchTransitions('editor', 'wrapped')).toEqual([])
  })
})

describe('batchSatisfiesLock', () => {
  it('needs a title and a real date', () => {
    expect(batchSatisfiesLock({ title: 'Sept studio day', shoot_date: '2026-09-12' })).toBe(true)
    expect(batchSatisfiesLock({ title: 'Sept studio day', shoot_date: null })).toBe(false)
    expect(batchSatisfiesLock({ title: 'Sept studio day', shoot_date: 'not a date' })).toBe(false)
    expect(batchSatisfiesLock({ title: '  ', shoot_date: '2026-09-12' })).toBe(false)
  })
})

describe('canCreateItemsUnder — the production gate', () => {
  const roles: Role[] = ['scheduler', 'editor', 'account_manager', 'super_admin']

  it('opens locked and shot briefs to every team role — never a client', () => {
    // the owner's rule: "scheduler/editor can create production items too"
    for (const status of ['locked', 'shot'] as const) {
      expect(canCreateItemsUnder(status, 'editor')).toBe(true)
      expect(canCreateItemsUnder(status, 'account_manager')).toBe(true)
      expect(canCreateItemsUnder(status, 'super_admin')).toBe(true)
      expect(canCreateItemsUnder(status, 'scheduler')).toBe(true)
      expect(canCreateItemsUnder(status, 'client')).toBe(false)
    }
  })

  it('keeps a wrapped shoot open — late edits count toward their live month', () => {
    expect(canCreateItemsUnder('wrapped', 'editor')).toBe(true)
    expect(canCreateItemsUnder('wrapped', 'account_manager')).toBe(true)
  })

  it('keeps a shoot still being planned closed to everyone', () => {
    for (const status of ['brief'] as const) {
      for (const role of roles) {
        expect(canCreateItemsUnder(status, role)).toBe(false)
      }
    }
  })

  it('lets anyone on the team raise a brief task against a shoot that is not finished', () => {
    // a locked shoot with no brief is the exact case that used to build a
    // SECOND shoot instead of joining the one already there
    for (const status of [null, 'brief', 'locked', 'shot'] as const) {
      for (const role of ['scheduler', 'editor', 'account_manager', 'super_admin'] as const) {
        expect(canCreateItemsUnder(status, role, undefined, 'shoot_brief'), role).toBe(true)
      }
    }
  })

  it('still refuses a plan on a finished shoot, and refuses a client outright', () => {
    // a wrapped shoot is done; nobody raises a plan for it, whatever their role
    for (const role of ['scheduler', 'editor', 'account_manager', 'super_admin'] as const) {
      expect(canCreateItemsUnder('wrapped', role, undefined, 'shoot_brief'), role).toBe(false)
    }
    // a client never creates anything — the one line that did not change
    for (const status of [null, 'brief', 'locked', 'wrapped'] as const) {
      expect(canCreateItemsUnder(status, 'client', undefined, 'shoot_brief')).toBe(false)
    }
  })

  it('batchless items need a stated reason from everyone — supers included', () => {
    // the reason is the whole gate: it is what answers "why is there no
    // shoot?" months later. No role is exempt from it.
    expect(canCreateItemsUnder(null, 'account_manager')).toBe(false)
    expect(canCreateItemsUnder(null, 'account_manager', { reason: '   ' })).toBe(false)
    expect(canCreateItemsUnder(null, 'account_manager', { reason: 'client emergency post' })).toBe(true)
    expect(canCreateItemsUnder(null, 'super_admin')).toBe(false)
    expect(canCreateItemsUnder(null, 'super_admin', { reason: 'launch-day extra' })).toBe(true)
  })

  it('lets an EDITOR create work with no shoot, given the reason', () => {
    // footage arrives without a shoot all the time — the client sends phone
    // footage, an old shoot supplies the raws — and the editor is who has it.
    // Requiring a manager meant either a fake shoot brief or no item at all.
    expect(canCreateItemsUnder(null, 'editor', { reason: 'client sent phone footage via WeTransfer' })).toBe(true)
    expect(canCreateItemsUnder(null, 'editor')).toBe(false)
    expect(canCreateItemsUnder(null, 'editor', { reason: '  ' })).toBe(false)
  })

  it('opens the no-shoot path to schedulers too — with the same mandatory reason', () => {
    expect(canCreateItemsUnder(null, 'scheduler', { reason: 'client emergency story' })).toBe(true)
    expect(canCreateItemsUnder(null, 'scheduler')).toBe(false)
  })

  it('still keeps clients out — they never create work', () => {
    expect(canCreateItemsUnder(null, 'client', { reason: 'anything' })).toBe(false)
  })
})

describe('sanitisers', () => {
  it('shot list: keeps real rows, drops blanks, caps junk, mints missing ids', async () => {
    const { sanitiseShotList } = await import('../app/lib/batch-brief-core')
    const rows = sanitiseShotList([
      { id: 's1', text: 'Hero pour shot', type: 'reel', qty: 2, done: true },
      { text: '   ' },
      { text: 'B-roll hands', qty: -3 },
      'junk', null,
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ id: 's1', text: 'Hero pour shot', type: 'reel', qty: 2, done: true })
    expect(rows[1].id).toBeTruthy()
    expect(rows[1]).not.toHaveProperty('qty')
    expect(rows[1].done).toBe(false)
  })

  it('planned deliverables: positive integer quantities only', async () => {
    const { sanitisePlannedDeliverables } = await import('../app/lib/batch-brief-core')
    expect(sanitisePlannedDeliverables([
      { type: 'static', qty: 8 }, { type: 'reel', qty: 0 }, { type: '', qty: 3 }, { type: 'video', qty: 2.5 },
    ])).toEqual([{ type: 'static', qty: 8 }])
  })

  it('reference media: https only, kind defaults to image', async () => {
    const { sanitiseReferenceMedia } = await import('../app/lib/batch-brief-core')
    expect(sanitiseReferenceMedia([
      { kind: 'link', url: 'https://milanote.com/board', name: 'Moodboard' },
      { url: 'https://cdn.example.com/ref.jpg' },
      { url: 'javascript:alert(1)' },
      { url: 'http://insecure.example.com/x.png' },
    ])).toEqual([
      { kind: 'link', url: 'https://milanote.com/board', name: 'Moodboard' },
      { kind: 'image', url: 'https://cdn.example.com/ref.jpg' },
    ])
  })
})

describe('canvas cards', () => {
  it('sanitiser drops bad kinds, non-https media, and non-finite coords; clamps and dedupes', async () => {
    const { sanitiseCanvasCards } = await import('../app/lib/batch-brief-core')
    const cards = sanitiseCanvasCards([
      { id: 'a', kind: 'note', x: 10.6, y: -99999, text: 'hi', color: 'yellow' },
      { id: 'a', kind: 'note', x: 5, y: 5, text: 'kept-last' },
      { id: 'b', kind: 'image', x: 0, y: 0, url: 'http://insecure.co/x.jpg' },
      { id: 'c', kind: 'link', x: 0, y: 0, url: 'https://ok.co', w: 9999 },
      { id: 'd', kind: 'wormhole', x: 0, y: 0 },
      { id: 'e', kind: 'note', x: Infinity, y: 0 },
    ])
    expect(cards.map(c => c.id)).toEqual(['a', 'c'])
    expect(cards[0]).toMatchObject({ text: 'kept-last', x: 5 })
    expect(cards[1].w).toBe(1200)
  })

  it('applyCanvasOp merges upserts by id then applies removes', async () => {
    const { applyCanvasOp } = await import('../app/lib/batch-brief-core')
    const current = [
      { id: 'a', kind: 'note', x: 0, y: 0, text: 'old' },
      { id: 'b', kind: 'note', x: 1, y: 1, text: 'stays' },
    ]
    const next = applyCanvasOp(current, {
      upsert: [{ id: 'a', kind: 'note', x: 50, y: 50, text: 'moved' }, { id: 'c', kind: 'label', x: 0, y: 0, text: 'NEW' }],
      remove: ['b', 'c'], // remove wins even over a same-op upsert
    })
    expect(next.map(c => c.id).sort()).toEqual(['a'])
    expect(next[0]).toMatchObject({ x: 50, text: 'moved' })
  })

  it('seeding is deterministic and lays references into columns', async () => {
    const { seedCardsFromReferences } = await import('../app/lib/batch-brief-core')
    const refs = [
      { kind: 'image' as const, url: 'https://cdn.co/a.jpg', name: 'a.jpg' },
      { kind: 'link' as const, url: 'https://milanote.com/b' },
    ]
    const one = seedCardsFromReferences(refs)
    const two = seedCardsFromReferences(refs)
    expect(one).toEqual(two)
    expect(one[0]).toMatchObject({ id: 'seed-label', kind: 'label', text: 'REFERENCES' })
    expect(one.slice(1).map(c => c.kind)).toEqual(['image', 'link'])
    expect(seedCardsFromReferences([])).toEqual([])
  })
})

describe('mockup cards', () => {
  it('keeps valid platforms, drops invented ones, allows an empty frame', async () => {
    const { sanitiseCanvasCards } = await import('../app/lib/batch-brief-core')
    const cards = sanitiseCanvasCards([
      { id: 'm1', kind: 'mockup', x: 0, y: 0, platform: 'ig_reel', url: 'https://cdn.co/v.jpg' },
      { id: 'm2', kind: 'mockup', x: 0, y: 0, platform: 'ig_post' },
      { id: 'm3', kind: 'mockup', x: 0, y: 0, platform: 'myspace' },
    ])
    expect(cards.map(c => c.id)).toEqual(['m1', 'm2'])
    expect(cards[0].platform).toBe('ig_reel')
    expect(cards[0].url).toBe('https://cdn.co/v.jpg')
    expect(cards[1].url).toBeUndefined()
  })

  it('accepts the newer platforms', async () => {
    const { sanitiseCanvasCards } = await import('../app/lib/batch-brief-core')
    const cards = sanitiseCanvasCards(
      ['youtube', 'yt_short', 'tiktok', 'facebook'].map((platform, i) =>
        ({ id: `p${i}`, kind: 'mockup', x: 0, y: 0, platform })),
    )
    expect(cards.map(c => c.platform)).toEqual(['youtube', 'yt_short', 'tiktok', 'facebook'])
  })
})

describe('todo cards', () => {
  it('sanitises rows: caps, coerces, and mints missing ids', async () => {
    const { sanitiseCanvasCards } = await import('../app/lib/batch-brief-core')
    const [card] = sanitiseCanvasCards([{
      id: 't1', kind: 'todo', x: 0, y: 0,
      items: [
        { id: 'a', text: 'shoot the hero image', done: true },
        { text: 'x'.repeat(500), done: 'yes' }, // no id, over-long, truthy-but-not-true
        ...Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, text: `t${i}`, done: false })),
      ],
    }])
    expect(card.kind).toBe('todo')
    expect(card.items).toHaveLength(30)
    expect(card.items?.[0]).toEqual({ id: 'a', text: 'shoot the hero image', done: true })
    expect(card.items?.[1].id).toBeTruthy()
    expect(card.items?.[1].text).toHaveLength(200)
    expect(card.items?.[1].done).toBe(false)
  })

  it('a todo without items still stands, with an empty list', async () => {
    const { sanitiseCanvasCards } = await import('../app/lib/batch-brief-core')
    const [card] = sanitiseCanvasCards([{ id: 't2', kind: 'todo', x: 0, y: 0 }])
    expect(card).toMatchObject({ kind: 'todo', items: [] })
  })
})

describe('canvas arrows', () => {
  it('sanitiser keeps well-formed arrows and drops self-loops or missing ends', async () => {
    const { sanitiseCanvasCards } = await import('../app/lib/batch-brief-core')
    const cards = sanitiseCanvasCards([
      { id: 'n1', kind: 'note', x: 0, y: 0, text: 'a' },
      { id: 'n2', kind: 'note', x: 100, y: 0, text: 'b' },
      { id: 'e1', kind: 'arrow', x: 0, y: 0, from: 'n1', to: 'n2' },
      { id: 'e2', kind: 'arrow', x: 0, y: 0, from: 'n1', to: 'n1' },
      { id: 'e3', kind: 'arrow', x: 0, y: 0, from: 'n1' },
    ])
    expect(cards.map(c => c.id)).toEqual(['n1', 'n2', 'e1'])
    expect(cards[2]).toMatchObject({ from: 'n1', to: 'n2' })
  })

  it('deleting a card prunes its arrows in the same op', async () => {
    const { applyCanvasOp } = await import('../app/lib/batch-brief-core')
    const current = [
      { id: 'n1', kind: 'note', x: 0, y: 0, text: 'a' },
      { id: 'n2', kind: 'note', x: 1, y: 1, text: 'b' },
      { id: 'e1', kind: 'arrow', x: 0, y: 0, from: 'n1', to: 'n2' },
    ]
    const next = applyCanvasOp(current, { remove: ['n2'] })
    expect(next.map(c => c.id)).toEqual(['n1'])
  })
})

describe('isInProduction', () => {
  it('means a locked/shot brief with items actually under way', () => {
    expect(isInProduction({ status: 'locked' }, 3)).toBe(true)
    expect(isInProduction({ status: 'locked' }, 0)).toBe(false)
    expect(isInProduction({ status: 'brief' }, 3)).toBe(false)
    expect(isInProduction({ status: 'wrapped' }, 3)).toBe(false)
  })
})

describe('deleting a shoot keeps the work that came out of it', () => {
  // it used to refuse the moment the shoot had ANY item — and a shoot plan is
  // itself an item, so a shoot booked by mistake became permanent as soon as
  // somebody described it. The task quota card already had the right answer:
  // detach the pieces, then delete the promise.
  it('allows an empty shoot and says nothing else changes', () => {
    const v = shootDeletion([])
    expect(v.allowed).toBe(true)
    if (!v.allowed) return
    expect(v.detaching).toBe(0)
    expect(v.consequence).toMatch(/nothing else changes/i)
  })

  it('allows a shoot that has a plan and work under it, and keeps them', () => {
    const v = shootDeletion([
      { status: 'draft_uploaded' },
      { status: 'internal_review' },
      { status: 'client_review' },
      { status: 'approved_for_scheduling' },
    ])
    expect(v.allowed).toBe(true)
    if (!v.allowed) return
    expect(v.detaching).toBe(4)
    expect(v.consequence).toMatch(/4 pieces are kept/)
    expect(v.consequence).toMatch(/their own cards/)
  })

  it('counts one piece in the singular, because four words of grammar is not too much to ask', () => {
    const v = shootDeletion([{ status: 'draft_uploaded' }])
    expect(v.allowed).toBe(true)
    if (!v.allowed) return
    expect(v.consequence).toMatch(/its one piece is kept/i)
    expect(v.consequence).toMatch(/its own card/)
  })

  it('refuses once anything is scheduled or live — that is what wrapping is for', () => {
    for (const status of ['scheduled', 'published']) {
      const v = shootDeletion([{ status: 'draft_uploaded' }, { status }])
      expect(v.allowed, status).toBe(false)
      if (v.allowed) return
      expect(v.reason).toMatch(/wrap the shoot instead/i)
    }
  })

  it('counts how many are live so the refusal is specific', () => {
    const v = shootDeletion([{ status: 'published' }, { status: 'scheduled' }])
    expect(v.allowed).toBe(false)
    if (v.allowed) return
    expect(v.reason).toMatch(/^2 pieces/)
  })

  it('a piece the client is still changing is not live — it can still be deleted', () => {
    // the stop is work that has left the building, not work in progress
    const v = shootDeletion([{ status: 'client_changes_requested' }, { status: 'revision_required' }])
    expect(v.allowed).toBe(true)
  })
})
