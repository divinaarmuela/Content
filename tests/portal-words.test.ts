import { describe, expect, it } from 'vitest'
import {
  APPROVE_PLAN_WITH_NOTE, PLAN_APPROVED_WITH_NOTE_LINE, PLAN_NOTE_PLACEHOLDER,
  PLAN_STATE_LINE, clientStatusWord, planState, planStateLine, scheduledWhen,
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

describe('scheduledWhen — the day AND the hour, on the CLIENT’s clock', () => {
  it('reads back a posting time in the client’s words', () => {
    // 13:30 Melbourne on Thursday 27 August 2026
    expect(scheduledWhen('2026-08-27T03:30:00.000Z')).toBe('Thu 27 Aug, 1:30 pm')
  })

  it('is Melbourne’s clock, not the reader’s, when no zone is given', () => {
    // 09:00 Melbourne, expressed in UTC. Melbourne is the DEFAULT, not the
    // rule — it keeps every client who was one reading exactly as before.
    expect(scheduledWhen('2026-08-26T23:00:00.000Z')).toBe('Thu 27 Aug, 9:00 am')
  })

  it('is the client’s own zone when they have one', () => {
    // one instant, three audiences: each reads the hour their feed sees it
    const iso = '2026-08-26T23:00:00.000Z'
    expect(scheduledWhen(iso, 'Australia/Melbourne')).toBe('Thu 27 Aug, 9:00 am')
    expect(scheduledWhen(iso, 'Asia/Manila')).toBe('Thu 27 Aug, 7:00 am')
    expect(scheduledWhen(iso, 'America/Los_Angeles')).toBe('Wed 26 Aug, 4:00 pm')
  })

  it('follows the client’s daylight saving, not a fixed offset', () => {
    // 9 am Melbourne in January is AEDT (+11); in August it is AEST (+10)
    expect(scheduledWhen('2026-01-26T22:00:00.000Z', 'Australia/Melbourne')).toBe('Tue 27 Jan, 9:00 am')
    expect(scheduledWhen('2026-08-26T23:00:00.000Z', 'Australia/Melbourne')).toBe('Thu 27 Aug, 9:00 am')
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

describe('planStateLine — a plan approved WITH something to say', () => {
  it('says both things happened: the approval and the note', () => {
    expect(planStateLine('approved', true)).toBe(PLAN_APPROVED_WITH_NOTE_LINE)
    expect(PLAN_APPROVED_WITH_NOTE_LINE).toContain('Approved')
    expect(PLAN_APPROVED_WITH_NOTE_LINE).toContain('your note')
  })

  it('is the ordinary line when the approval carried nothing', () => {
    expect(planStateLine('approved')).toBe(PLAN_STATE_LINE.approved)
    expect(planStateLine('approved', false)).toBe(PLAN_STATE_LINE.approved)
  })

  it('never overrides a bigger fact about their diary', () => {
    // the date being confirmed outranks a note they wrote on the way past
    expect(planStateLine('date_confirmed', true)).toBe(PLAN_STATE_LINE.date_confirmed)
    expect(planStateLine('awaiting_you', true)).toBe(PLAN_STATE_LINE.awaiting_you)
    expect(planStateLine('changes_sent', true)).toBe(PLAN_STATE_LINE.changes_sent)
  })

  it('asks about the day, not about a file — a shoot is a diary entry', () => {
    expect(PLAN_NOTE_PLACEHOLDER).toMatch(/before the day/i)
    expect(APPROVE_PLAN_WITH_NOTE).toBe('Approve with a note')
  })

  it('every word on the plan card is a client word', () => {
    const all = [
      PLAN_APPROVED_WITH_NOTE_LINE, PLAN_NOTE_PLACEHOLDER, APPROVE_PLAN_WITH_NOTE,
      ...Object.values(PLAN_STATE_LINE),
    ].join(' ')
    // no database status, no internal vocabulary
    expect(all).not.toMatch(/_|brief|batch|client_review|approved_for_scheduling/i)
  })
})
