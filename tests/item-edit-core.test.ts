import { describe, it, expect } from 'vitest'
import {
  canEditItemFields, roleMayCreateItems, taskExemptFromClientScope,
} from '../app/lib/item-edit-core'
import type { Role } from '../app/lib/identity-core'

describe('roleMayCreateItems — every team role creates, clients never', () => {
  it.each(['editor', 'scheduler', 'account_manager', 'super_admin'] as Role[])('%s may create', role => {
    expect(roleMayCreateItems(role)).toBe(true)
  })
  it('a client may not', () => {
    expect(roleMayCreateItems('client')).toBe(false)
  })
})

describe('canEditItemFields — managers edit anything, others edit their own', () => {
  const item = { owner_id: 'owner-1', scheduler_ids: ['sched-1'] }

  it('AM and super admin edit anything', () => {
    expect(canEditItemFields({ id: 'x', role: 'account_manager' }, item)).toBe(true)
    expect(canEditItemFields({ id: 'x', role: 'super_admin' }, item)).toBe(true)
  })

  it('the owner edits their own, whatever their title', () => {
    expect(canEditItemFields({ id: 'owner-1', role: 'editor' }, item)).toBe(true)
    expect(canEditItemFields({ id: 'owner-1', role: 'scheduler' }, item)).toBe(true)
  })

  it('anyone handed the scheduling edits it too', () => {
    expect(canEditItemFields({ id: 'sched-1', role: 'scheduler' }, item)).toBe(true)
    expect(canEditItemFields({ id: 'sched-1', role: 'editor' }, item)).toBe(true)
  })

  it('holding nothing on the item edits nothing', () => {
    expect(canEditItemFields({ id: 'stranger', role: 'editor' }, item)).toBe(false)
    expect(canEditItemFields({ id: 'stranger', role: 'scheduler' }, item)).toBe(false)
  })

  it('clients never edit', () => {
    expect(canEditItemFields({ id: 'owner-1', role: 'client' }, item)).toBe(false)
  })
})

describe('taskExemptFromClientScope — tasks are internal, not client-confidential', () => {
  it('a no-media kind that is not a shoot plan is exempt', () => {
    expect(taskExemptFromClientScope({ slug: 'research', uses_media: false })).toBe(true)
  })
  it('assets and shoot plans keep the scoped client list', () => {
    expect(taskExemptFromClientScope({ slug: 'edit', uses_media: true })).toBe(false)
    expect(taskExemptFromClientScope({ slug: 'shoot_brief', uses_media: false })).toBe(false)
    expect(taskExemptFromClientScope(null)).toBe(false)
  })
})
