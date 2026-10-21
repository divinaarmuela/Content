import { describe, expect, it } from 'vitest'
import { stackVersions, type StackFile } from '../app/lib/version-stack-core'

const f = (key: string, at: string, o: Partial<StackFile> = {}): StackFile => ({
  key, name: `${key}.mov`, at, source: key.startsWith('a:') ? 'card' : 'drive', kind: null, matchKey: null,
  ask: false, busy: false, thumb: null, confidence: null, otherCard: null, ...o,
})

describe('stackVersions', () => {
  it('one video: the card draft is V1, a re-cut V2, copies of V2 are V2 again, the latest is on top', () => {
    const [s, ...rest] = stackVersions([
      f('a:draft', '2026-10-01'),
      f('s:one', '2026-10-05', { kind: 'recut', matchKey: 'a:draft' }),
      f('s:v3', '2026-10-06', { kind: 'copy', matchKey: 's:one' }),
      f('s:final', '2026-10-07', { kind: 'copy', matchKey: 's:one' }),
    ])
    expect(rest).toEqual([])
    expect(s.versions).toEqual(['V1', 'V2'])
    expect(s.entries.map(e => [e.key, e.label, e.sameAsEarlier])).toEqual([
      ['a:draft', 'V1', false], ['s:one', 'V2', false], ['s:v3', 'V2', true], ['s:final', 'V2', true],
    ])
    expect(s.latest.key).toBe('s:final')
  })
  it('a graded file is its version graded, not a new version, and is the latest', () => {
    const [s] = stackVersions([
      f('a:draft', '2026-10-01'),
      f('s:graded', '2026-10-03', { kind: 'graded', matchKey: 'a:draft' }),
    ])
    expect(s.versions).toEqual(['V1'])
    expect(s.latest).toMatchObject({ key: 's:graded', label: 'V1', graded: true })
  })
  it('different videos are different stacks, and the ones to check come first', () => {
    const stacks = stackVersions([
      f('s:pour', '2026-10-02', { kind: 'new_video' }),
      f('s:duck', '2026-10-03', { kind: 'new_video' }),
      f('s:caviar', '2026-10-01', { kind: 'recut', matchKey: 's:pour', ask: true }),
    ])
    expect(stacks).toHaveLength(2)
    expect(stacks[0].entries.map(e => e.key)).toEqual(['s:caviar', 's:pour'])
    expect(stacks[0].ask).toBe(true)
  })
  it("a file matched to another card's video says so", () => {
    const [s] = stackVersions([f('s:vf', '2026-10-04', { kind: 'recut', matchKey: 'o:card2:a1', otherCard: 'Olimpia Book', ask: true })])
    expect(s.otherCard).toBe('Olimpia Book')
  })
})
