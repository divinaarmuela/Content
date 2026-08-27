import { describe, expect, it } from 'vitest'
import {
  PLAN_STATE_LINE, clientStatusWord, planState, scheduledWhen,
} from '../app/lib/portal-words'

describe('clientStatusWord — a booked post says so', () => {
  it('calls a scheduled piece Scheduled, not Approved', () => {
    expect(clientStatusWord('scheduled', 'Approved')).toBe('Scheduled')
  })

  it('leaves every other stage exactly as the client label had it', () => {
    expect(clientStatusWord('approved_for_scheduling', 'Approved')).toBe('Approved')
    expect(clientStatusWord('published', 'Published')).toBe('Published')
    expect(clientStatusWord('client_review', 'Needs your review')).toBe('Needs your review')
    expect(clientStatusWord('draft_uploaded', 'In production')).toBe('In production')
  })
})

describe('scheduledWhen — the day AND the hour, in Melbourne', () => {
  it('reads back a posting time in the client’s words', () => {
    // 13:30 Melbourne on Thursday 27 August 2026
    expect(scheduledWhen('2026-08-27T03:30:00.000Z')).toBe('Thu 27 Aug, 1:30 pm')
  })

  it('is Melbourne’s clock, not the reader’s', () => {
    // 09:00 Melbourne, expressed in UTC
    expect(scheduledWhen('2026-08-26T23:00:00.000Z')).toBe('Thu 27 Aug, 9:00 am')
  })

  it('shows nothing rather than "Invalid Date"', () => {
    expect(scheduledWhen(null)).toBeNull()
    expect(scheduledWhen('')).toBeNull()
    expect(scheduledWhen('not a date')).toBeNull()
  })
})

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
