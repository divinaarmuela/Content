import { describe, it, expect } from 'vitest'
import {
  activityLines, cardCredits, describeActivity, type ActivityRow,
} from '../app/lib/activity-core'

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'a1',
  created_at: '2026-08-20T10:00:00.000Z',
  action: 'status_change',
  actor_name: 'Divina',
  ...over,
})

describe('describeActivity', () => {
  it('names the person who created it', () => {
    expect(describeActivity(row({ action: 'created' }), 'asset')).toBe('Created by Divina')
  })

  it('says approved for an asset, plan approved for a brief, done for a task', () => {
    // an INTERNAL approval — nobody asked the client
    const r = row({ new_value: 'approved_for_scheduling', old_value: 'internal_review' })
    expect(describeActivity(r, 'asset')).toBe('Approved by Divina')
    expect(describeActivity(r, 'brief')).toBe('Plan approved by Divina')
    expect(describeActivity(r, 'task')).toBe('Approved — done by Divina')
  })

  it('records the CLIENT’s approval in the words the button used', () => {
    // the button says "Client approved — mark done"; the history said
    // "Approved — done", which is the one place the old vocabulary survived
    const r = row({ new_value: 'approved_for_scheduling', old_value: 'client_review' })
    expect(describeActivity(r, 'task')).toBe('Client approved — marked done by Divina')
    expect(describeActivity(r, 'brief')).toBe("The client's plan approval logged by Divina")
    expect(describeActivity(r, 'asset')).toBe("The client's approval logged by Divina")
  })

  it('calls a booked shoot booked, never published', () => {
    expect(describeActivity(row({ new_value: 'scheduled' }), 'brief')).toBe('Shoot booked by Divina')
    expect(describeActivity(row({ new_value: 'published' }), 'brief')).toBe('Shoot booked by Divina')
  })

  it('never prints a raw status', () => {
    for (const kind of ['asset', 'brief', 'task'] as const) {
      for (const s of ['internal_review', 'revision_required', 'client_review', 'approved_for_scheduling']) {
        const text = describeActivity(row({ new_value: s }), kind)
        expect(text).toBeTruthy()
        expect(text).not.toContain('_')
      }
    }
  })

  it('counts drafts on a task and versions on an asset', () => {
    const r = row({ action: 'version_added', new_value: 'v3' })
    expect(describeActivity(r, 'asset')).toBe('Version v3 by Divina')
    expect(describeActivity(r, 'task')).toBe('Draft 3 by Divina')
  })

  it('tells the two claim seats apart', () => {
    expect(describeActivity(row({ action: 'claimed', detail: 'picked up the edit' }), 'asset'))
      .toBe('Taken by Divina')
    expect(describeActivity(row({ action: 'claimed', detail: 'picked up the scheduling' }), 'asset'))
      .toBe('Scheduling taken by Divina')
  })

  it('drops the rows that are not history a person needs', () => {
    expect(describeActivity(row({ action: 'updated', detail: 'caption' }), 'asset')).toBeNull()
    expect(describeActivity(row({ action: 'comment_added' }), 'asset')).toBeNull()
    // a status this overlay never arrives at has no sentence rather than a bad one
    expect(describeActivity(row({ new_value: 'draft_uploaded' }), 'asset')).toBeNull()
  })

  it('says "someone" rather than nothing when the actor is gone', () => {
    expect(describeActivity(row({ action: 'created', actor_name: null }), 'asset')).toBe('Created by someone')
    expect(describeActivity(row({ action: 'created', actor_name: '  ' }), 'asset')).toBe('Created by someone')
  })
})

describe('activityLines', () => {
  it('is newest first and carries no unreadable rows', () => {
    const lines = activityLines([
      row({ id: 'old', created_at: '2026-08-01T00:00:00.000Z', action: 'created' }),
      row({ id: 'noise', created_at: '2026-08-02T00:00:00.000Z', action: 'updated' }),
      row({ id: 'new', created_at: '2026-08-03T00:00:00.000Z', new_value: 'internal_review' }),
    ], 'asset')
    expect(lines.map(l => l.id)).toEqual(['new', 'old'])
    expect(lines[0].text).toBe('Submitted for review by Divina')
  })

  it('is empty for an item that predates the trail', () => {
    expect(activityLines([], 'task')).toEqual([])
  })
})

describe('cardCredits', () => {
  it('gives the creator and the LAST approver', () => {
    const credits = cardCredits([
      row({ id: 'c', action: 'created', actor_name: 'Manal', created_at: '2026-08-01T00:00:00.000Z' }),
      row({ id: 'a1', new_value: 'approved_for_scheduling', actor_name: 'Divina', created_at: '2026-08-02T00:00:00.000Z' }),
      row({ id: 'a2', new_value: 'approved_for_scheduling', actor_name: 'Martin', created_at: '2026-08-05T00:00:00.000Z' }),
    ])
    expect(credits).toEqual({ created_by: 'Manal', approved_by: 'Martin' })
  })

  it('returns nulls rather than guesses', () => {
    expect(cardCredits([])).toEqual({ created_by: null, approved_by: null })
    expect(cardCredits([row({ action: 'created', actor_name: null })]))
      .toEqual({ created_by: null, approved_by: null })
  })
})
