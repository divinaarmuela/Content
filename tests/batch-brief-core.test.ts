import { describe, expect, it } from 'vitest'
import {
  availableBatchTransitions, batchSatisfiesLock, canCreateItemsUnder,
  checkBatchTransition, isInProduction,
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

  it('opens locked and shot briefs to item-creating roles only', () => {
    for (const status of ['locked', 'shot'] as const) {
      expect(canCreateItemsUnder(status, 'editor')).toBe(true)
      expect(canCreateItemsUnder(status, 'account_manager')).toBe(true)
      expect(canCreateItemsUnder(status, 'super_admin')).toBe(true)
      expect(canCreateItemsUnder(status, 'scheduler')).toBe(false)
      expect(canCreateItemsUnder(status, 'client')).toBe(false)
    }
  })

  it('keeps brief and wrapped shoots closed to everyone', () => {
    for (const status of ['brief', 'wrapped'] as const) {
      for (const role of roles) {
        expect(canCreateItemsUnder(status, role)).toBe(false)
      }
    }
  })

  it('batchless items need an AM+ with a stated reason — supers included', () => {
    expect(canCreateItemsUnder(null, 'editor', { reason: 'urgent' })).toBe(false)
    expect(canCreateItemsUnder(null, 'account_manager')).toBe(false)
    expect(canCreateItemsUnder(null, 'account_manager', { reason: '   ' })).toBe(false)
    expect(canCreateItemsUnder(null, 'account_manager', { reason: 'client emergency post' })).toBe(true)
    expect(canCreateItemsUnder(null, 'super_admin')).toBe(false)
    expect(canCreateItemsUnder(null, 'super_admin', { reason: 'launch-day extra' })).toBe(true)
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

describe('isInProduction', () => {
  it('means a locked/shot brief with items actually under way', () => {
    expect(isInProduction({ status: 'locked' }, 3)).toBe(true)
    expect(isInProduction({ status: 'locked' }, 0)).toBe(false)
    expect(isInProduction({ status: 'brief' }, 3)).toBe(false)
    expect(isInProduction({ status: 'wrapped' }, 3)).toBe(false)
  })
})
