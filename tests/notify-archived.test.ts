import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { archivedReason } from '../app/lib/mailer-core'

// Karly, 28 Oct 2026: six cards she archived kept emailing her "Overdue" every morning
describe('nothing archived is emailed about', () => {
  it('an archived card, a post on one, an archived client', () => {
    expect(archivedReason([{ id: 'c', archived_at: '2026-10-20T04:25:01Z' }])).toBe('archived')
    expect(archivedReason([{ id: 'p', status: 'booked' }, { id: 'c', archived_at: '2026-10-27T03:07:53Z' }])).toBe('archived')
    expect(archivedReason([{ id: 'c' }], { status: 'archived' })).toBe('client archived')
    expect(archivedReason([{ id: 'c', status: 'archived' }])).toBe('archived')
  })
  it('live work still goes', () => {
    expect(archivedReason([{ id: 'c', archived_at: null, status: 'draft_uploaded' }], { status: 'active' })).toBeNull()
    expect(archivedReason([], { status: 'paused' })).toBeNull()
    expect(archivedReason([])).toBeNull()
  })
  it('the one door every email goes through asks, before anything is logged or sent', () => {
    const s = readFileSync('app/lib/mailer.ts', 'utf8')
    const body = s.slice(s.indexOf('export async function notify('))
    const guard = body.indexOf('await archivedSubject(input, aboutClient)')
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(body.indexOf("table('notification_log').insert("))
  })
  it('the due reminders never pick an archived card', () => {
    const s = readFileSync('app/lib/due-reminders.ts', 'utf8')
    expect(s).toContain('r.due_date <= tomorrow && !r.archived_at')
    expect(s).toContain('stuckIds.includes(r.id) && !r.archived_at')
  })
})
