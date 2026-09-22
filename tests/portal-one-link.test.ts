import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { asClientVersions, clientRoundsOf, clientVersionOf, withClientRound, assetLine, clientMayApprove, clientSeenRound, clipsAtRound, portalHasWork, portalOpenFor } from '../app/lib/editing-portal-core'

const files = [{ id: 'a', name: 'a.mp4', url: 'https://x/a', mime: 'video/mp4', size: 1, version: 1, uploaded_at: 'x' }]

describe('one link per card, open the whole way (22 Sep 2026)', () => {
  it('a card that has been given to the client keeps its link while it is sent back — the Glass Den card', () => {
    expect(portalOpenFor({ status: 'revision_required', delivered_at: '2026-09-18T13:59:10Z' })).toBe(true)
    expect(portalHasWork({ status: 'revision_required', delivered_at: '2026-09-18T13:59:10Z', final_files: files } as never)).toBe(true)
    // …a card the client has never been given is still not theirs to open
    expect(portalOpenFor({ status: 'quality_check', delivered_at: null })).toBe(false)
    expect(portalHasWork({ status: 'draft_uploaded', final_files: files } as never)).toBe(false)
    // they comment at any stage; they approve only while it is with them
    expect(clientMayApprove({ status: 'client_review' })).toBe(true)
    expect(clientMayApprove({ status: 'revision_required' })).toBe(false)
  })

  it('the link never shows more than the client was given', () => {
    expect(clientSeenRound({ client_round: 1, edit_round: 2 })).toBe(1)     // Version 2 is at the quality check, not theirs yet
    expect(clientSeenRound({ edit_round: 1 })).toBe(1)                      // an older card with no stamp
    expect(readFileSync('app/lib/workflow.ts', 'utf8')).toContain("...(to === 'client_review' ? { client_round: roundOf(item as never), client_rounds: withClientRound(")
    expect(readFileSync('app/lib/editing-portal.ts', 'utf8')).toContain('const uploadedAll = finalFilesOf(item).filter(f => f.version <= seen)')
  })

  it('Version 2 of the card is the two that were fine, carried forward, and the one that was replaced — with its old version beside it', () => {
    const clips = [
      { id: 'a', version: 1, asset_id: 'a', carries: true }, { id: 'b', version: 1, asset_id: 'b', carries: true },
      { id: 'c', version: 1, asset_id: 'c', carries: true }, { id: 'c2', version: 2, asset_id: 'c', carries: true },
    ]
    expect(clipsAtRound(clips, 2).map(c => c.id)).toEqual(['a', 'b', 'c2'])
    expect(clipsAtRound(clips, 1).map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(assetLine(clips, clips[3]).map(c => c.id)).toEqual(['c2', 'c'])
    expect(assetLine(clips, clips[0]).map(c => c.id)).toEqual(['a'])
    // a clip dropped from Version 2 on is out of Version 2 and still in Version 1 (22 Sep 2026)
    const withDrop = clips.map(c => (c.id === 'b' ? { ...c, retired_round: 2 } : c))
    expect(clipsAtRound(withDrop, 2).map(c => c.id)).toEqual(['a', 'c2'])
    expect(clipsAtRound(withDrop, 1).map(c => c.id)).toEqual(['a', 'b', 'c'])
    // a Drive-link round is one lump: its clips belong to their own version only
    const mixed = [{ id: 'd1', version: 1, carries: false }, { id: 'n', version: 2, asset_id: 'n', carries: true }]
    expect(clipsAtRound(mixed, 2).map(c => c.id)).toEqual(['n'])
    expect(clipsAtRound(mixed, 1).map(c => c.id)).toEqual(['d1'])
  })

  it('the client’s screen shows the tabs, says when the team has it back, and the server refuses a tick then', () => {
    const ui = readFileSync('app/components/portal/EditingReview.tsx', 'utf8')
    expect(ui).toContain('const clips = useMemo(() => clipsAtRound(data.clips, round), [data.clips, round])')
    expect(ui).toContain('aria-label="Versions of this piece"')
    expect(ui).toContain('aria-label="Versions of the whole set"')
    expect(ui).toContain('{!data.can_approve && (')
    // …and a tick, or taking one back, is taken at any time on the open link (the owner, 22 Sep 2026: "the client may suddenly change their minds")
    expect(readFileSync('app/api/portal/clip/route.ts', 'utf8')).not.toContain('clientMayApprove(')
  })

  it('the client’s versions are the times it reached them — a quality-check loop before they saw it is no version of theirs (22 Sep 2026)', () => {
    // the team: round 1 sent back at the quality check, round 2 given to the client, round 3 given again
    let rounds = withClientRound(null, 2)
    expect(rounds).toEqual([2])
    rounds = withClientRound(rounds, 2)          // back and forth without a new hand-in: still one version
    expect(rounds).toEqual([2])
    rounds = withClientRound(rounds, 3)
    expect(clientRoundsOf({ client_rounds: rounds })).toEqual([2, 3])
    expect(clientVersionOf(1, rounds)).toBe(1)   // a file from the team's round 1 first reached them in their Version 1
    expect(clientVersionOf(2, rounds)).toBe(1)
    expect(clientVersionOf(3, rounds)).toBe(2)
    expect(clientVersionOf(4, rounds)).toBeNull() // not given yet
    // clip c: cut at round 1, replaced at round 2 before the client saw it, replaced again at round 3 after they did
    const clips = [
      { id: 'a', version: 1, asset_id: 'a', carries: true },
      { id: 'c', version: 1, asset_id: 'c', carries: true }, { id: 'c2', version: 2, asset_id: 'c', carries: true }, { id: 'c3', version: 3, asset_id: 'c', carries: true },
      { id: 'n', version: 4, asset_id: 'n', carries: true },
    ]
    const theirs = asClientVersions(clips, rounds)
    expect(theirs.map(c => [c.id, c.version])).toEqual([['a', 1], ['c2', 1], ['c3', 2]])   // c's round-1 cut never existed for them; n is not theirs yet
    expect(assetLine(theirs, theirs[2]).map(c => c.id)).toEqual(['c3', 'c2'])
    // an older card with no list: the one round it is known to have been given
    expect(clientRoundsOf({ client_round: 1, edit_round: 2 })).toEqual([1])
    expect(readFileSync('app/lib/workflow.ts', 'utf8')).toContain('client_rounds: withClientRound((item as { client_rounds?: unknown }).client_rounds, roundOf(item as never))')
  })
})
