import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { canComment, cleanProposalComment, MAX_PROPOSAL_COMMENT, proposalComments } from '../app/lib/shoot-core'

// 30 Oct 2026, the owner, on a shoot date proposed to a client: "they should view it immediately mate and leave comments"

describe('a comment on a proposed shoot date', () => {
  it('is trimmed, never empty, never over the limit', () => {
    expect(cleanProposalComment('  Thursday instead?  ')).toBe('Thursday instead?')
    expect(cleanProposalComment('   ')).toBeNull()
    expect(cleanProposalComment(42)).toBeNull()
    expect(cleanProposalComment('x'.repeat(MAX_PROPOSAL_COMMENT + 50))).toHaveLength(MAX_PROPOSAL_COMMENT)
  })
  it('reads back oldest first, whatever shape the database handed back, and drops anything malformed', () => {
    const a = { id: 'a', at: '2026-10-30T01:00:00Z', body: 'first' }
    const b = { id: 'b', at: '2026-10-30T02:00:00Z', body: 'second' }
    expect(proposalComments([b, a]).map(c => c.id)).toEqual(['a', 'b'])
    expect(proposalComments({ 0: b, 1: a }).map(c => c.id)).toEqual(['a', 'b'])
    expect(proposalComments([a, { body: 5 }, null, 'x'])).toEqual([a])
    expect(proposalComments(null)).toEqual([])
  })
  it('is open in every state but called off', () => {
    expect(canComment('pending')).toBe(true)
    expect(canComment('accepted')).toBe(true)
    expect(canComment('declined')).toBe(true)
    expect(canComment('cancelled')).toBe(false)
  })
})

describe('where it is wired', () => {
  it('the answer card has the box, and the route takes a comment on the same token', () => {
    const card = readFileSync('app/shoot/[token]/ShootAnswer.tsx', 'utf8')
    expect(card).toContain("body: JSON.stringify({ comment: body })")
    expect(card).toContain('Anything to add?')
    const route = readFileSync('app/api/shoot/[token]/route.ts', 'utf8')
    expect(route).toContain('const said = await commentOnShoot(token, body.comment)')
  })
  it('appends in one claim and emails the team, silenced for a test client', () => {
    const lib = readFileSync('app/lib/shoots.ts', 'utf8')
    expect(lib).toContain("table<ShootProposalRow>('shoot_proposals').claim(found.id")
    expect(lib).toContain('clientId: proposal.client_id,')
  })
  it('a date waiting on the client is open on the Shoot brief tab, and the team reads the comments', () => {
    const portal = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
    expect(portal).toContain('<ShootAnswer key={p.id} inline token={p.token}')
    expect(readFileSync('app/dashboard/production/proposals/page.tsx', 'utf8')).toContain('proposalComments(p.comments).map(c => (')
  })
})
