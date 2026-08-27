import { describe, expect, it } from 'vitest'
import { PLAN_STATE_LINE, planState } from '../app/lib/portal-words'

describe('planState — the client’s own decision, said back to them', () => {
  it('an unshared plan has nothing to say, whatever the brief is doing', () => {
    expect(planState('client_review', 'brief', false)).toBeNull()
    expect(planState('approved_for_scheduling', 'locked', false)).toBeNull()
  })

  it('at client_review it is their move', () => {
    expect(planState('client_review', 'brief', true)).toBe('awaiting_you')
  })

  it('after "Request changes" the card says the notes landed', () => {
    // the brief goes client_review → client_changes_requested, and from there
    // through the team's own revision loop. All of it is "we're on it".
    for (const s of ['client_changes_requested', 'revision_required', 'revision_complete']) {
      expect(planState(s, 'brief', true)).toBe('changes_sent')
    }
  })

  it('after "Approve the plan" the card confirms it, then confirms the date', () => {
    expect(planState('approved_for_scheduling', 'brief', true)).toBe('approved')
    expect(planState('approved_for_scheduling', 'locked', true)).toBe('date_confirmed')
    expect(planState('scheduled', 'locked', true)).toBe('date_confirmed')
    expect(planState('published', 'shot', true)).toBe('date_confirmed')
  })

  it('a plan still being written says nothing — a booked shoot still says booked', () => {
    expect(planState('draft_uploaded', 'brief', true)).toBeNull()
    expect(planState('internal_review', 'brief', true)).toBeNull()
    expect(planState(null, 'brief', true)).toBeNull()
    // no brief at all, but the shoot is in their diary
    expect(planState(null, 'locked', true)).toBe('date_confirmed')
  })

  it('every state it can return has a line to show', () => {
    for (const s of ['awaiting_you', 'changes_sent', 'approved', 'date_confirmed'] as const) {
      expect(PLAN_STATE_LINE[s]).toBeTruthy()
    }
    expect(PLAN_STATE_LINE.changes_sent).toContain('updated plan')
    expect(PLAN_STATE_LINE.approved).toContain('confirm the date')
  })
})
