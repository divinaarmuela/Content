import { describe, expect, it } from 'vitest'
import {
  EDITOR_LANES, EDITOR_LANE_WORDS, QC_CHECKLIST, HANDOVER_ITEMS, BLOCKER_NEEDS, NOT_GIVEN,
  ackNudgeDue, assignedAtOf, beforeYouStart, blockedChip, blockerNudgeDue, blockerWords,
  handoverState, qcComplete, qcDetail, qcDoneFor, reviewWords, showsHandover, workFrom, HOUR,
} from '../app/lib/editor-sop-core'
import { flagCheck } from '../app/lib/card-flag-core'
import { BOARD_COLUMNS } from '../app/lib/board-core'

/* ── the Video Editors SOP, pages 20–21, pinned line by line ── */

describe('§6 the four stages', () => {
  it('is In Progress, For Review, For Handoff, Done — the SOP’s words, every column in exactly one', () => {
    expect(EDITOR_LANE_WORDS).toBe('In Progress, For Review, For Handoff, Done')
    expect(EDITOR_LANES.flatMap(l => l.columns).sort()).toEqual(BOARD_COLUMNS.map(c => c.key).sort())
    expect(EDITOR_LANES.find(l => l.key === 'for_review')!.columns).toEqual(['internal_check', 'quality_check', 'with_client'])
    expect(EDITOR_LANES.find(l => l.key === 'done')!.folded).toBe(true)
  })
  it('inside For Review the editor is told who has it, in small words', () => {
    expect(reviewWords('internal_review')).toBe('With the account manager')
    expect(reviewWords('quality_check')).toBe('With the quality reviewer')
    expect(reviewWords('client_review')).toBe('With the client')
    expect(reviewWords('client_changes_requested')).toBe('The client asked for changes')
    expect(reviewWords('draft_uploaded')).toBeNull()
  })
})

describe('§2 before you start', () => {
  it('lists the SOP’s brief, every row drawn, an empty one saying Not given', () => {
    const rows = beforeYouStart({ card: { client_id: 'c1' } })
    expect(rows.map(r => r.key)).toEqual(['objective', 'deliverables', 'specs', 'deadline', 'shot_list', 'script', 'notes', 'previous'])
    expect(rows.filter(r => r.key !== 'previous').every(r => r.value === null)).toBe(true)
    expect(NOT_GIVEN).toBe('Not given')
    expect(rows.find(r => r.key === 'previous')!.href).toContain('/dashboard/scheduler?client=c1')
  })
  it('reads the shoot plan, the card and the specs', () => {
    const rows = beforeYouStart({
      card: { client_id: 'c1', due_date: '2026-09-25', change_note: 'Tighten the intro', platform_targets: ['instagram'] },
      shoot: {
        objective: 'Launch the spring range', planned_deliverables: [{ id: 'l1', title: '5 reels' }, { id: 'l2', title: 'photo set' }],
        shot_list: [{ id: 's1', text: 'Walk in' }, 'Product on the counter'], editor_priorities: 'Reel 1 first', edit_deadline: '2026-09-26', script: 'Hello',
      },
      specs: [{ platform: 'Instagram', lines: ['9:16', 'up to 90 s'] }],
    })
    const by = Object.fromEntries(rows.map(r => [r.key, r.value]))
    expect(by.objective).toBe('Launch the spring range')
    expect(by.deliverables).toBe('5 reels, photo set')
    expect(by.specs).toBe('Instagram: 9:16 · up to 90 s')
    expect(by.deadline).toBe('2026-09-25')
    expect(by.shot_list).toBe('1. Walk in\n2. Product on the counter')
    expect(by.script).toBe('Hello')
    expect(by.notes).toBe('Reel 1 first\nTighten the intro')
  })
  it('§1 says where to work from and where the finals go', () => {
    expect(workFrom({ card: { client_id: 'c1', raw_assets_url: 'https://www.dropbox.com/x' } })).toEqual({ footage: 'https://www.dropbox.com/x', finalsFolder: null })
    expect(workFrom({ card: { client_id: 'c1' }, shoot: { footage_url: 'https://drive.google.com/f' }, driveFolderUrl: 'https://drive.google.com/drive/folders/1' }))
      .toEqual({ footage: 'https://drive.google.com/f', finalsFolder: 'https://drive.google.com/drive/folders/1' })
  })
})

describe('§4 quality control before submitting', () => {
  it('is the SOP’s seven checks, and submit needs all of them', () => {
    expect(QC_CHECKLIST.map(c => c.label)).toEqual([
      'Watched the full export start to finish',
      'Spelling and on-screen text checked against the brief',
      'Audio levels and sync',
      'Branding',
      'Transitions',
      'Correct aspect ratio and length for the platform',
      'Image and footage quality',
    ])
    expect(qcComplete(QC_CHECKLIST.map(c => c.key))).toBe(true)
    expect(qcComplete(QC_CHECKLIST.map(c => c.key).slice(1))).toBe(false)
    expect(qcDetail(['watched', 'audio'])).toBe('QC done: Watched the full export start to finish; Audio levels and sync')
    expect(qcDoneFor({ qc_done_version: 2, current_version_number: 2 })).toBe(true)
    expect(qcDoneFor({ qc_done_version: 1, current_version_number: 2 })).toBe(false)
  })
  it('the route refuses a quality check with a tick missing', () => {
    const viewer = { id: 'ed', role: 'editor' as const }
    expect(flagCheck({ kind: 'qc_done', note: '', ticks: ['watched'], viewer, ownerId: 'ed' })).toMatchObject({ ok: false, status: 400 })
    expect(flagCheck({ kind: 'qc_done', note: '', ticks: QC_CHECKLIST.map(c => c.key), viewer, ownerId: 'ed' })).toMatchObject({ ok: true, kind: 'qc_done' })
  })
})

describe('§5 handover and source files', () => {
  it('three ticks on an approved card; the source tick needs the link; the owner tick is automatic', () => {
    expect(HANDOVER_ITEMS.map(h => h.label)).toEqual(['Final is in the Drive monthly folder', 'Source and project files handed off', 'Next owner tagged'])
    expect(showsHandover('approved_for_scheduling')).toBe(true)
    expect(showsHandover('internal_review')).toBe(false)
    const state = handoverState({ status: 'approved_for_scheduling', handover_drive_at: 'x', handover_source_at: 'x', link_url: null, scheduler_ids: ['s1'] })
    expect(state.map(s => s.done)).toEqual([true, false, true])
    expect(handoverState({ status: 'approved_for_scheduling', link_url: 'https://www.dropbox.com/a', handover_source_at: 'x' })[1].done).toBe(true)
  })
})

describe('§6 acknowledge the same day', () => {
  it('finds when the card became theirs and nudges the morning after, once', () => {
    const card = { owner_id: 'ed', created_at: '2026-09-10T02:00:00Z' }
    expect(assignedAtOf(card, [])).toBe('2026-09-10T02:00:00Z')
    expect(assignedAtOf(card, [{ action: 'handed_from_shoot', created_at: '2026-09-11T05:00:00Z' }])).toBe('2026-09-11T05:00:00Z')
    expect(assignedAtOf({ owner_id: null, created_at: 'x' }, [])).toBeNull()
    expect(ackNudgeDue({ assignedAt: '2026-09-10T02:00:00Z', acknowledged: false, todayKey: '2026-09-11' })).toBe(true)
    expect(ackNudgeDue({ assignedAt: '2026-09-11T02:00:00Z', acknowledged: false, todayKey: '2026-09-11' })).toBe(false)
    expect(ackNudgeDue({ assignedAt: '2026-09-10T02:00:00Z', acknowledged: true, todayKey: '2026-09-11' })).toBe(false)
    expect(ackNudgeDue({ assignedAt: '2026-09-10T02:00:00Z', acknowledged: false, ack_nudged_at: 'x', todayKey: '2026-09-11' })).toBe(false)
  })
})

describe('§7 the 24-hour blocker rule', () => {
  it('is the SOP’s who-to-ask table, in its words', () => {
    expect(BLOCKER_NEEDS.map(n => n.label)).toEqual(['Missing or corrupt footage', 'Brief or creative direction', 'Strategy or client context', 'A brief clarified'])
    expect(BLOCKER_NEEDS.map(n => n.who)).toEqual([
      'The videographer or Production',
      "The editors' lead or the account manager",
      "The editors' lead or leadership",
      "The editors' lead or leadership, then Ops",
    ])
  })
  it('says who is waited on since when, and escalates at 12 and 24 hours, each once', () => {
    const at = '2026-09-11T00:00:00Z'
    const t = Date.parse(at)
    expect(blockerWords({ blocked_need: 'footage', blocked_from_id: 'y', blocked_at: at }, id => (id === 'y' ? 'Yusuf' : null), iso => iso))
      .toBe('Waiting on missing or corrupt footage from Yusuf since 2026-09-11T00:00:00Z')
    expect(blockerWords({ blocked_need: 'brief', blocked_at: at }, () => null, iso => iso)).toContain("from The editors' lead or the account manager")
    expect(blockerWords({ blocked_need: null, blocked_at: at }, () => null, iso => iso)).toBeNull()
    expect(blockerNudgeDue({ blocked_at: at }, t + 11 * HOUR)).toBeNull()
    expect(blockerNudgeDue({ blocked_at: at }, t + 12 * HOUR)).toBe('12')
    expect(blockerNudgeDue({ blocked_at: at, blocked_nudged_12_at: 'x' }, t + 13 * HOUR)).toBeNull()
    expect(blockerNudgeDue({ blocked_at: at, blocked_nudged_12_at: 'x' }, t + 24 * HOUR)).toBe('24')
    expect(blockerNudgeDue({ blocked_at: at, blocked_nudged_12_at: 'x', blocked_nudged_24_at: 'x' }, t + 30 * HOUR)).toBeNull()
    expect(blockerNudgeDue({ blocked_at: null }, t)).toBeNull()
    expect(blockedChip({ blocked_at: at, blocked_need: 'context' })).toBe('Blocked: strategy or client context')
  })
  it('the route needs a need from the list and a line', () => {
    const viewer = { id: 'ed', role: 'editor' as const }
    expect(flagCheck({ kind: 'blocked', note: 'Scene 3 missing', need: 'nope', viewer, ownerId: 'ed' })).toMatchObject({ ok: false, status: 400 })
    expect(flagCheck({ kind: 'blocked', note: '', need: 'footage', viewer, ownerId: 'ed' })).toMatchObject({ ok: false, status: 400 })
    expect(flagCheck({ kind: 'blocked', note: 'Scene 3 missing', need: 'footage', viewer, ownerId: 'ed' })).toMatchObject({ ok: true, need: 'footage' })
    // somebody else's card: not theirs to block
    expect(flagCheck({ kind: 'blocked', note: 'x', need: 'footage', viewer, ownerId: 'other' })).toMatchObject({ ok: false, status: 403 })
  })
})
