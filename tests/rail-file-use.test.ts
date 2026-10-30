import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { approvedAtOf, fileSummary, fileTag, fileUses, isRecent } from '../app/lib/rail-file-use-core'

// 30 Oct 2026, the owner: "tag with approved but not scheduled … see under approved folder approved but scheduled /
// posted … always have recently approved assets tab … so its understanding for the team and allow multi select"

describe('where each approved file stands', () => {
  const uses = fileUses([
    { stage: 'booked', live: false, at: '2026-11-07T02:30:00Z', urls: ['v3', 'v1'] },
    { stage: 'booked', live: false, at: '2026-11-01T03:30:00Z', urls: ['v1'] },
    { stage: 'posted', live: false, at: '2026-10-20T03:30:00Z', urls: ['v2'] },
    { stage: 'booked', live: true, at: '2026-10-21T03:30:00Z', urls: ['v5'] },
    { stage: 'quality_check', live: false, at: null, urls: ['v4', 'v2'] },
    { stage: 'draft', live: false, at: null, urls: ['v6'] },
    { stage: 'cancelled', live: false, at: null, urls: ['v7'] },
  ])
  it('posted beats booked beats in approval; the sooner booking wins; a draft or a cancelled post holds nothing', () => {
    expect(uses.get('v1')).toEqual({ kind: 'scheduled', at: '2026-11-01T03:30:00Z' })
    expect(uses.get('v2')?.kind).toBe('posted')
    expect(uses.get('v5')?.kind).toBe('posted')
    expect(uses.get('v4')?.kind).toBe('approving')
    expect(uses.has('v6')).toBe(false)
    expect(uses.has('v7')).toBe(false)
  })
  it('the tag on a file, and the count on a folder', () => {
    expect(fileTag(undefined).words).toBe('Not scheduled')
    expect(fileTag(uses.get('v3'))).toEqual({ words: 'Scheduled · Sat, 7 Nov', tone: 'scheduled' })
    expect(fileTag(uses.get('v4')).words).toBe('In post approval')
    expect(fileSummary(['v1', 'v2', 'v4', 'v6', 'v7'], uses)).toBe('2 not scheduled · 1 in post approval · 1 scheduled · 1 posted')
  })
  it('recently approved: the client’s latest clip approval, within 30 days', () => {
    expect(approvedAtOf({ clip_approvals: [{ at: '2026-10-20T00:00:00Z' }, { at: '2026-10-29T05:29:00Z' }] })).toBe('2026-10-29T05:29:00Z')
    expect(approvedAtOf({ status: 'approved_for_scheduling', updated_at: '2026-10-01T00:00:00Z' })).toBe('2026-10-01T00:00:00Z')
    expect(approvedAtOf({ status: 'draft_uploaded', updated_at: '2026-10-01T00:00:00Z' })).toBeNull()
    const now = new Date('2026-10-30T00:00:00Z')
    expect(isRecent('2026-10-05T00:00:00Z', now)).toBe(true)
    expect(isRecent('2026-09-20T00:00:00Z', now)).toBe(false)
  })
})

describe('the rail and the new-post window say so', () => {
  it('tabs, a tag on every file, a count on every folder, ticks across folders into one post', () => {
    const rail = readFileSync('app/dashboard/social/schedule/MediaRail.tsx', 'utf8')
    expect(rail).toContain("([['recent', 'Recently approved'], ['all', 'All approved']] as const)")
    expect(rail).toContain('data-file-use={t.tone}')
    expect(rail).toContain('onClick={() => onPick(tickedFiles[0].m, tickedFiles.map(t => t.sl))}')
    expect(readFileSync('app/dashboard/social/schedule/NewPostSources.tsx', 'utf8')).toContain('data-piece-uses')
  })
})
