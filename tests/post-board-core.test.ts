import { describe, expect, it } from 'vitest'
import {
  POST_APPROVAL_LANES, POST_STAGES, ROW_OF, STAGE_LABEL, MISSED_LABEL, hatsFor, laneOf, pageLaneOf, postActions, postTitle,
  type AccountRef, type PostHat, type PostStage, type PostState, type TransitionContext,
} from '../app/lib/post-stage-core'
import {
  FIRST_THE_CHECK, PAGE_ACTIONS, POSTED_DAYS_ON_BOARD, boardActions, cardNetworks, dropOnPostLane,
  groupPosts, laneFromAddress, makePostHref, offeredList, onBoard, pageOffers, postCardFace, postMoveTargets,
  postVisibleTo, postWindowHref, readyToBecomePosts, scheduleLink, sourcesWithLivePost,
} from '../app/lib/post-board-core'

/**
 * THE POST APPROVAL BOARD, pinned (SPEC §4.2; OWNER_DECISIONS 1, 3, 5).
 *
 * The rules these tests hold, each one a finding from the audit:
 *   - the lane a card is drawn in is its stage (B1, B11), and every button,
 *     Move entry and drop comes from the same `postActions` list (B1, B2, J9);
 *   - this page never books (decision 1);
 *   - a manager never gets Approve as the main button while the client has it (B7);
 *   - "Sent to client" only from a send of THIS version (B4, B16), who asked
 *     for a change from `changes_asked.who` (B6), "since" from `stage_at` (B14);
 *   - a manager's yes for the client says so, and how (decision 5, P6).
 */

const NOW_MS = Date.parse('2026-09-29T00:00:00.000Z')
const NOW = new Date(NOW_MS).toISOString()
const at = (hours: number) => new Date(NOW_MS + hours * 3_600_000).toISOString()
const img = (i: number) => ({ url: `https://media.mdmmarketing.com.au/test/${i}.png`, name: `${i}.png`, type: 'image' as const })
const ACCOUNTS: AccountRef[] = [
  { id: 'acc-ig', platform: 'instagram', live: true },
  { id: 'acc-li', platform: 'linkedin', live: true },
]
const CTX: Omit<TransitionContext, 'now'> = { accounts: ACCOUNTS, clientHasContact: true }
const QC_PASS = { version: 1, by: 'u-joy', at: at(-2) }
const TEAM_APPROVAL = { version: 1, by: 'u-joy', hat: 'quality_reviewer' as const, on_behalf_of_client: false, agreed_via: null, note: null, at: at(-2) }
const CLIENT_SEND = { version: 1, at: '2026-09-28T02:40:00.000Z', to: ['jordan@example.invalid'], via: 'email' as const, approve_by: at(70), for_time: at(72) }

function post(stage: PostStage, over: Partial<PostState> = {}): PostState {
  const base: PostState = {
    id: 'post-1', client_id: 'client-1', created_by: 'u-maker', stage, rev: 5, stage_at: at(-30),
    draft_version: 2, sent_version: 1,
    scheduled_for: at(72), timezone: 'Australia/Melbourne', channels: ['acc-ig', 'acc-li'],
    slides: [img(1), img(2)], caption: 'Where it started.\nSecond line.', per_channel: {},
    approval_steps: null, approval: null, qc_pass: null, changes_asked: null, client_send: null,
    last_client_send: null, booking: null, outcomes: {}, problem: null, cancelled: null,
    assigned_to: null, source_item_id: 'item-1', source_deleted: false,
  }
  const byStage: Partial<Record<PostStage, Partial<PostState>>> = {
    draft: { sent_version: null, draft_version: 1 },
    with_client: { qc_pass: QC_PASS, client_send: CLIENT_SEND },
    ready: { qc_pass: QC_PASS, approval: TEAM_APPROVAL },
    booked: { qc_pass: QC_PASS, approval: TEAM_APPROVAL, booking: { job_ids: ['j1'], pending: false, at: at(-1), for_time: at(72) } },
    posted: { qc_pass: QC_PASS, approval: TEAM_APPROVAL, outcomes: { instagram: { status: 'published', url: 'https://x.invalid/p', at: at(-1), error: null } } },
    cancelled: { cancelled: { by: 'u-am', at: at(-1), from_stage: 'ready', reason: null } },
  }
  return { ...base, ...byStage[stage], ...over }
}

const HATS: Record<string, PostHat[]> = {
  maker: ['creator', 'scheduler'],
  scheduler: ['scheduler'],
  am: ['am'],
  joy: ['qr'],
  amJoy: ['am', 'qr'],
  sa: ['sa'],
}
const names = (id: string | null | undefined) => ({ 'u-joy': 'Joy', 'u-akmal': 'Akmal', 'u-maker': 'Cath' } as Record<string, string>)[id ?? ''] ?? null

describe('the lanes', () => {
  it('are Draft, Quality check, With client, Approved — the owner’s decision 1', () => {
    expect(POST_APPROVAL_LANES.map(l => l.label)).toEqual(['Draft', 'Quality check', 'With client', 'Approved'])
  })

  it('a post sits in the lane that holds its stage — never a rewrite of it (audit B1, B11)', () => {
    const posts = (['draft', 'quality_check', 'with_client', 'ready', 'booked', 'posted'] as PostStage[])
      .map((s, i) => post(s, { id: `p${i}`, stage_at: at(-i) }))
    const grouped = groupPosts(posts)
    expect(grouped.map(g => g.lane.key)).toEqual(['draft', 'quality_check', 'with_client', 'approved'])
    for (const g of grouped) for (const p of g.posts) expect(g.lane.stages).toContain(laneOf(p))
    expect(grouped.find(g => g.lane.key === 'approved')!.posts.map(p => p.stage)).toEqual(['ready', 'booked', 'posted'])
    // every lane present, even empty ones; nothing lost
    expect(groupPosts([]).map(g => g.posts.length)).toEqual([0, 0, 0, 0])
    expect(grouped.reduce((n, g) => n + g.posts.length, 0)).toBe(posts.length)
  })

  it('oldest wait first in an approval lane', () => {
    const g = groupPosts([post('quality_check', { id: 'new', stage_at: at(-1) }), post('quality_check', { id: 'old', stage_at: at(-40) })])
    expect(g.find(x => x.lane.key === 'quality_check')!.posts.map(p => p.id)).toEqual(['old', 'new'])
  })

  it('cancelled posts are off the lanes; posted ones stay two weeks', () => {
    expect(onBoard(post('cancelled'), NOW)).toBe(false)
    expect(onBoard(post('posted', { stage_at: at(-24) }), NOW)).toBe(true)
    expect(onBoard(post('posted', { stage_at: at(-24 * (POSTED_DAYS_ON_BOARD + 1)) }), NOW)).toBe(false)
    expect(onBoard(post('posted', { stage_at: null }), NOW)).toBe(true)
    for (const s of ['draft', 'quality_check', 'with_client', 'ready', 'booked'] as PostStage[]) expect(onBoard(post(s, { stage_at: at(-9999) }), NOW)).toBe(true)
  })

  it('an address names a lane by its key, or by the old board’s column', () => {
    expect(laneFromAddress('with_client')).toBe('with_client')
    expect(laneFromAddress('approved')).toBe('approved')
    expect(laneFromAddress('ready_to_post')).toBe('approved')
    expect(laneFromAddress('posted')).toBe('approved')
    expect(laneFromAddress('nonsense')).toBeNull()
    expect(laneFromAddress(null)).toBeNull()
  })
})

describe('what this page offers', () => {
  it('never books, moves a time or posts now — that is the Schedule page (decision 1)', () => {
    const offered = new Set(Object.values(PAGE_ACTIONS).flat())
    for (const a of ['book', 'post_now', 'change_time', 'unbook', 'edit_booked', 'missing_networks', 'save'] as const) {
      expect(offered.has(a), a).toBe(false)
    }
    // and nothing on a booked or posted post
    expect(PAGE_ACTIONS.booked).toBeUndefined()
    expect(PAGE_ACTIONS.posted).toBeUndefined()
  })

  it('every move it offers is a real row from that stage (a button is a move the server accepts)', () => {
    for (const [stage, actions] of Object.entries(PAGE_ACTIONS)) {
      for (const a of actions!) expect(ROW_OF[a].from, `${stage}/${a}`).toContain(stage)
    }
  })

  it('narrows postActions and never promotes a move it did not choose', () => {
    for (const stage of POST_STAGES) for (const hats of Object.values(HATS)) {
      const p = post(stage)
      const all = postActions(p, hats, NOW, CTX)
      const mine = boardActions(p, hats, NOW, CTX)
      for (const a of offeredList(mine)) {
        expect(offeredList(all).map(x => x.action)).toContain(a.action)
        expect(pageOffers(stage, a.action)).toBe(true)
      }
      if (mine.primary) expect(mine.primary).toEqual(all.primary)
    }
  })

  it('a Ready post has no Book button here; its way forward is the Schedule page', () => {
    const p = post('ready')
    for (const hats of [HATS.scheduler, HATS.am, HATS.sa]) {
      const list = boardActions(p, hats, NOW, CTX)
      expect(list.primary).toBeNull()
      expect(offeredList(list).map(a => a.action)).not.toContain('book')
    }
    expect(scheduleLink(p, '/dashboard/social/schedule')).toEqual({ label: 'Book it on Schedule', href: '/dashboard/social/schedule?client=client-1&post=post-1' })
    expect(scheduleLink(post('booked'), '/s')?.label).toBe('See it on Schedule')
    expect(scheduleLink(post('draft'), '/s')).toBeNull()
  })

  it('the quality checker passes or asks for a change; a manager who is not the checker cannot pass (decision 3)', () => {
    const p = post('quality_check')
    const joy = boardActions(p, HATS.joy, NOW, CTX)
    expect(joy.primary?.action).toBe('pass')
    expect(offeredList(joy).map(a => a.action)).toEqual(expect.arrayContaining(['pass', 'pass_send_client', 'ask_change']))
    const am = boardActions(p, HATS.am, NOW, CTX)
    expect(offeredList(am).map(a => a.action)).not.toContain('pass')
    expect(offeredList(am).map(a => a.action)).not.toContain('pass_send_client')
    expect(offeredList(am).map(a => a.action)).toContain('ask_change')
    // an account manager who also holds the quality hat may pass
    expect(offeredList(boardActions(p, HATS.amJoy, NOW, CTX)).map(a => a.action)).toContain('pass')
  })

  it('team then the client: the checker’s main button is "Passed — send to client"', () => {
    const p = post('quality_check', { approval_steps: 'team_then_client' })
    const joy = boardActions(p, HATS.joy, NOW, CTX)
    expect(joy.primary?.action).toBe('pass_send_client')
    expect(joy.primary?.label).toBe('Passed — send to client')
    expect(offeredList(joy).map(a => a.action)).not.toContain('pass')
  })

  it('with the client, a manager never gets Approve as the main button (audit B7)', () => {
    const p = post('with_client')
    for (const hats of [HATS.am, HATS.sa]) {
      const list = boardActions(p, hats, NOW, CTX)
      expect(list.primary).toBeNull()
      const approve = offeredList(list).find(a => a.action === 'approve_for_client')!
      expect(approve.label).toBe('Approve for the client')
      expect(approve.needs).toEqual(expect.arrayContaining(['agreed_via']))
    }
    // a scheduler cannot approve for the client at all
    expect(offeredList(boardActions(p, HATS.scheduler, NOW, CTX)).map(a => a.action)).not.toContain('approve_for_client')
  })

  it('with the client and its time gone: "Set a new time and resend" is the manager’s main button', () => {
    const p = post('with_client', { client_send: { ...CLIENT_SEND, approve_by: at(-1) } })
    expect(boardActions(p, HATS.am, NOW, CTX).primary?.action).toBe('resend_new_time')
    expect(boardActions(p, HATS.am, NOW, CTX).primary?.label).toBe('Set a new time and resend')
  })

  it('a draft that was never sent offers Delete draft; one that was offers Cancel post', () => {
    expect(boardActions(post('draft'), HATS.maker, NOW, CTX).danger?.action).toBe('delete_draft')
    expect(boardActions(post('draft', { sent_version: 1, draft_version: 2 }), HATS.maker, NOW, CTX).danger?.action).toBe('cancel')
  })

  it('a stopped button stays, with the rule’s reason beside it (a draft with no time)', () => {
    const list = boardActions(post('draft', { scheduled_for: null }), HATS.maker, NOW, CTX)
    // not the filled button while it cannot go — but drawn, first, with why
    expect(list.primary).toBeNull()
    expect(list.secondary[0].action).toBe('send_to_qc')
    expect(list.secondary[0].blocked).toBe('Pick a time — this post has none')
  })

  it('a cancelled post has a way back (audit W2, V3)', () => {
    expect(offeredList(boardActions(post('cancelled'), HATS.scheduler, NOW, CTX)).map(a => a.action)).toContain('rebook')
  })

  it('no dead ends on this page: every approval stage has a way forward for the people who own it', () => {
    const cases: [PostStage, PostHat[]][] = [
      ['draft', HATS.maker], ['quality_check', HATS.joy], ['with_client', HATS.am], ['cancelled', HATS.scheduler],
    ]
    for (const [stage, hats] of cases) {
      expect(offeredList(boardActions(post(stage), hats, NOW, CTX)).some(a => !a.blocked), stage).toBe(true)
    }
    // an approved post's way forward is the Schedule page
    for (const s of ['ready', 'booked', 'posted'] as PostStage[]) expect(scheduleLink(post(s), '/s')).not.toBeNull()
  })

  it('never offers the client’s or the app’s own moves to the team', () => {
    for (const stage of POST_STAGES) for (const hats of Object.values(HATS)) {
      for (const a of offeredList(boardActions(post(stage), hats, NOW, CTX))) {
        expect(ROW_OF[a.action].who).not.toContain('client')
        expect(ROW_OF[a.action].who).not.toContain('system')
      }
    }
  })
})

describe('a drop onto a lane is a button, or the rule’s own reason (audit B1, J9)', () => {
  it('dropping where it already is says so', () => {
    expect(dropOnPostLane(post('quality_check'), 'quality_check', HATS.joy, NOW, CTX)).toEqual({ ok: false, reason: 'Already in Quality check' })
    expect(dropOnPostLane(post('booked'), 'approved', HATS.sa, NOW, CTX)).toEqual({ ok: false, reason: 'Already in Approved' })
  })

  it('a draft onto Quality check is Send for quality check', () => {
    const d = dropOnPostLane(post('draft'), 'quality_check', HATS.maker, NOW, CTX)
    expect(d.ok && d.action.action).toBe('send_to_qc')
  })

  it('a draft onto With client or Approved is refused: the check comes first (decision 3)', () => {
    expect(dropOnPostLane(post('draft'), 'with_client', HATS.sa, NOW, CTX)).toEqual({ ok: false, reason: FIRST_THE_CHECK })
    expect(dropOnPostLane(post('draft'), 'approved', HATS.am, NOW, CTX)).toEqual({ ok: false, reason: FIRST_THE_CHECK })
  })

  it('the checker drops onto Approved to pass it, onto With client to pass and send, onto Draft to ask for a change', () => {
    const p = post('quality_check')
    expect(dropOnPostLane(p, 'approved', HATS.joy, NOW, CTX)).toMatchObject({ ok: true, action: { action: 'pass' } })
    expect(dropOnPostLane(p, 'with_client', HATS.joy, NOW, CTX)).toMatchObject({ ok: true, action: { action: 'pass_send_client' } })
    expect(dropOnPostLane(p, 'draft', HATS.joy, NOW, CTX)).toMatchObject({ ok: true, action: { action: 'ask_change', needs: expect.arrayContaining(['note']) } })
  })

  it('a manager who is not the checker cannot pass by dragging either', () => {
    const d = dropOnPostLane(post('quality_check'), 'approved', HATS.am, NOW, CTX)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/^Only .*quality checker/)
  })

  it('a With client post dragged onto Approved: a scheduler is told why not; a manager gets the question', () => {
    const p = post('with_client')
    const sch = dropOnPostLane(p, 'approved', HATS.scheduler, NOW, CTX)
    expect(sch.ok).toBe(false)
    if (!sch.ok) expect(sch.reason).toMatch(/^Only an account manager or a super admin/)
    expect(dropOnPostLane(p, 'approved', HATS.am, NOW, CTX)).toMatchObject({ ok: true, action: { action: 'approve_for_client' } })
  })

  it('a booked post dragged back to Draft is the Schedule page’s move', () => {
    const d = dropOnPostLane(post('booked'), 'draft', HATS.scheduler, NOW, CTX)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/Schedule page/)
  })

  it('the Move menu is exactly the drops that would work', () => {
    for (const stage of POST_STAGES) for (const hats of Object.values(HATS)) {
      const p = post(stage)
      const moves = postMoveTargets(p, hats, NOW, CTX)
      for (const lane of POST_APPROVAL_LANES) {
        const d = dropOnPostLane(p, lane.key, hats, NOW, CTX)
        expect(moves.some(m => m.lane === lane.key), `${stage}/${hats}/${lane.key}`).toBe(d.ok)
      }
      for (const m of moves) {
        expect(m.label).toBe(`Move to ${POST_APPROVAL_LANES.find(l => l.key === m.lane)!.label} — ${m.action.label}`)
        // and the lane it lands in is the one it is filed under
        const to = ROW_OF[m.action.action].to
        expect(pageLaneOf(POST_APPROVAL_LANES, to === 'same' || to === 'deleted' ? p.stage : to)).toBe(m.lane)
      }
    }
  })
})

describe('the face of a card — facts only', () => {
  const opts = { now: NOW, today: '2026-09-29', clientName: 'Jordan Wilson', nameOf: names }

  it('draws its stage chip, from the one list of words', () => {
    for (const s of POST_STAGES) expect(postCardFace(post(s), opts).stage.label).toBe(STAGE_LABEL[s])
  })

  it('"Sent to client" only from a send of THIS version, only while it is with the client (audit B4, B16)', () => {
    const sent = postCardFace(post('with_client'), opts)
    expect(sent.sent).toMatch(/^Emailed to jordan@example\.invalid · Mon,? 28 Sep/)
    // a send of an older version is history, not a fact about this card
    expect(postCardFace(post('with_client', { client_send: { ...CLIENT_SEND, version: 0 } }), opts).sent).toBeNull()
    // approved without the client ever seeing it: no send line at all
    expect(postCardFace(post('ready'), opts).sent).toBeNull()
    expect(postCardFace(post('posted'), opts).sent).toBeNull()
    // a copied link says so
    expect(postCardFace(post('with_client', { client_send: { ...CLIENT_SEND, via: 'link', to: [] } }), opts).sent).toMatch(/^Link shared with the client/)
  })

  it('names who asked for a change, from the record (audit B6, P13)', () => {
    const team = postCardFace(post('draft', { changes_asked: { version: 1, by: 'u-joy', who: 'team', to: 'u-maker', note: 'Crop slide 2', at: at(-1) } }), opts)
    expect(team.changes).toBe('Joy asked for a change: Crop slide 2')
    const client = postCardFace(post('draft', { changes_asked: { version: 1, by: null, who: 'client', to: 'u-maker', note: 'Warmer colours', at: at(-1) } }), opts)
    expect(client.changes).toBe('The client asked for a change: Warmer colours')
    expect(client.waiting.line).toMatch(/^The client asked for a change — Cath to make it$/)
  })

  it('a manager’s yes for the client says so, and how — never "Client approved" (decision 5, P6)', () => {
    const approval = { version: 1, by: 'u-akmal', hat: 'account_manager' as const, on_behalf_of_client: true, agreed_via: 'whatsapp' as const, note: null, at: at(-1) }
    const face = postCardFace(post('ready', { approval }), opts)
    expect(face.approval).toBe('Approved by Akmal for the client — on WhatsApp')
    expect(face.approval).not.toMatch(/Client approved/)
    expect(postCardFace(post('ready', { approval: { ...approval, hat: 'client', on_behalf_of_client: false, by: null } }), opts).approval).toBe('Approved by the client')
    expect(postCardFace(post('ready'), opts).approval).toBe('Passed quality check — Joy')
    // an approval of an older version is not this version's
    expect(postCardFace(post('ready', { approval: { ...approval, version: 0 } }), opts).approval).toBeNull()
  })

  it('"since" is when it entered its stage (audit B14)', () => {
    expect(postCardFace(post('quality_check', { stage_at: at(-1) }), opts).waiting.sinceWords).toBe('since today') // 9 am in Melbourne
    expect(postCardFace(post('quality_check', { stage_at: at(-30) }), opts).waiting.sinceWords).toBe('since yesterday')
    expect(postCardFace(post('quality_check', { stage_at: '2026-09-20T02:00:00.000Z' }), opts).waiting.sinceWords).toBe('since 20 Sep')
    expect(postCardFace(post('quality_check', { stage_at: null }), opts).waiting.sinceWords).toBeNull()
  })

  it('a missed time is shown, and the card turns red (decision 11)', () => {
    const face = postCardFace(post('with_client', { client_send: { ...CLIENT_SEND, approve_by: at(-1) } }), opts)
    expect(face.missed).toBe(MISSED_LABEL)
    expect(face.tone).toBe('red')
    expect(postCardFace(post('with_client'), opts).missed).toBeNull()
  })

  it('every network, once each, by its logo name (audit S14)', () => {
    const platformOf = (id: string) => ({ 'acc-ig': 'instagram', 'acc-li': 'linkedin', 'acc-ig2': 'instagram' } as Record<string, string>)[id] ?? null
    expect(cardNetworks({ channels: ['acc-ig', 'acc-li', 'acc-ig2'] }, platformOf).map(n => n.platform)).toEqual(['instagram', 'linkedin'])
    expect(cardNetworks({ channels: ['gone'] }, platformOf)).toEqual([{ platform: 'unknown', label: 'A channel that is not connected' }])
    expect(postCardFace(post('draft'), { ...opts, platformOf }).networks.map(n => n.label)).toEqual(['Instagram', 'LinkedIn'])
  })

  it('a post whose card was deleted still shows, and says so (audit S9)', () => {
    expect(postCardFace(post('ready', { source_deleted: true }), opts).problem).toBe('The card it came from was deleted.')
  })

  it('a title from its edit, else its caption’s first line', () => {
    expect(postTitle({ caption: 'x' }, 'Jordan 1')).toBe('Jordan 1')
    expect(postTitle({ caption: '\n  First line\nsecond' })).toBe('First line')
    expect(postTitle({ caption: '' })).toBe('Untitled post')
    expect(postTitle({ caption: 'a'.repeat(80) }).length).toBeLessThanOrEqual(58)
  })

  it('shows the approval steps while it is being approved, and the version with the reviewer', () => {
    expect(postCardFace(post('quality_check'), { ...opts, client: { client_approval_required: true } }).steps).toBe('Team, then the client')
    expect(postCardFace(post('quality_check'), opts).steps).toBe('Team only')
    expect(postCardFace(post('ready'), opts).steps).toBeNull()
    expect(postCardFace(post('quality_check'), opts).version).toBe('Version 1')
    expect(postCardFace(post('draft'), opts).version).toBeNull()
  })
})

describe('who sees a post on the board', () => {
  const assignments = [{ team_user_id: 'u-am', client_id: 'client-1' }]
  it('schedulers, general users and super admins see every client', () => {
    for (const role of ['scheduler', 'general', 'super_admin']) expect(postVisibleTo(post('draft', { client_id: 'other' }), { id: 'x', role }, assignments)).toBe(true)
  })
  it('an account manager sees their clients — and only them, as the act route allows (review fix)', () => {
    const am = { id: 'u-am', role: 'account_manager' }
    expect(postVisibleTo(post('draft'), am, assignments)).toBe(true)
    expect(postVisibleTo(post('draft', { client_id: 'other' }), am, assignments)).toBe(false)
    // named on a post of a client they are not on: the server refuses every press, so the board does
    // not draw it either (a card that offers what the server refuses is the bug being fixed)
    expect(postVisibleTo(post('draft', { client_id: 'other', assigned_to: 'u-am' }), am, assignments)).toBe(false)
  })
  it('the quality checker sees every post waiting on the check, whoever’s client', () => {
    const joy = { id: 'u-joy', role: 'editor', quality_reviewer: true }
    expect(postVisibleTo(post('quality_check', { client_id: 'other' }), joy, [])).toBe(true)
    expect(postVisibleTo(post('ready', { client_id: 'other' }), joy, [])).toBe(false)
  })
  it('a client never sees the team’s board', () => {
    expect(postVisibleTo(post('with_client'), { id: 'c', role: 'client' }, assignments)).toBe(false)
  })
  it('the hats come from the post-stage rules, so an editor has none here (decision 7)', () => {
    expect(hatsFor({ id: 'e', role: 'editor' }, post('draft'))).toEqual([])
  })
})

describe('edits ready to become posts — a tray, not a lane (audit B3, L5)', () => {
  const edit = (over: Record<string, unknown> = {}) => ({ id: 'i1', client_id: 'c1', status: 'approved_for_scheduling', ...over })
  it('an approved edit with no live post is listed', () => {
    expect(readyToBecomePosts([edit()], new Set()).map(i => i.id)).toEqual(['i1'])
    expect(readyToBecomePosts([edit()], new Set(['i1']))).toEqual([])
  })
  it('a handed-over edit the hand-over put back at Draft is listed; one being revised is not', () => {
    expect(readyToBecomePosts([edit({ status: 'draft_uploaded', scheduler_ids: ['s1'] })], new Set())).toHaveLength(1)
    expect(readyToBecomePosts([edit({ status: 'revision_required', scheduler_ids: ['s1'] })], new Set())).toEqual([])
    expect(readyToBecomePosts([edit({ status: 'draft_uploaded' })], new Set())).toEqual([])
  })
  it('never an upload made on Schedule, a shoot plan, or a piece the client posts (audit V13)', () => {
    expect(readyToBecomePosts([edit({ adhoc_post: true })], new Set())).toEqual([])
    expect(readyToBecomePosts([edit({ work_kinds: { slug: 'shoot_brief' } })], new Set())).toEqual([])
    expect(readyToBecomePosts([edit({ deliver_only: true })], new Set())).toEqual([])
    expect(readyToBecomePosts([edit({ clients: { posts_own_content: true } })], new Set())).toEqual([])
  })
  it('a cancelled post does not count as live; a row not yet given a stage counts as live, whatever else it says', () => {
    const rows = [
      { id: 'p1', source_item_id: 'a', stage: 'cancelled' },
      { id: 'p2', source_item_id: 'b', stage: 'draft' },
      { id: 'p3', item_id: 'c', status: 'pending' },
      { id: 'p4', item_id: 'd', status: 'cancelled' },
    ]
    expect([...sourcesWithLivePost(rows)].sort()).toEqual(['b', 'c', 'd'])
  })
  it('Make a post opens the composer on the piece; a card opens the post window', () => {
    expect(makePostHref({ id: 'i 1', client_id: 'c1' }, '/dashboard/social/schedule')).toBe('/dashboard/social/schedule?client=c1&item=i%201')
    expect(postWindowHref({ id: 'p1', client_id: 'c1' }, '/dashboard/social/schedule')).toBe('/dashboard/social/schedule?client=c1&post=p1')
  })
})

describe('a posted card says it went out (live test, 29 Sep 2026)', () => {
  it('Went out once posted, Was planned once cancelled, Goes out before', async () => {
    const { readFileSync } = await import('node:fs')
    const core = readFileSync('app/lib/post-board-core.ts', 'utf8')
    expect(core).toContain("whenWord: post.stage === 'posted' ? 'Went out' : post.stage === 'cancelled' ? 'Was planned' : 'Goes out',")
    expect(readFileSync('app/dashboard/scheduler/board/PostCard.tsx', 'utf8')).toContain('{face.whenWord} {face.when}')
  })
})

describe('Schedule it on the Post approval board (a super admin, 29 Sep 2026)', () => {
  it('is a card button for a super admin on Draft and Quality check — never the main one, never for anyone else', () => {
    expect(PAGE_ACTIONS.draft).toContain('schedule_direct')
    expect(PAGE_ACTIONS.quality_check).toContain('schedule_direct')
    for (const stage of ['draft', 'quality_check'] as PostStage[]) {
      const sa = boardActions(post(stage), HATS.sa, NOW, CTX)
      const offered = offeredList(sa).find(a => a.action === 'schedule_direct')
      expect(offered, stage).toMatchObject({ label: 'Schedule it', blocked: null, needs: ['time'] })
      expect(sa.primary?.action).not.toBe('schedule_direct')
      for (const [name, hats] of Object.entries(HATS)) {
        if (hats.includes('sa')) continue
        expect(offeredList(boardActions(post(stage), hats, NOW, CTX)).map(a => a.action), `${stage} ${name}`).not.toContain('schedule_direct')
      }
    }
  })
})
