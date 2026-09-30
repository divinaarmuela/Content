import { describe, expect, it } from 'vitest'
import { clientRoundsForLabels, handInRound, nextRoundWords, versionLabel, versionOfRound } from '../app/lib/edit-round-core'
import { clientRoundsOf, clientVersionOf } from '../app/lib/editing-portal-core'
import { cardVersionGroups } from '../app/lib/social-schedule-core'

/**
 * THE VERSION NUMBER IS THE CLIENT'S (the owner, 30 Sep 2026: "make sure the version stays the same until the
 * client — Version 1 comes back, Version 2"). Derived from the card, never stored: the team's screens and the portal
 * count the same way.
 */
describe('the version stays the same until the client has it', () => {
  it('hand-in → quality check sends it back → hand-in again: still Version 1', () => {
    const handedIn = { status: 'quality_check', edit_round: 1 }
    expect(versionLabel(handedIn, handInRound(handedIn))).toBe('Version 1')
    const sentBackByQc = { status: 'revision_required', edit_round: 1 }
    expect(handInRound(sentBackByQc)).toBe(1)
    expect(versionLabel(sentBackByQc, handInRound(sentBackByQc))).toBe('Version 1')
  })

  it('re-work started inside a version before the client has it reads "Version 1 · draft 2", never Version 2', () => {
    const card = { status: 'draft_uploaded', edit_round: 1 }
    expect(nextRoundWords({ item: card, handedIn: true }).label).toBe('Start Version 1 · draft 2')
    const pressed = { status: 'draft_uploaded', edit_round: 2 }
    expect(versionLabel(pressed, 2)).toBe('Version 1 · draft 2')
    expect(versionLabel(pressed, 1)).toBe('Version 1')
  })

  it('to the client → the client asks for changes → the next hand-in is Version 2', () => {
    const back = { status: 'client_changes_requested', edit_round: 1, client_round: 1, client_rounds: [1] }
    expect(handInRound(back)).toBe(2)
    expect(versionLabel(back, handInRound(back))).toBe('Version 2')
    expect(versionLabel(back, 1)).toBe('Version 1')
  })

  it('the team and the portal agree on every round the client was given', () => {
    // round 2 was internal re-work; round 3 went to the client as their Version 2
    const card = { status: 'client_review', edit_round: 3, client_round: 3, client_rounds: [1, 3] }
    for (const r of [1, 3]) expect(versionOfRound(card, r).n).toBe(clientVersionOf(r, clientRoundsOf(card)))
    expect(versionLabel(card, 2)).toBe('Version 2')
    expect(versionLabel(card, 3)).toBe('Version 2 · draft 2')
  })

  it('a card from before the list was kept counts every round it was with the client', () => {
    expect(clientRoundsForLabels({ status: 'client_review', edit_round: 2 })).toEqual([1, 2])
    expect(clientRoundsForLabels({ status: 'in_progress', edit_round: 2 })).toEqual([])
    expect(clientRoundsForLabels({ client_round: 2, edit_round: 3 })).toEqual([1, 2])
  })

  it('the post picker’s version names count the same way', () => {
    const f = (id: string, v: number) => ({ id, name: `${id}.mp4`, url: `https://r2.test/${id}.mp4`, mime: 'video/mp4', size: 1, version: v, uploaded_at: `t${v}` })
    const groups = cardVersionGroups({ status: 'approved_for_scheduling', edit_round: 2, client_rounds: [2], final_files: [f('a', 1), { ...f('b', 2), asset_id: 'a' }] } as never, [])
    expect(groups.map(g => g.label)).toEqual(['Version 1 · draft 2 (latest)', 'Version 1'])
  })
})
