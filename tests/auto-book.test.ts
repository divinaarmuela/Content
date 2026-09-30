import { describe, expect, it } from 'vitest'
import { AUTO_BOOK_AFTER, ROW_OF, SYSTEM_ACTIONS, autoBookAfter } from '../app/lib/post-stage-core'

// 30 Sep 2026, the owner: "if we move to approved and the time is there, make sure it's auto scheduled, or if client approved"

const landed = (stage: string, scheduled_for: string | null = '2026-10-12T01:30:00.000Z') => ({ stage, scheduled_for }) as never

describe('autoBookAfter', () => {
  it('books after every approval that lands on Ready with a time — the team’s, the client’s, a manager’s for them', () => {
    for (const a of ['pass', 'client_approve', 'approve_for_client', 'team_decides']) expect(autoBookAfter(a, landed('ready'))).toBe(true)
  })
  it('never without a time', () => {
    expect(autoBookAfter('client_approve', landed('ready', null))).toBe(false)
  })
  it('never re-books a post somebody took off the schedule, or one whose booking failed', () => {
    for (const a of ['unbook', 'booking_failed', 'record_failed']) expect(autoBookAfter(a, landed('ready'))).toBe(false)
  })
  it('never after a move that did not land on Ready (pass to the client goes With client)', () => {
    expect(autoBookAfter('pass', landed('with_client'))).toBe(false)
    expect(autoBookAfter('pass_send_client', landed('with_client'))).toBe(false)
  })
})

describe('auto_book', () => {
  it('only the app makes it, from Ready to Booked — and a person’s Book in stays theirs', () => {
    expect(ROW_OF.auto_book).toMatchObject({ from: ['ready'], to: 'booked', who: ['system'] })
    expect(SYSTEM_ACTIONS).toContain('auto_book')
    expect(SYSTEM_ACTIONS).not.toContain('book')
  })
  it('the list of approvals is the four that land on Ready', () => {
    for (const a of AUTO_BOOK_AFTER) expect(ROW_OF[a].to).toBe('ready')
  })
})
