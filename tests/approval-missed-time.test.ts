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

describe('a post put to the client is waiting on the client, not "on you" (28 Sep 2026)', () => {
  it('the Post approval panel and the card say so, even to a super admin', async () => {
    const { waitingRow } = await import('../app/lib/waiting-core')
    const { postWaitingLine, POST_WAITING_CLIENT } = await import('../app/lib/board-view-core')
    const card = { id: 'c', client_id: 'j', title: '11', status: 'approved_for_scheduling', posting_approval_state: 'pending', posting_client_required: true, updated_at: '2026-09-28T02:40:00Z', clients: { name: 'Jordan Wilson' } }
    const boss = { id: 'u', role: 'super_admin' as const, quality_reviewer: false }
    const row = waitingRow(card as never, boss as never, '2026-09-28')!
    expect(row.onYou).toBe(false)
    expect(row.who).toBe('client')
    expect(postWaitingLine(card as never, boss as never)).toBe(POST_WAITING_CLIENT)
    // not yet put to the client: still the team's
    expect(waitingRow({ ...card, posting_client_required: false } as never, boss as never, '2026-09-28')!.onYou).toBe(true)
  })
})

describe('approval without a time, and a link to send by hand (28 Sep 2026)', () => {
  it('approved with no time: the card says to pick one', async () => {
    const { approvalTimeLine, NEEDS_TIME_WORDS } = await import('../app/lib/post-to-client-core')
    expect(approvalTimeLine({ posting_approval_state: 'approved' }, [{ status: 'approved', scheduled_for: null }])).toBe(NEEDS_TIME_WORDS)
    expect(approvalTimeLine({ posting_approval_state: 'approved' }, [{ status: 'scheduled', scheduled_for: six }])).toBeNull()
  })
  it('a copied link counts as sent, and says so', async () => {
    const { readSentStamp, sentWords, waitingOnWords } = await import('../app/lib/post-to-client-core')
    const item = { posting_client_required: true, status: 'approved_for_scheduling', posting_approval_state: 'pending', client_sent: { at: '2026-09-28T09:00:00Z', to: [], stage: 'post', via: 'link', for_time: null } }
    expect(readSentStamp(item)?.via).toBe('link')
    expect(sentWords(readSentStamp(item)!)).toMatch(/^Approval link copied · /)
    expect(waitingOnWords(item, 'Justin Engelke', 'Australia/Melbourne', null)).toMatch(/^Waiting on Justin Engelke · link sent /)
  })
  it('the dialog copies the link, and the route opens the approval without emailing', () => {
    expect(readFileSync('app/dashboard/board/SendToClientDialog.tsx', 'utf8')).toContain("JSON.stringify({ copy: true })")
    const route = readFileSync('app/api/production/items/[id]/send-to-client/route.ts', 'utf8')
    expect(route).toContain('if (body.copy === true) {')
    expect(route).toContain("via: 'link'")
    const copyBlock = route.slice(route.indexOf('if (body.copy === true) {'), route.indexOf("return NextResponse.json({ link, message"))
    expect(copyBlock).not.toContain('notify(')
  })
})
