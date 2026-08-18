import { describe, it, expect } from 'vitest'
import {
  MAX_PAGES_PER_CHUNK, mergeProfiles, planChunks, profileIsEmpty, type BrandProfile,
} from '../app/lib/brand-core'

describe('planChunks', () => {
  it('leaves a small document in one piece', () => {
    expect(planChunks(12)).toEqual([[0, 12]])
  })

  it('splits a long document into page ranges that cover every page exactly once', () => {
    const chunks = planChunks(94)
    expect(chunks[0]).toEqual([0, 20])
    expect(chunks.at(-1)).toEqual([80, 94])
    const covered = chunks.reduce((n, [a, b]) => n + (b - a), 0)
    expect(covered).toBe(94)
    for (let i = 1; i < chunks.length; i++) expect(chunks[i][0]).toBe(chunks[i - 1][1])
  })

  it('never exceeds the per-chunk page budget', () => {
    for (const [a, b] of planChunks(250)) expect(b - a).toBeLessThanOrEqual(MAX_PAGES_PER_CHUNK)
  })

  it('handles an empty or broken document', () => {
    expect(planChunks(0)).toEqual([])
    expect(planChunks(-3)).toEqual([])
  })
})

describe('mergeProfiles', () => {
  it('returns the new profile when there is nothing to merge into', () => {
    const next: BrandProfile = { summary: 'Warm and direct' }
    expect(mergeProfiles(null, next)).toEqual(next)
    expect(mergeProfiles({}, next)).toEqual(next)
  })

  it('merges a font by family, filling gaps without overwriting', () => {
    const merged = mergeProfiles(
      { fonts: [{ family: 'Archivo', usage: 'headlines' }] },
      { fonts: [{ family: 'archivo', usage: 'body', weights: ['400', '600'] }, { family: 'Sometype Mono' }] },
    )
    expect(merged.fonts).toHaveLength(2)
    expect(merged.fonts![0]).toEqual({ family: 'Archivo', usage: 'headlines', weights: ['400', '600'] })
    expect(merged.fonts![1].family).toBe('Sometype Mono')
  })

  it('merges colours by hex and keeps distinct ones', () => {
    const merged = mergeProfiles(
      { colors: [{ hex: '#0057FF' }] },
      { colors: [{ hex: '#0057ff', name: 'Electric blue', usage: 'accent' }, { hex: '#0A0A0A' }] },
    )
    expect(merged.colors).toHaveLength(2)
    expect(merged.colors![0]).toEqual({ hex: '#0057FF', name: 'Electric blue', usage: 'accent' })
  })

  it('deduplicates repeated rules across chunks, case-insensitively', () => {
    const merged = mergeProfiles(
      { logo_rules: ['Never stretch the logo'] },
      { logo_rules: ['never stretch the logo', 'Keep clear space'] },
    )
    expect(merged.logo_rules).toEqual(['Never stretch the logo', 'Keep clear space'])
  })

  it('unions voice keywords and dos/donts', () => {
    const merged = mergeProfiles(
      { voice: { tone: 'Warm', keywords: ['direct'] }, dos_and_donts: { dos: ['Use white space'] } },
      { voice: { description: 'No jargon', keywords: ['direct', 'plain'] }, dos_and_donts: { donts: ['No filters'] } },
    )
    expect(merged.voice).toEqual({ tone: 'Warm', description: 'No jargon', keywords: ['direct', 'plain'] })
    expect(merged.dos_and_donts).toEqual({ dos: ['Use white space'], donts: ['No filters'] })
  })

  it('an earlier fact wins over a later contradiction', () => {
    const merged = mergeProfiles({ summary: 'First read' }, { summary: 'Second read' })
    expect(merged.summary).toBe('First read')
  })
})

describe('profileIsEmpty', () => {
  it('recognises nothing worth showing', () => {
    expect(profileIsEmpty(null)).toBe(true)
    expect(profileIsEmpty({})).toBe(true)
    expect(profileIsEmpty({ fonts: [], colors: [], summary: '  ' })).toBe(true)
  })

  it('recognises real content', () => {
    expect(profileIsEmpty({ colors: [{ hex: '#000000' }] })).toBe(false)
    expect(profileIsEmpty({ summary: 'Warm' })).toBe(false)
  })
})
