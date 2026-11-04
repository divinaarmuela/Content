import { describe, it, expect } from 'vitest'
import { archivedReason } from '../app/lib/mailer-core'

describe('done is done: no notifications (4 Nov 2026)', () => {
  it('a card marked done sends nothing', () => {
    expect(archivedReason([{ __table: 'content_items', done_at: '2026-11-04T08:00:00Z' }])).toBe('card marked done')
  })
  it('a shoot marked done sends nothing', () => {
    expect(archivedReason([{ __table: 'batches', status: 'wrapped' }])).toBe('shoot done')
  })
  it('a finished to-do (also has done_at) is not muted by this rule', () => {
    expect(archivedReason([{ __table: 'todos', done_at: '2026-11-04T08:00:00Z' }])).toBeNull()
  })
  it('a card not done still sends', () => {
    expect(archivedReason([{ __table: 'content_items', done_at: null }])).toBeNull()
  })
})
