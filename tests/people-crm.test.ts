import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PEOPLE_CRM_CLIENTS } from '../app/lib/people-crm-core'

/**
 * WHO A PERSON IN THE INBOX IS — the wiring that is left after the People page and its follower/liker read were
 * removed (1 Oct 2026). The automation side is pinned in people-crm-automations.test.ts.
 */
describe('the Inbox’s person card and its wiring', () => {
  it('is for Justin and Jordan, team only, scoped by client', () => {
    // plus the test client, so it is checked on test data (30 Sep 2026)
    expect(PEOPLE_CRM_CLIENTS.map(c => c.name)).toEqual(['Justin Engelke', 'Jordan Wilson', '100 Hundred Million Group (test)'])
    const route = readFileSync('app/api/social/people-crm/route.ts', 'utf8')
    expect(route).toContain("requireRole('scheduler')")
    expect(route).toContain('assertClientAccess(user, clientId)')
    expect(route).toContain('PEOPLE_CRM_CLIENTS.some(c => c.id === clientId)')
  })
  it('an incoming DM and a comment are noted as they arrive, not only when the Inbox is opened', () => {
    const wh = readFileSync('app/lib/zernio-webhook.ts', 'utf8')
    expect(wh).toContain("kind: 'message', account_id: action.accountId")
    expect(wh).toContain("kind: 'comment', account_id: action.accountId")
    expect(wh).toContain('!action.own')
  })
  it('the comments call carries the account the provider requires', () => {
    expect(readFileSync('app/lib/publisher.ts', 'utf8')).toContain('&accountId=${encodeURIComponent(accountId)}')
    expect(readFileSync('app/lib/post-analytics.ts', 'utf8')).toContain('publisher.postComments(id, commentAccountOf(job.targets))')
    expect(readFileSync('app/api/social/comments/route.ts', 'utf8')).toContain("postComments(postId, params.get('accountId'))")
  })
})
