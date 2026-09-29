import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  clientMayNote, clientPostNotes, clientPostView, heroCounts, notesOnFile, pieceFace, pieceReachedClient,
  portalSections, portalWaitingPath, postLiveLinks, postsMissedByClient, postsWaitingOnClient, readFrozenPost,
  reviewFiles, type PortalPostNote,
} from '../app/lib/portal-core'
import { MISSED_FOR_CLIENT, readPostState, type PostState } from '../app/lib/post-stage-core'

/**
 * THE CLIENT'S SIDE OF A POST (the posting rebuild, 29 Sep 2026 — package P6;
 * SPEC §4.4, the owner's decisions 6, 8, 9, 11 and 15).
 *
 * What broke before (docs/posting-rebuild/AUDIT_EVIDENCE.md, portal):
 *   P2  the page read the post LIVE, so the client approved what was not sent
 *   P3  a client could approve a post only sent for the TEAM's approval
 *   P4  ?preview=1 showed internal posts to anyone with the link
 *   P5  a published post said "Approved — thank you. We'll book it in"
 *   P6  the team's yes read as the client's own
 *   P7  an unsent upload became the portal's hero backdrop
 *   P8  the whole payload, unsent media included, went to the browser
 *   P9  a post showed as waiting before anything reached the client
 *   P10 the edit's notes were pinned to the post's slides by index
 *   P13 "Thanks — we have your note" when the TEAM asked for the change
 * Every one is a test below.
 */

const NOW = '2026-09-29T00:00:00.000Z'
const IN = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString()
const u = (n: string) => `https://media.mdmmarketing.com.au/${n}`

/** a post as the rules read it, from a raw row */
function post(over: Record<string, unknown> = {}): PostState {
  const p = readPostState({
    id: 'p1', client_id: 'client-1', item_id: 'item-1', source_item_id: 'item-1', created_by: 'maker',
    stage: 'draft', rev: 3, stage_at: IN(-2), draft_version: 1, sent_version: null,
    scheduled_for: IN(48), timezone: 'Australia/Melbourne', channels: ['acc-ig'], per_channel: {},
    slides: [{ url: u('live.jpg'), name: 'live.jpg', type: 'image' }], caption: 'Working copy',
    ...over,
  })
  if (!p) throw new Error('bad fixture')
  return p
}
const send = (version: number, extra: Record<string, unknown> = {}) =>
  ({ version, at: IN(-1), to: ['jordan@x.au'], via: 'email', approve_by: IN(46), for_time: IN(48), ...extra })

describe('what the client sees of a post — from its stage, nothing else', () => {
  it('with them, sent, open: theirs to answer, on the version they were sent', () => {
    const v = clientPostView(post({ stage: 'with_client', sent_version: 2, draft_version: 3, client_send: send(2) }), NOW, { when: () => 'Tue 1 Oct, 6:00 pm' })!
    expect(v).toMatchObject({ state: 'review', version: 2, canAnswer: true, column: 'your_review', tone: 'amber' })
    expect(v.line).toBe('Please answer by Tue 1 Oct, 6:00 pm.')
  })

  it('at With client but nothing reached them: not theirs at all (P9)', () => {
    expect(clientPostView(post({ stage: 'with_client', sent_version: 1, client_send: null }), NOW)).toBeNull()
  })

  it('a send for an older version cannot be answered — only the version they were sent is (P2)', () => {
    const v = clientPostView(post({ stage: 'with_client', sent_version: 3, client_send: send(2) }), NOW)!
    expect(v.canAnswer).toBe(false)
  })

  it('its approve-by time gone: closed, with words, no buttons (decision 11)', () => {
    const p = post({ stage: 'with_client', sent_version: 1, client_send: send(1, { approve_by: IN(-0.5) }) })
    const v = clientPostView(p, NOW)!
    expect(v).toMatchObject({ state: 'missed', canAnswer: false, headline: MISSED_FOR_CLIENT })
    expect(postsMissedByClient([p], NOW)).toHaveLength(1)
    expect(postsWaitingOnClient([p], NOW)).toHaveLength(0)
  })

  it('a draft or a quality check they never had is not theirs to see (P3)', () => {
    expect(clientPostView(post({ stage: 'draft' }), NOW)).toBeNull()
    expect(clientPostView(post({ stage: 'quality_check', sent_version: 1 }), NOW)).toBeNull()
  })

  it('"Thanks — we have your note" only when the note was theirs; the team\'s change says so (P13)', () => {
    const theirs = post({ stage: 'draft', sent_version: 1, draft_version: 2, last_client_send: send(1), changes_asked: { version: 1, by: null, who: 'client', to: 'maker', note: 'Swap 2', at: NOW } })
    const team = post({ stage: 'draft', sent_version: 1, draft_version: 2, last_client_send: send(1), changes_asked: { version: 1, by: 'am', who: 'team', to: 'maker', note: 'Fix', at: NOW } })
    const taken = post({ stage: 'quality_check', sent_version: 2, last_client_send: send(1) })
    expect(clientPostView(theirs, NOW)).toMatchObject({ state: 'thanks', headline: 'Thanks — we have your note', version: 1, canAnswer: false })
    expect(clientPostView(team, NOW)).toMatchObject({ state: 'updating', headline: 'The team is updating this post' })
    expect(clientPostView(taken, NOW)).toMatchObject({ state: 'updating' })
  })

  it('their own yes, and a manager\'s yes for them, are told apart (decision 5, P6)', () => {
    const approval = (x: Record<string, unknown>) => ({ version: 1, by: 'am-1', hat: 'account_manager', on_behalf_of_client: false, agreed_via: null, note: null, at: NOW, ...x })
    const mine = post({ stage: 'booked', sent_version: 1, approval: approval({ by: null, hat: 'client' }), booking: { job_ids: ['j1'], pending: false, at: NOW, for_time: IN(48) } })
    const forMe = post({ stage: 'ready', sent_version: 1, approval: approval({ on_behalf_of_client: true, agreed_via: 'whatsapp' }), last_client_send: send(1) })
    const w = { when: () => 'Tue 1 Oct, 6:00 pm', nameOf: (id: string | null | undefined) => (id === 'am-1' ? 'Divina Grace' : null) }
    expect(clientPostView(mine, NOW, w)).toMatchObject({ state: 'you_approved', headline: 'You approved this', line: 'Goes out Tue 1 Oct, 6:00 pm.', column: 'approved', tone: 'blue' })
    const v = clientPostView(forMe, NOW, w)!
    expect(v).toMatchObject({ state: 'approved_for_you', headline: 'Approved by Divina for you', column: 'approved' })
    expect(v.headline).not.toMatch(/You approved|Client approved/)
  })

  it('approved by the team and never sent: not shown; after an earlier send: "the team approved this one" (decision 6)', () => {
    const pass = { version: 2, by: 'joy', hat: 'quality_reviewer', on_behalf_of_client: false, agreed_via: null, note: null, at: NOW }
    expect(clientPostView(post({ stage: 'ready', sent_version: 2, approval: pass }), NOW)).toBeNull()
    expect(clientPostView(post({ stage: 'ready', sent_version: 2, approval: pass, last_client_send: send(1) }), NOW))
      .toMatchObject({ state: 'team_decided', headline: 'The team approved this one', version: 2 })
  })

  it('posted: live on each network, with that network\'s own link; a network that failed is said plainly (P5, L1)', () => {
    const p = post({
      stage: 'posted', sent_version: 1, outcomes: {
        instagram: { status: 'published', url: 'https://instagram.com/p/abc', at: IN(-1), error: null },
        linkedin: { status: 'duplicate', url: 'https://linkedin.com/feed/1', at: IN(-1), error: null },
        tiktok: { status: 'failed', url: null, at: IN(-1), error: 'x' },
      },
    })
    const v = clientPostView(p, NOW)!
    expect(v).toMatchObject({ state: 'posted', headline: 'Live on Instagram and LinkedIn', line: 'Not out yet on TikTok.', column: 'posted' })
    expect(postLiveLinks(p)).toEqual([
      { platform: 'instagram', network: 'Instagram', url: 'https://instagram.com/p/abc' },
      { platform: 'linkedin', network: 'LinkedIn', url: 'https://linkedin.com/feed/1' },
    ])
    expect(v.headline).not.toMatch(/Approved|book/)
  })

  it('cancelled: only when they had seen it', () => {
    expect(clientPostView(post({ stage: 'cancelled', cancelled: { by: 'am', at: NOW, from_stage: 'draft', reason: null } }), NOW)).toBeNull()
    expect(clientPostView(post({ stage: 'cancelled', last_client_send: send(1) }), NOW)).toMatchObject({ state: 'cancelled', headline: 'This post was cancelled' })
  })

  it('the one list: open posts only, the soonest answer first (decision 15)', () => {
    const a = post({ id: 'a', stage: 'with_client', sent_version: 1, client_send: send(1, { approve_by: IN(30) }) })
    const b = post({ id: 'b', stage: 'with_client', sent_version: 1, client_send: send(1, { approve_by: IN(5) }) })
    const c = post({ id: 'c', stage: 'quality_check', sent_version: 1 })
    expect(postsWaitingOnClient([a, b, c], NOW).map(p => p.id)).toEqual(['b', 'a'])
    expect(portalWaitingPath('tok')).toBe('/portal/tok/posts')
  })
})

describe('the frozen version and its files (decision 8)', () => {
  it('reads a post_versions row; every file once — Instagram\'s own beside the shared ones (decision 10)', () => {
    const v = readFrozenPost({
      n: 2, caption: 'Frozen', scheduled_for: IN(48), timezone: 'Australia/Melbourne', frozen_for: 'client',
      slides: [{ url: u('a.jpg'), name: 'a', type: 'image' }, { url: u('b.jpg'), name: 'b', type: 'image' }],
      channels: { 0: 'acc-ig', 1: 'acc-li' },
      per_channel: { 'acc-ig': { kind: 'feed', slides: [{ url: u('a.jpg'), name: 'a', type: 'image' }, { url: u('c.mp4'), name: 'c', type: 'video' }] } },
    })!
    expect(v).toMatchObject({ n: 2, caption: 'Frozen', channels: ['acc-ig', 'acc-li'], from_migration: false })
    expect(reviewFiles(v).map(f => f.url)).toEqual([u('a.jpg'), u('b.jpg'), u('c.mp4')])
  })
})

describe('notes: per file, the Client thread only (decision 9, P10)', () => {
  const rows = [
    { id: 'n1', post_id: 'p1', version: 2, visibility: 'client', file_url: u('b.jpg'), body: 'Brighter', author_name: 'Jordan', author_role: 'client', created_at: '2' },
    { id: 'n2', post_id: 'p1', version: 2, visibility: 'team', file_url: u('b.jpg'), body: 'Internal: client is fussy', author_name: 'Joy', author_role: 'quality_checker', created_at: '1' },
    { id: 'n3', post_id: 'p1', version: 1, visibility: 'client', file_url: u('b.jpg'), body: 'old version', author_name: '', author_role: 'client', created_at: '0' },
    { id: 'n4', post_id: 'other', version: 2, visibility: 'client', file_url: null, body: 'another post', author_name: '', author_role: 'client', created_at: '3' },
    { id: 'n5', post_id: 'p1', version: 2, visibility: 'client', file_url: null, body: 'Love it', author_name: 'Divina', author_role: 'account_manager', created_at: '4' },
  ]
  it('never a team note, never another version\'s, never another post\'s', () => {
    const notes = clientPostNotes(rows, 'p1', 2, 'Jordan Wilson')
    expect(notes.map(n => n.id)).toEqual(['n1', 'n5'])
    expect(JSON.stringify(notes)).not.toContain('fussy')
    expect(notes[1]).toMatchObject({ from_team: true, author_name: 'Divina' })
  })
  it('a note belongs to its file by address, so a reorder cannot move it', () => {
    const notes = clientPostNotes(rows, 'p1', 2, 'Jordan') as PortalPostNote[]
    expect(notesOnFile(notes, u('b.jpg')).map(n => n.id)).toEqual(['n1'])
    expect(notesOnFile(notes, u('a.jpg'))).toEqual([])
  })
  it('a note may be left only while it is theirs to answer, only on a file it has', () => {
    const open = clientPostView(post({ stage: 'with_client', sent_version: 1, client_send: send(1) }), NOW)
    const done = clientPostView(post({ stage: 'posted', sent_version: 1 }), NOW)
    const files = [{ url: u('a.jpg') }]
    expect(clientMayNote(open, files, u('a.jpg'))).toBe(true)
    expect(clientMayNote(open, files, null)).toBe(true)
    expect(clientMayNote(open, files, u('zzz.jpg'))).toBe(false)
    expect(clientMayNote(done, files, u('a.jpg'))).toBe(false)
  })
})

describe('the edit\'s card, now that its posts speak for themselves', () => {
  it('media only once a piece reached the client (P7, P8)', () => {
    expect(pieceReachedClient({ status: 'approved_for_scheduling' })).toBe(false)
    expect(pieceReachedClient({ status: 'approved_for_scheduling', client_rounds: [1] })).toBe(true)
    expect(pieceReachedClient({ status: 'client_review' })).toBe(true)
    expect(pieceReachedClient({ status: 'quality_check' })).toBe(false)
  })
  it('past the edit, its posts are the cards; the edit card steps aside', () => {
    expect(pieceFace({}, 'published', 1, true)?.column).toBe('checking')
    expect(pieceFace({ client_rounds: [1] }, 'approved_for_scheduling', 0, true))
      .toEqual({ column: 'approved', tone: 'green', line: 'You approved this — the team is getting the post ready.' })
    expect(pieceFace({}, 'approved_for_scheduling', 0, false)?.column).toBe('checking')
    expect(pieceFace({ client_round: 1 }, 'scheduled', 0, false)).toBeNull()
    expect(pieceFace({}, 'client_review', 0, true)).toBeNull()
  })
  it('a post card counts in its section like a piece', () => {
    const cards = [
      { kind: 'post' as const, id: 'p', column: 'posted' as const, actions: { approve: false, askForChange: false, comment: false } },
      { kind: 'work' as const, id: 'w', column: 'approved' as const, actions: { approve: false, askForChange: false, comment: true } },
    ]
    expect(portalSections(cards).map(s => s.cards.length)).toEqual([0, 1, 1])
    expect(heroCounts(cards, [{ id: 'waiting' }])).toEqual({ review: 1, approved: 1, published: 1 })
  })
})

/* ── against a miniature database ──────────────────────────────────────── */

vi.mock('../app/lib/post-analytics', () => ({
  analyticsForItems: async () => new Map(),
  refreshStaleAnalyticsInBackground: vi.fn(),
}))
const clientActOnPost = vi.fn(async (_c: string, postId: string, req: { action: string }) =>
  ({ ok: true, post: { id: postId, rev: 9 }, stage: req.action === 'client_approve' ? 'ready' : 'draft', words: '' }))
vi.mock('../app/lib/post-stage', () => ({ clientActOnPost }))
vi.mock('../app/lib/workflow', () => ({ performTransition: vi.fn(), logActivity: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../app/lib/mailer', () => ({ notify: vi.fn(), renderEmail: (h: string, b: string) => `${h}${b}`, escapeHtml: (s: string) => s }))

const { getPortalData, portalViewData } = await import('../app/lib/portal-data')
const { getPortalPostPage } = await import('../app/lib/portal-thread')
const { POST } = await import('../app/api/portal/act/route')

const TOKEN = '3ae353c7-c879-4db7-bf71-dec9657d40e3'
const REAL_NOW = new Date()
const at = (hours: number) => new Date(REAL_NOW.getTime() + hours * 3_600_000).toISOString()
const liveSend = (version: number, extra: Record<string, unknown> = {}) =>
  ({ version, at: at(-1), to: ['jordan@x.au'], via: 'email', approve_by: at(40), for_time: at(48), ...extra })
const row = (id: string, over: Record<string, unknown>) => ({
  id, client_id: 'client-1', item_id: 'item-post', source_item_id: 'item-post', created_by: 'maker',
  stage: 'draft', rev: 2, stage_at: at(-2), draft_version: 1, sent_version: null, scheduled_for: at(48),
  timezone: 'Australia/Melbourne', channels: ['acc-ig'], per_channel: {}, status: 'draft', publish_job_ids: [],
  slides: [{ url: u('LIVE-EDIT.jpg'), name: 'live', type: 'image' }], caption: 'LIVE EDIT after the send',
  created_at: at(-3), updated_at: at(-1), ...over,
})
const version = (postId: string, n: number, caption: string, file: string) => ({
  id: `${postId}_v${n}`, post_id: postId, client_id: 'client-1', n, caption, scheduled_for: at(48),
  timezone: 'Australia/Melbourne', frozen_for: 'client', frozen_by: 'am', frozen_at: at(-1), from_migration: false,
  channels: ['acc-ig'], per_channel: {}, slides: [{ url: u(file), name: file, type: 'image' }],
})

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  clientActOnPost.mockClear()
  fake = seedDb({
    clients: [{ id: 'client-1', name: 'Jordan Wilson', share_token: TOKEN, timezone: 'Australia/Melbourne' }] as unknown as Row[],
    team_user_clients: [], monthly_commitments: [], client_brand: [], batches: [], schedule_entries: [],
    workflow_activity: [], item_comments: [], publish_jobs: [], intake_forms: [],
    team_users: [
      { id: 'portal-1', email: 'portal+client-1@mdmmarketing.com.au', name: 'Jordan (client portal)', role: 'client', active_status: false },
      { id: 'am-1', email: 'divina@x.au', name: 'Divina Grace', role: 'account_manager', active_status: true },
    ] as unknown as Row[],
    social_accounts: [{ id: 'acc-ig', client_id: 'client-1', platform: 'instagram', username: 'jordan', name: 'Jordan' }] as unknown as Row[],
    content_items: [
      { id: 'item-post', client_id: 'client-1', title: 'Jordan 11', status: 'approved_for_scheduling', content_type: 'carousel', updated_at: at(-1), adhoc_post: true },
      // an upload the team passed and never sent the client (the Alia case, P7)
      { id: 'item-unsent', client_id: 'client-1', title: 'alia is worn in layers', status: 'approved_for_scheduling', content_type: 'static', updated_at: at(0), adhoc_post: true },
    ] as unknown as Row[],
    asset_versions: [
      { id: 'av-1', item_id: 'item-unsent', version_number: 1, file_url: u('UNSENT-HERO.jpg'), files: [] },
    ] as unknown as Row[],
    social_posts: [
      row('p-waiting', { stage: 'with_client', sent_version: 1, draft_version: 2, client_send: liveSend(1) }),
      row('p-internal', { stage: 'quality_check', sent_version: 1, draft_version: 2, caption: 'INTERNAL ONLY' }),
      row('p-teamonly', { stage: 'ready', sent_version: 1, approval: { version: 1, by: 'joy', hat: 'quality_reviewer', on_behalf_of_client: false, at: at(-1) }, caption: 'TEAM ONLY' }),
      row('p-missed', { stage: 'with_client', sent_version: 1, client_send: liveSend(1, { approve_by: at(-0.2) }) }),
      row('p-live', {
        stage: 'posted', sent_version: 1,
        outcomes: { instagram: { status: 'published', url: 'https://instagram.com/p/live1', at: at(-5), error: null } },
      }),
      row('p-unmigrated', { stage: null, caption: 'NO STAGE YET' }),
    ] as unknown as Row[],
    post_versions: [
      version('p-waiting', 1, 'FROZEN CAPTION v1', 'FROZEN-1.jpg'),
      version('p-internal', 1, 'INTERNAL v1', 'INTERNAL-1.jpg'),
      version('p-teamonly', 1, 'TEAM v1', 'TEAM-1.jpg'),
      version('p-missed', 1, 'MISSED v1', 'MISSED-1.jpg'),
      version('p-live', 1, 'LIVE v1', 'LIVE-1.jpg'),
    ] as unknown as Row[],
    post_comments: [
      { id: 'c-team', post_id: 'p-waiting', client_id: 'client-1', version: 1, file_url: u('FROZEN-1.jpg'), visibility: 'team', author_name: 'Joy', author_role: 'quality_checker', body: 'TEAM NOTE', created_at: at(-1), updated_at: at(-1) },
      { id: 'c-client', post_id: 'p-waiting', client_id: 'client-1', version: 1, file_url: u('FROZEN-1.jpg'), visibility: 'client', author_name: 'Divina', author_role: 'account_manager', body: 'Here it is', created_at: at(-1), updated_at: at(-1) },
    ] as unknown as Row[],
    post_analytics: [],
  })
})
afterEach(() => fake.restore())

describe('the portal home (SPEC §4.4)', () => {
  it('lists only what is waiting on them — from the version they were sent (P2, P3, P9)', async () => {
    const data = (await getPortalData('client-1'))!
    expect(data.post_approvals.map(p => p.id)).toEqual(['p-waiting'])
    expect(data.post_approvals[0]).toMatchObject({ version: 1, caption: 'FROZEN CAPTION v1', title: 'Jordan 11', networks: ['Instagram'] })
    expect(data.posts_missed).toBe(1)
    const json = JSON.stringify(portalViewData(data))
    for (const secret of ['INTERNAL', 'TEAM ONLY', 'TEAM v1', 'LIVE EDIT', 'NO STAGE YET', 'p-internal', 'p-teamonly']) expect(json).not.toContain(secret)
  })

  it('a live post is a card in Published, with its own network link', async () => {
    const data = portalViewData((await getPortalData('client-1'))!)
    const card = data.cards.find(c => c.id === 'p-live')!
    expect(card).toMatchObject({ kind: 'post', column: 'posted', live_url: 'https://instagram.com/p/live1' })
    expect(card.post).toMatchObject({ state: 'posted', headline: 'Live on Instagram', networks: ['Instagram'] })
  })

  it('an upload nobody sent them carries no media, and cannot be the hero (P7, P8)', async () => {
    const full = (await getPortalData('client-1'))!
    expect(JSON.stringify(full.cards)).not.toContain('UNSENT-HERO')
    expect(JSON.stringify(portalViewData(full))).not.toContain('UNSENT-HERO')
    const page = readFileSync('app/portal/[token]/page.tsx', 'utf8')
    expect(page).toContain('const data = portalViewData(full)')
    expect(page).toContain('const hero = heroMedia(data)')
  })
})

describe('one post\'s page', () => {
  it('shows the frozen version, never the live working copy (P2, P11)', async () => {
    const page = (await getPortalPostPage(TOKEN, 'p-waiting'))!
    expect(page.caption).toBe('FROZEN CAPTION v1')
    expect(page.files.map(f => f.url)).toEqual([u('FROZEN-1.jpg')])
    expect(page.view).toMatchObject({ state: 'review', canAnswer: true })
    expect(page.version).toBe(1)
    expect(JSON.stringify(page)).not.toContain('LIVE EDIT')
  })
  it('carries the Client thread only — a team note never reaches it (decision 9)', async () => {
    const page = (await getPortalPostPage(TOKEN, 'p-waiting'))!
    expect(page.notes.map(n => n.body)).toEqual(['Here it is'])
    expect(JSON.stringify(page)).not.toContain('TEAM NOTE')
  })
  it('a post the client was never sent is not there — unless a signed-in team member previews it, with nothing to press (P3, P4)', async () => {
    expect(await getPortalPostPage(TOKEN, 'p-internal')).toBeNull()
    expect(await getPortalPostPage(TOKEN, 'p-teamonly')).toBeNull()
    expect(await getPortalPostPage(TOKEN, 'p-unmigrated')).toBeNull()
    const preview = (await getPortalPostPage(TOKEN, 'p-internal', { team: true }))!
    expect(preview).toMatchObject({ preview_mode: true, caption: 'INTERNAL v1' })
    expect(preview.view.canAnswer).toBe(false)
    const open = (await getPortalPostPage(TOKEN, 'p-waiting', { team: true }))!
    expect(open.view.canAnswer).toBe(false)
  })
  it('the share link has no preview switch at all — an address flag is not a sign-in (P4)', () => {
    // the token pages run without Clerk (middleware.ts), so nothing on them could check who is looking
    for (const f of ['app/portal/[token]/post/[id]/page.tsx', 'app/portal/[token]/approve/[id]/page.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/searchParams|preview === '1'/)
    }
    expect(readFileSync('app/portal/[token]/post/[id]/page.tsx', 'utf8')).toMatch(/const data = await getPortalPostPage\(raw, id\)\r?\n/)
    expect(readFileSync('middleware.ts', 'utf8')).not.toMatch(/'\/portal\/:path\*'/)
  })
  it('a published post reads Posted with its links, never "Approved — we\'ll book it in" (P5)', async () => {
    const page = (await getPortalPostPage(TOKEN, 'p-live'))!
    expect(page.view.headline).toBe('Live on Instagram')
    expect(page.links).toEqual([{ platform: 'instagram', network: 'Instagram', url: 'https://instagram.com/p/live1' }])
    expect(JSON.stringify(page)).not.toMatch(/book it in/i)
  })
  it('going to Instagram: this post first on the grid, before what is already live there (decision 16)', async () => {
    const page = (await getPortalPostPage(TOKEN, 'p-waiting'))!
    expect(page.grid?.map(g => g.url)).toEqual([u('FROZEN-1.jpg'), u('LIVE-EDIT.jpg')])
    // a live post has no grid to preview: it is on the grid
    expect((await getPortalPostPage(TOKEN, 'p-live'))!.grid).toBeNull()
  })
  it('a wrong token is nothing', async () => {
    expect(await getPortalPostPage('00000000-0000-4000-8000-000000000000', 'p-waiting')).toBeNull()
  })
})

describe('POST /api/portal/act — a post, answered by its id and the version seen', () => {
  const act = async (body: Record<string, unknown>) => {
    const res = await POST(new Request('https://x.test/api/portal/act', { method: 'POST', body: JSON.stringify({ token: TOKEN, ...body }) }))
    return { status: res.status, json: await res.json() as Record<string, unknown> }
  }

  it('approves the post that is with them, on the version they were sent', async () => {
    const r = await act({ post_id: 'p-waiting', version: 1, action: 'client_approve' })
    expect(r.status).toBe(200)
    expect(clientActOnPost).toHaveBeenCalledWith('client-1', 'p-waiting', { action: 'client_approve', version: 1, note: null })
  })

  it('refuses a post in quality check — it was never put to them (J8, V5, P3)', async () => {
    const r = await act({ post_id: 'p-internal', version: 1, action: 'client_approve' })
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('This one is not with you right now.')
    expect(clientActOnPost).not.toHaveBeenCalled()
  })

  it('refuses a stale version, and a closed one, in plain words', async () => {
    expect((await act({ post_id: 'p-waiting', version: 2, action: 'client_approve' })).status).toBe(409)
    const missed = await act({ post_id: 'p-missed', version: 1, action: 'client_approve' })
    expect(missed.status).toBe(409)
    expect(missed.json.error).toBe(MISSED_FOR_CLIENT)
    expect((await act({ post_id: 'p-waiting', action: 'client_approve' })).status).toBe(400)
    expect(clientActOnPost).not.toHaveBeenCalled()
  })

  it('asking for a change needs words; the words land in the Client thread once the move landed', async () => {
    expect((await act({ post_id: 'p-waiting', version: 1, action: 'client_ask_change' })).status).toBe(400)
    const r = await act({ post_id: 'p-waiting', version: 1, action: 'client_ask_change', note: 'Swap the second one', author_name: 'Jordan' })
    expect(r.status).toBe(200)
    const saved = fake.rows('post_comments').find(c => (c as { body?: string }).body === 'Swap the second one') as Record<string, unknown>
    expect(saved).toMatchObject({ post_id: 'p-waiting', version: 1, visibility: 'client', author_role: 'client', author_name: 'Jordan' })
    // on the whole post (the database drops a null, so absent is the same)
    expect(saved.file_url ?? null).toBeNull()
  })

  it('a note on one file of the version they were sent; never on a file it does not have', async () => {
    expect((await act({ post_id: 'p-waiting', version: 1, action: 'post_note', file_url: u('LIVE-EDIT.jpg'), note: 'x' })).status).toBe(409)
    const r = await act({ post_id: 'p-waiting', version: 1, action: 'post_note', file_url: u('FROZEN-1.jpg'), note: 'Brighter please' })
    expect(r.status).toBe(200)
    const saved = fake.rows('post_comments').find(c => (c as { body?: string }).body === 'Brighter please') as Record<string, unknown>
    expect(saved).toMatchObject({ file_url: u('FROZEN-1.jpg'), slide_index: 0, visibility: 'client', version: 1 })
    expect(clientActOnPost).not.toHaveBeenCalled()
  })

  it('another client\'s post is not found; the old item-id doors are shut', async () => {
    fake.restore()
    fake = seedDb({
      clients: [{ id: 'client-1', name: 'Jordan', share_token: TOKEN }] as unknown as Row[],
      social_posts: [row('p-other', { client_id: 'client-2', stage: 'with_client', sent_version: 1, client_send: liveSend(1) })] as unknown as Row[],
      content_items: [{ id: 'item-post', client_id: 'client-1', title: 'x', status: 'approved_for_scheduling' }] as unknown as Row[],
      team_users: [{ id: 'portal-1', email: 'portal+client-1@mdmmarketing.com.au', name: 'J', role: 'client', active_status: false }] as unknown as Row[],
    })
    expect((await act({ post_id: 'p-other', version: 1, action: 'client_approve' })).status).toBe(404)
    expect((await act({ item_id: 'item-post', action: 'approve_post' })).status).toBe(409)
    expect(clientActOnPost).not.toHaveBeenCalled()
  })
})

describe('source pins (SPEC §8.3)', () => {
  const MINE = [
    'app/lib/portal-core.ts', 'app/lib/portal-data.ts', 'app/lib/portal-thread.ts', 'app/lib/portal-post.ts',
    'app/api/portal/act/route.ts', 'app/portal/[token]/page.tsx', 'app/portal/[token]/post/[id]/page.tsx',
    'app/portal/[token]/approve/[id]/page.tsx', 'app/portal/[token]/posts/page.tsx',
    'app/components/portal/PortalPostReview.tsx', 'app/components/portal/PortalPostApproval.tsx',
    'app/components/portal/PortalPostCard.tsx', 'app/components/portal/ApprovePanel.tsx',
  ]
  it('the portal never reads the edit card\'s posting fields, nor the old posting gate', () => {
    for (const f of MINE) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/posting_approval_state|posting_client_required|client_sent|posting-approval|post-to-client-core/)
    }
  })
  it('nothing here writes a post\'s stage — the one writer does (P1\'s post-stage.ts)', () => {
    for (const f of MINE) expect(readFileSync(f, 'utf8'), f).not.toMatch(/stage:\s*'(ready|draft|with_client|booked|posted)'[^\n]*\bupdate\(|\.claim\([^)]*social_posts/)
    expect(readFileSync('app/api/portal/act/route.ts', 'utf8')).toContain('await clientActOnPost(client.id, post.id,')
  })
})
