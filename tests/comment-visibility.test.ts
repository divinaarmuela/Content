import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { clientMaySee, forTheClient, isTeamOnlyComment } from '../app/lib/comment-visibility-core'

/**
 * THE PLAN'S THREAD IS THE TEAM'S (the owner, 22 Sep 2026: "there is a comment
 * on the client portal — an internal comment from Divina to Karly … no
 * comments in the shoot plan should be in the client portal").
 */
const team = { role: 'super_admin' }
const client = { role: 'client' }

describe('what the client may see of a shoot’s comments', () => {
  it('a note that tags a colleague is the team’s, wherever it sits', () => {
    expect(isTeamOnlyComment({ assigned_to: 'karly', body: 'not bad, read the yellow note' })).toBe(true)
    expect(isTeamOnlyComment({ assigned_to: null, body: '@Karly Merau not bad' })).toBe(true)
    expect(isTeamOnlyComment({ assigned_to: null, body: 'Looks great' })).toBe(false)
  })
  it('the plan’s own thread never reaches the portal; the board’s card comments do; the client’s own words always do', () => {
    expect(clientMaySee({ card_id: null, body: 'Karly, can we move the call time?', team_users: team })).toBe(false)
    expect(clientMaySee({ card_id: null, assigned_to: 'karly', body: '@Karly Merau not bad', team_users: team })).toBe(false)
    expect(clientMaySee({ card_id: 'c1', body: 'We will swap this image', team_users: team })).toBe(true)
    expect(clientMaySee({ card_id: 'c1', assigned_to: 'karly', body: '@Karly fix this one', team_users: team })).toBe(false)
    expect(clientMaySee({ card_id: null, body: 'Love it\n— Sam', team_users: client })).toBe(true)
    expect(clientMaySee({ card_id: 'c1', body: 'Not this one', team_users: client })).toBe(true)
  })
  it('the filter keeps order', () => {
    const rows = [
      { id: 'a', card_id: null, body: 'team note', team_users: team },
      { id: 'b', card_id: 'c1', body: 'on the card', team_users: team },
      { id: 'c', card_id: null, body: 'client words', team_users: client },
    ]
    expect(forTheClient(rows).map(r => r.id)).toEqual(['b', 'c'])
  })
  it('both portal loaders and the client-facing comments route read through it', () => {
    expect(readFileSync('app/lib/portal-thread.ts', 'utf8')).toContain('.then(rows => forTheClient(rows as never[]))')
    expect(readFileSync('app/lib/portal-team-board.ts', 'utf8')).toContain('.then(rows => forTheClient(rows as never[]))')
    expect(readFileSync('app/api/production/batches/[id]/comments/route.ts', 'utf8')).toContain("if (user.role === 'client') comments = forTheClient(comments as never[])")
  })
})
