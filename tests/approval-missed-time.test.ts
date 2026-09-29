import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 28 Sep 2026: Jordan's post 11 and Justin's post 3 were booked for 6 pm and nobody approved in time. The owner: "we
 * need to schedule a new time and go through approval again — make sure it says so on the card".
 *
 * The rules themselves (the approve-by time, "Missed — needs a new time", nothing moving by itself) are the post's own
 * now, pinned in tests/post-stage-core.test.ts and tests/post-board-core.test.ts; post-to-client-core, which read the
 * item's fields for them, is gone (the posting rebuild, 29 Sep 2026).
 */
const tomorrow = '2026-09-29T08:00:00.000Z'

describe('a post whose time went before the client said yes', () => {
  it('the client\'s link closes — on the page and on the server', () => {
    // the posting rebuild (29 Sep 2026): the post's own page reads the post's stage (portal-core clientPostView →
    // state 'missed', no buttons), and the route refuses a missed post before the one writer is asked
    // (tests/portal-post-review.test.ts runs both against a database)
    expect(readFileSync('app/lib/portal-core.ts', 'utf8')).toContain("if (slotMissed(post, now)) return view('missed'")
    const route = readFileSync('app/api/portal/act/route.ts', 'utf8')
    expect(route).toContain("view?.state === 'missed' ? view.headline : NOT_WITH_YOU }, { status: 409 }")
  })
  it('a send records the time it was for, so a new time needs a new send', () => {
    // the posting rebuild (29 Sep 2026): the send record is the post's own (client_send), written by the rules, not the route
    const core = readFileSync('app/lib/post-stage-core.ts', 'utf8')
    expect(core).toContain('approve_by: approveBy(when), for_time: when,')
    expect(core).toContain('ms(post.client_send?.for_time ?? post.scheduled_for)')
  })
})

describe('a post put to the client is waiting on the client, not "on you" (28 Sep 2026)', () => {
  it('Waiting on you and the board card say so, even to a super admin (the post’s own stage, 29 Sep 2026)', async () => {
    const { readPostState } = await import('../app/lib/post-stage-core')
    const { postWaitingRow } = await import('../app/lib/post-waiting-core')
    const { boardActions, postCardFace } = await import('../app/lib/post-board-core')
    const now = '2026-09-28T03:00:00.000Z'
    const post = readPostState({
      id: 'p11', client_id: 'j', stage: 'with_client', rev: 3, stage_at: '2026-09-28T02:40:00Z', created_by: 'sch',
      sent_version: 1, draft_version: 2, scheduled_for: tomorrow,
      qc_pass: { version: 1, by: 'joy', at: '2026-09-28T02:30:00Z' },
      client_send: { version: 1, at: '2026-09-28T02:40:00Z', to: ['jordan@x.au'], via: 'email', approve_by: null, for_time: tomorrow },
    })!
    const boss = { id: 'u', role: 'super_admin', quality_reviewer: false }
    const face = postCardFace(post, { now, today: '2026-09-28', clientName: 'Jordan Wilson' })
    const row = postWaitingRow(post, boss, now, { face })!
    expect(row.onYou).toBe(false)
    expect(face.waiting.who).toBe('client')
    // never Approve as the main button while the client has it (audit B7)
    expect(boardActions(post, ['sa'], now).primary).toBeNull()
  })
})

describe('approval without a time, and a link to send by hand (28 Sep 2026)', () => {
  it('the dialog copies the link, and the route opens the approval without emailing', () => {
    expect(readFileSync('app/dashboard/board/SendToClientDialog.tsx', 'utf8')).toContain("JSON.stringify({ copy: true })")
    const route = readFileSync('app/api/production/items/[id]/send-to-client/route.ts', 'utf8')
    expect(route).toContain('if (body.copy === true) {')
    expect(route).toContain("via: 'link'")
    const copyBlock = route.slice(route.indexOf('if (body.copy === true) {'), route.indexOf("return NextResponse.json({ link, message"))
    expect(copyBlock).not.toContain('notify(')
  })
})
