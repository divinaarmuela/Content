import { describe, expect, it } from 'vitest'
import type { PostStage, PostState, TransitionContext } from '../app/lib/post-stage-core'
import { postCardFace } from '../app/lib/post-board-core'
import {
  postOthersLabel, postWaitingRow, postWaitingRows, postWaitingTitle,
} from '../app/lib/post-waiting-core'

/**
 * WAITING ON YOU — the posts somebody is held up by, pinned (SPEC §4.2).
 *
 *   - a post the client (or Joy) asked to change is on the named person's list
 *     (audit B8: the old list never showed it);
 *   - a post with the client is the client's — shown, folded, never "on you"
 *     for the manager (audit W5), and never with Approve as its main button (B7);
 *   - a post with the quality check is on the reviewer;
 *   - a missed time is the manager's, with "Set a new time and resend" on it;
 *   - "since" is when the post entered its stage (B14).
 */

const NOW_MS = Date.parse('2026-09-29T00:00:00.000Z')
const NOW = new Date(NOW_MS).toISOString()
const at = (hours: number) => new Date(NOW_MS + hours * 3_600_000).toISOString()
const CTX: Omit<TransitionContext, 'now'> = {
  accounts: [{ id: 'acc-ig', platform: 'instagram', live: true }], clientHasContact: true,
}
const QC_PASS = { version: 1, by: 'u-joy', at: at(-2) }
const CLIENT_SEND = { version: 1, at: at(-20), to: ['jordan@example.invalid'], via: 'email' as const, approve_by: at(70), for_time: at(72) }

function post(stage: PostStage, over: Partial<PostState> = {}): PostState {
  return {
    id: `p-${stage}`, client_id: 'client-1', created_by: 'u-cath', stage, rev: 3, stage_at: at(-30),
    draft_version: stage === 'draft' ? 1 : 2, sent_version: stage === 'draft' ? null : 1,
    scheduled_for: at(72), timezone: 'Australia/Melbourne', channels: ['acc-ig'],
    slides: [{ url: 'https://media.mdmmarketing.com.au/t/1.png', name: '1.png', type: 'image' }], caption: 'A post', per_channel: {},
    approval_steps: null, approval: null, qc_pass: stage === 'with_client' || stage === 'ready' ? QC_PASS : null,
    changes_asked: null, client_send: stage === 'with_client' ? CLIENT_SEND : null,
    last_client_send: null, booking: null, outcomes: {}, problem: null, cancelled: null,
    assigned_to: null, source_item_id: null, source_deleted: false,
    ...over,
  }
}

const cath = { id: 'u-cath', role: 'scheduler' }
const joy = { id: 'u-joy', role: 'quality_checker' }
const am = { id: 'u-am', role: 'account_manager' }
const sa = { id: 'u-sa', role: 'super_admin' }
const opts = (p: PostState) => ({
  face: postCardFace(p, { now: NOW, today: '2026-09-29', clientName: 'Jordan Wilson', nameOf: (id: string | null | undefined) => (id === 'u-joy' ? 'Joy' : id === 'u-cath' ? 'Cath' : null) }),
  ctx: CTX,
})

describe('a change asked for is on the named person (audit B8)', () => {
  const asked = post('draft', {
    sent_version: 1, draft_version: 2,
    changes_asked: { version: 1, by: null, who: 'client', to: 'u-cath', note: 'Warmer colours', at: at(-3) },
  })

  it('is on Cath, with Send for quality check on the row', () => {
    const row = postWaitingRow(asked, cath, NOW, opts(asked))!
    expect(row.onYou).toBe(true)
    expect(row.face.changes).toBe('The client asked for a change: Warmer colours')
    expect(row.actions.map(a => a.action)).toEqual(['send_to_qc'])
  })

  it('is shown to everybody else as someone else’s, with nothing to press', () => {
    const row = postWaitingRow(asked, am, NOW, opts(asked))!
    expect(row.onYou).toBe(false)
    expect(row.actions).toEqual([])
  })

  it('a draft nobody sent and nobody asked about is not waiting on anybody', () => {
    expect(postWaitingRow(post('draft'), cath, NOW, opts(post('draft')))).toBeNull()
    expect(postWaitingRow(post('draft'), am, NOW, opts(post('draft')))).toBeNull()
  })
})

describe('the quality check', () => {
  const qc = post('quality_check')
  it('is on the reviewer, with Passed and Ask for a change on the row', () => {
    const row = postWaitingRow(qc, joy, NOW, opts(qc))!
    expect(row.onYou).toBe(true)
    expect(row.actions.map(a => a.action)).toEqual(['pass', 'ask_change'])
  })
  it('is not on an account manager who is not the reviewer (decision 3)', () => {
    const row = postWaitingRow(qc, am, NOW, opts(qc))!
    expect(row.onYou).toBe(false)
    expect(row.actions).toEqual([])
  })
})

describe('with the client', () => {
  const wc = post('with_client')
  it('is the client’s, even to a super admin — never "on you" (audit W5, B7)', () => {
    for (const v of [am, sa, cath]) {
      const row = postWaitingRow(wc, v, NOW, opts(wc))!
      expect(row.onYou).toBe(false)
      expect(row.face.waiting.who).toBe('client')
      expect(row.actions).toEqual([])
    }
  })
  it('once its time has gone it is the manager’s, with "Set a new time and resend"', () => {
    const missed = post('with_client', { client_send: { ...CLIENT_SEND, approve_by: at(-1) } })
    const row = postWaitingRow(missed, am, NOW, opts(missed))!
    expect(row.onYou).toBe(true)
    expect(row.face.missed).toMatch(/^Missed/)
    expect(row.actions[0].action).toBe('resend_new_time')
    expect(row.actions[0].label).toBe('Set a new time and resend')
  })
})

describe('Ready to post is the Schedule page’s queue', () => {
  it('is not listed here — unless it came back with a problem for this person', () => {
    expect(postWaitingRow(post('ready'), cath, NOW, opts(post('ready')))).toBeNull()
    const back = post('ready', { problem: 'Did not go out on Instagram.' })
    expect(postWaitingRow(back, cath, NOW, opts(back))?.onYou).toBe(true)
  })
  it('booked and posted posts are waiting on nobody', () => {
    for (const s of ['booked', 'posted', 'cancelled'] as PostStage[]) expect(postWaitingRow(post(s), sa, NOW, opts(post(s)))).toBeNull()
  })
})

describe('the list', () => {
  const posts = [
    post('with_client', { id: 'wc', stage_at: at(-50) }),
    post('quality_check', { id: 'qc-new', stage_at: at(-2) }),
    post('quality_check', { id: 'qc-old', stage_at: at(-40) }),
  ]
  const rows = postWaitingRows(posts, joy, NOW, opts)

  it('puts this person’s own first, longest wait at the top of each half', () => {
    expect(rows.map(r => r.id)).toEqual(['qc-old', 'qc-new', 'wc'])
  })
  it('its heading is the count', () => {
    expect(postWaitingTitle(rows)).toBe('2 waiting on you · 1 with someone else')
    expect(postWaitingTitle([])).toBe('Nothing is waiting')
    expect(postWaitingTitle(postWaitingRows([posts[0]], joy, NOW, opts))).toBe('1 waiting on someone else')
  })
  it('names the folded half by who actually holds it', () => {
    expect(postOthersLabel(rows.filter(r => !r.onYou))).toBe('1 more, with the client')
    expect(postOthersLabel(postWaitingRows([posts[1]], am, NOW, opts))).toBe('1 more, with the quality check')
    expect(postOthersLabel([])).toBe('')
  })
  it('"since" is when the post entered its stage, not the last touch (audit B14)', () => {
    expect(rows.find(r => r.id === 'wc')!.face.waiting.since).toBe(at(-50))
  })
})
