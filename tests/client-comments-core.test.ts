import { describe, it, expect } from 'vitest'
import { clientCommentRows, mayReadClientComments } from '../app/lib/client-comments-core'

const posts = [
  { id: 'p1', client_id: 'c1', stage: 'draft', sent_version: 3, source_item_id: 'i1', client_review: { verdict: 'not_approved', note: 'Change FUND to BROKER', version: 3 } },
  { id: 'p2', client_id: 'c2', stage: 'booked', sent_version: 2, caption: 'Hello there\nmore', client_review: { verdict: 'approved', note: 'tiny fix', version: 2 } },
]
const comments = [
  { id: 'a', post_id: 'p1', author_role: 'client', author_name: 'Anthony', body: 'Change FUND to BROKER', created_at: '2026-11-12T04:58:00Z', version: 3 },
  { id: 'b', post_id: 'p2', author_role: 'client', author_name: 'Sam', body: 'tiny fix', created_at: '2026-11-12T05:10:00Z', version: 2 },
  { id: 'c', post_id: 'p2', author_role: 'client', author_name: 'Sam', body: 'older words', created_at: '2026-11-10T05:10:00Z', version: 1 },
  { id: 'd', post_id: 'p1', author_role: 'quality_checker', author_name: 'Joy', body: 'team note', created_at: '2026-11-12T06:00:00Z' },
]
const run = (allowed: Set<string> | null) => clientCommentRows({ comments, posts, allowed, clientName: id => ({ c1: 'Kode', c2: 'Capila' } as Record<string, string>)[id], itemTitle: () => '73' })

describe('the Comments view on Post approval (12 Nov 2026)', () => {
  it('lists only the clients own words, newest first, with what they answered', () => {
    const rows = run(null)
    expect(rows.map(r => r.id)).toEqual(['b', 'a', 'c'])
    expect(rows[0]).toMatchObject({ client: 'Capila', title: 'Hello there', answer: 'approved', earlier_version: false })
    expect(rows[1]).toMatchObject({ client: 'Kode', title: '73', answer: 'not_approved', author: 'Anthony' })
    expect(rows[2]).toMatchObject({ answer: null, earlier_version: true })
  })
  it('a person sees only their own clients', () => {
    expect(run(new Set(['c1'])).map(r => r.id)).toEqual(['a'])
  })
  it('is for account managers, quality checkers and super admins', () => {
    expect(mayReadClientComments({ role: 'super_admin' })).toBe(true)
    expect(mayReadClientComments({ role: 'account_manager' })).toBe(true)
    expect(mayReadClientComments({ role: 'quality_checker' })).toBe(true)
    expect(mayReadClientComments({ role: 'editor', quality_reviewer: true })).toBe(true)
    expect(mayReadClientComments({ role: 'editor' })).toBe(false)
    expect(mayReadClientComments({ role: 'scheduler' })).toBe(false)
  })
})
