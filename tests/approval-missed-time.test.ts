import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { approvalTimeLine, MISSED_WORDS, NEW_TIME_WORDS, slotMissed, waitingOnWords } from '../app/lib/post-to-client-core'

/**
 * 28 Sep 2026: Jordan's post 11 and Justin's post 3 were booked for 6 pm and nobody approved in time. The owner: "we
 * need to schedule a new time and go through approval again — make sure it says so on the card".
 */
const six = '2026-09-28T08:00:00.000Z'
const tomorrow = '2026-09-29T08:00:00.000Z'
const at = (hhmm: string) => Date.parse(`2026-09-28T${hhmm}:00.000Z`)
const sent = { posting_approval_state: 'pending', posting_client_required: true, status: 'approved_for_scheduling', client_sent: { at: '2026-09-28T02:40:00Z', to: ['jordan@x.au'], stage: 'post', for_time: six } }

describe('a post whose time went before the client said yes', () => {
  it('is missed once inside the fifteen minutes a booking needs, and after', () => {
    expect(slotMissed(six, at('07:40'))).toBe(false)
    expect(slotMissed(six, at('07:46'))).toBe(true)
    expect(slotMissed(null, at('08:23'))).toBe(false)
  })
  it('the card says: pick a new time, then send it for approval again', () => {
    expect(approvalTimeLine(sent, [{ status: 'pending', scheduled_for: six }], at('08:23'))).toBe(MISSED_WORDS)
    expect(approvalTimeLine(sent, [{ status: 'pending', scheduled_for: six }], at('06:00'))).toBeNull()
  })
  it('a new time picked, not yet sent: send it to the client again', () => {
    expect(approvalTimeLine(sent, [{ status: 'pending', scheduled_for: tomorrow }], at('08:23'))).toBe(NEW_TIME_WORDS)
    // sent again for the new time — nothing to say
    expect(approvalTimeLine({ ...sent, client_sent: { ...sent.client_sent, for_time: tomorrow } }, [{ status: 'pending', scheduled_for: tomorrow }], at('08:23'))).toBeNull()
  })
  it('the Schedule says the same', () => {
    expect(waitingOnWords(sent, 'Jordan Wilson', 'Australia/Melbourne', six, at('08:23'))).toBe(MISSED_WORDS)
    expect(waitingOnWords(sent, 'Jordan Wilson', 'Australia/Melbourne', tomorrow, at('08:23'))).toBe(NEW_TIME_WORDS)
    expect(waitingOnWords(sent, 'Jordan Wilson', 'Australia/Melbourne', six, at('06:00'))).toMatch(/^Waiting on Jordan Wilson · emailed/)
  })
  it('the client\'s link closes — on the page and on the server', () => {
    expect(readFileSync('app/portal/[token]/approve/[id]/page.tsx', 'utf8')).toContain('so this approval has closed')
    expect(readFileSync('app/components/portal/ApprovePanel.tsx', 'utf8')).toContain('This approval has closed because its time passed')
    const route = readFileSync('app/api/portal/act/route.ts', 'utf8')
    expect(route).toContain('live.every(p => slotMissed(p.scheduled_for))')
    expect(route).toContain('{ status: 409 }')
  })
  it('a send records the time it was for, so a new time needs a new send', () => {
    expect(readFileSync('app/api/production/items/[id]/send-to-client/route.ts', 'utf8')).toContain("for_time: stage === 'post' ? (post?.scheduled_for ?? null) : null")
  })
})
