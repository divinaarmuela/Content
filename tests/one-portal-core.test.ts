import { describe, expect, it } from 'vitest'
import {
  ANSWER_LIVE, ANSWER_NOTE_NEEDED, ANSWER_NOT_OPEN, ANSWER_STALE, SLOT_MS,
  changedSinceApproval, clientAnswerProblem, holdDue, ifNoAnswerOf, insideLastSlot, nextFreeSlot, onePortal,
  onePortalPath, postOnPortal, readClientReview, readTab, reminderDue, reviewState, workTab,
} from '../app/lib/one-portal-core'

/* ── docs/ONE_PORTAL_SPEC.md (the owner, 2 Oct 2026) ── */

const at = (iso: string) => Date.parse(iso)
const NOW = at('2026-10-02T03:00:00.000Z')
const approved = (version: number, when = '2026-10-02T01:00:00.000Z') => ({ version, verdict: 'approved', note: null, by: 'Jordan', at: when })

describe('the switch', () => {
  it('is on only for an explicit true', () => {
    expect(onePortal({ portal_one: true })).toBe(true)
    for (const v of [undefined, null, false, 'true', 1]) expect(onePortal({ portal_one: v })).toBe(false)
    expect(onePortal(null)).toBe(false)
  })
})

describe('if the client has not approved (R5)', () => {
  it('defaults to post anyway', () => {
    expect(ifNoAnswerOf({})).toBe('post')
    expect(ifNoAnswerOf({ if_no_answer: 'nonsense' })).toBe('post')
    expect(ifNoAnswerOf({ if_no_answer: 'wait' })).toBe('wait')
  })
})

describe('where the client\'s word stands', () => {
  it('reads every state', () => {
    expect(reviewState({})).toBe('not_reviewed')
    expect(reviewState({ client_review: approved(2) })).toBe('approved')
    expect(reviewState({ client_review: { ...approved(2), verdict: 'not_approved', note: 'no' } })).toBe('not_approved')
    // the team fixed it and booked Version 3: that one has no answer yet
    expect(reviewState({ client_review: { ...approved(2), verdict: 'not_approved', note: 'no' }, sent_version: 3 })).toBe('not_reviewed')
    expect(reviewState({ client_review: { ...approved(2), verdict: 'not_approved', note: 'no' }, sent_version: 2 })).toBe('not_approved')
  })
  it('a change after approval keeps it (R9) until the team asks again', () => {
    expect(reviewState({ client_review: approved(2), review_asked: { version: 2, at: '2026-10-01T00:00:00.000Z' } })).toBe('approved')
    expect(reviewState({ client_review: approved(2), review_asked: { version: 3, at: '2026-10-02T02:00:00.000Z' } })).toBe('asked_again')
    expect(changedSinceApproval({ client_review: approved(2), sent_version: 3 })).toBe(true)
    expect(changedSinceApproval({ client_review: approved(2), sent_version: 2 })).toBe(false)
  })
  it('ignores a malformed record', () => {
    expect(readClientReview({ version: 'x', verdict: 'approved', at: 'a' })).toBeNull()
    expect(readClientReview({ version: 1, verdict: 'maybe', at: 'a' })).toBeNull()
  })
})

describe('the 15-minute slot (R8)', () => {
  it('the last 15 minutes', () => {
    expect(insideLastSlot('2026-10-02T03:14:00.000Z', NOW)).toBe(true)
    expect(insideLastSlot('2026-10-02T03:15:00.000Z', NOW)).toBe(false)
    expect(insideLastSlot('2026-10-02T02:59:00.000Z', NOW)).toBe(true)
    expect(insideLastSlot(null, NOW)).toBe(false)
  })
  it('the next quarter hour at least 15 minutes out, skipping taken ones', () => {
    // 3:00 → 3:15 is the first quarter hour 15 minutes away
    expect(new Date(nextFreeSlot(NOW)).toISOString()).toBe('2026-10-02T03:15:00.000Z')
    // 3:07 → 3:30 (3:15 is only 8 minutes away)
    expect(new Date(nextFreeSlot(NOW + 7 * 60_000)).toISOString()).toBe('2026-10-02T03:30:00.000Z')
    // 3:15 taken → 3:30; 3:15 and 3:30 taken → 3:45
    expect(new Date(nextFreeSlot(NOW, [at('2026-10-02T03:15:00.000Z')])).toISOString()).toBe('2026-10-02T03:30:00.000Z')
    expect(new Date(nextFreeSlot(NOW, [at('2026-10-02T03:15:00.000Z'), at('2026-10-02T03:31:00.000Z')])).toISOString()).toBe('2026-10-02T03:45:00.000Z')
    expect(nextFreeSlot(NOW) % SLOT_MS).toBe(0)
  })
})

describe('may the client answer?', () => {
  const booked = { stage: 'booked', sent_version: 3 }
  it('a booked post, this version', () => {
    expect(clientAnswerProblem(booked, { version: 3, verdict: 'approved' }, [])).toBeNull()
    expect(clientAnswerProblem(booked, { version: 3, verdict: 'not_approved', note: 'Wrong logo' }, [])).toBeNull()
  })
  it('refuses a stale version, a missing note, a live post and a post not on them', () => {
    expect(clientAnswerProblem(booked, { version: 2, verdict: 'approved' }, [])).toBe(ANSWER_STALE)
    expect(clientAnswerProblem(booked, { version: 3, verdict: 'not_approved', note: '  ' }, [])).toBe(ANSWER_NOTE_NEEDED)
    expect(clientAnswerProblem(booked, { version: 3, verdict: 'approved' }, ['instagram'])).toBe(ANSWER_LIVE)
    expect(clientAnswerProblem({ stage: 'posted', sent_version: 3 }, { version: 3, verdict: 'approved' }, [])).toBe(ANSWER_LIVE)
    for (const stage of ['draft', 'quality_check', 'ready', 'cancelled']) {
      expect(clientAnswerProblem({ stage, sent_version: 3 }, { version: 3, verdict: 'approved' }, [])).toBe(ANSWER_NOT_OPEN)
    }
  })
  it('a "wait" post that came off unanswered can still be approved (it books the next slot)', () => {
    expect(clientAnswerProblem({ stage: 'ready', sent_version: 3, if_no_answer: 'wait' }, { version: 3, verdict: 'approved' }, [])).toBeNull()
    expect(clientAnswerProblem({ stage: 'ready', sent_version: 3, if_no_answer: 'wait', client_review: approved(3) }, { version: 3, verdict: 'approved' }, [])).toBe(ANSWER_NOT_OPEN)
  })
})

describe('the sweep', () => {
  const asked = { version: 3, at: '2026-10-01T00:00:00.000Z', by: 'u' }
  it('reminds 24 h before, once asked, until answered for that version (R6)', () => {
    const base = { stage: 'booked', review_asked: asked }
    expect(reminderDue({ ...base, scheduled_for: '2026-10-03T02:00:00.000Z' }, NOW)).toBe(true)   // 23 h away
    expect(reminderDue({ ...base, scheduled_for: '2026-10-03T04:00:00.000Z' }, NOW)).toBe(false)  // 25 h away
    expect(reminderDue({ ...base, scheduled_for: '2026-10-02T05:00:00.000Z' }, NOW)).toBe(true)   // asked late → at once
    expect(reminderDue({ ...base, scheduled_for: '2026-10-02T05:00:00.000Z', client_review: approved(3) }, NOW)).toBe(false)
    expect(reminderDue({ stage: 'booked', scheduled_for: '2026-10-02T05:00:00.000Z' }, NOW)).toBe(false) // never asked
    expect(reminderDue({ ...base, stage: 'posted', scheduled_for: '2026-10-02T05:00:00.000Z' }, NOW)).toBe(false)
  })
  it('a "wait" post with no approval comes off 15 minutes before (R7)', () => {
    const wait = { stage: 'booked', if_no_answer: 'wait', scheduled_for: '2026-10-02T03:14:00.000Z' }
    expect(holdDue(wait, NOW)).toBe(true)
    expect(holdDue({ ...wait, scheduled_for: '2026-10-02T03:20:00.000Z' }, NOW)).toBe(false)
    expect(holdDue({ ...wait, client_review: approved(3) }, NOW)).toBe(false)
    expect(holdDue({ ...wait, if_no_answer: 'post' }, NOW)).toBe(false)
  })
})

describe('who sees what', () => {
  it('the business link sees business posts; a person only their own', () => {
    expect(postOnPortal(null, { kind: 'business' })).toBe(true)
    expect(postOnPortal(undefined, { kind: 'business' })).toBe(true)
    expect(postOnPortal('c1', { kind: 'business' })).toBe(false)
    expect(postOnPortal('c1', { kind: 'person', contactId: 'c1', name: 'A' })).toBe(true)
    expect(postOnPortal('c2', { kind: 'person', contactId: 'c1', name: 'A' })).toBe(false)
    expect(postOnPortal(null, { kind: 'person', contactId: 'c1', name: 'A' })).toBe(false)
  })
  it('tabs, work kinds and the one link', () => {
    expect(readTab('editing')).toBe('editing')
    expect(readTab('nope')).toBe('scheduling')
    expect(workTab('graphics')).toBe('designing')
    expect(workTab('video_edit')).toBe('editing')
    expect(workTab(null)).toBe('editing')
    expect(onePortalPath('tok', 'scheduling', 'p1')).toBe('/portal/tok/home?tab=scheduling&id=p1')
    expect(onePortalPath('tok')).toBe('/portal/tok/home')
  })
})
