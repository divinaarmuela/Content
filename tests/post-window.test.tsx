import { existsSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { postActions, hatsFor, readPostState, type PostState } from '@/app/lib/post-stage-core'
import { TEAM_ACT_ACTIONS } from '@/app/lib/post-act-contract'
import type { PostWindowApi } from '@/app/lib/post-window-core'

/**
 * THE POST WINDOW, DRAWN (package P3, 29 Sep 2026).
 *
 * The window is rendered to HTML with the live database, the viewer and the
 * heavy children mocked — and the server (package P1) replaced by a fake that
 * fails the test if it is ever called, because drawing a window must never
 * move a post. What is pinned: the top says the post's own stage; the footer
 * is exactly `postActions` for this viewer, in order, with nothing the team
 * may not press; the middle is read-only once the post is sent; Instagram's
 * eleventh brings the three choices; notes default to the Team thread; and
 * the fixes the audit asked for are in the source (W1 focus, W6 no review
 * mode, W10 no second client send).
 */

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, Record<string, unknown>>>,
  me: null as null | { id: string; role: string; name: string; quality_reviewer?: boolean },
}))

vi.mock('@/lib/db-client', () => ({
  useRow: (name: string, id: string | null | undefined) => ({ row: id ? h.rows[name]?.[id] ?? null : null, loading: false, error: null }),
  useTable: (name: string) => ({ rows: Object.values(h.rows[name] ?? {}), loading: false, error: null }),
}))
vi.mock('@/app/dashboard/useRole', () => ({ useRole: () => ({ me: h.me, can: () => true, loading: false }) }))
vi.mock('@/app/dashboard/production/workHooks', () => ({ useTeamMembers: () => [] }))
vi.mock('@/app/dashboard/social/schedule/Tour', () => ({ default: () => null, useTourOnce: () => ({ open: false, close: () => {} }) }))
vi.mock('@/app/dashboard/social/schedule/CoverPicker', () => ({ default: () => null }))
vi.mock('@/app/dashboard/social/schedule/MediaPicker', () => ({ default: () => null }))
vi.mock('@/app/dashboard/social/AssetCheck', () => ({ default: () => null }))
vi.mock('@/app/components/social/PostPreview', () => ({ default: () => null }))
vi.mock('@/app/dashboard/social/usePlayable', () => ({ usePlayable: () => (u: string) => u }))
vi.mock('@/app/lib/measure-media-client', () => ({ isMeasured: () => true, measureUrl: async () => ({}) }))

const { default: PostWindow } = await import('@/app/dashboard/social/schedule/PostWindow')

const NOW = Date.now()
const inHours = (n: number) => new Date(NOW + n * 3600_000).toISOString()
const img = (n: number) => ({ url: `https://files.example.test/${n}.jpg`, name: `${n}.jpg`, type: 'image' })
const imgs = (n: number) => Array.from({ length: n }, (_, i) => img(i + 1))

const ACCOUNTS = [
  { id: 'ig', client_id: 'c1', platform: 'instagram', provider_account_id: 'x', name: 'Cafe', username: 'cafe', avatar_url: null, active: true, connected_at: '', last_synced_at: '', health: null, contact_id: null },
  { id: 'li', client_id: 'c1', platform: 'linkedin', provider_account_id: 'y', name: 'Cafe Co', username: null, avatar_url: null, active: true, connected_at: '', last_synced_at: '', health: null, contact_id: null },
]
const CONTEXT = {
  clientId: 'c1', tz: 'Australia/Melbourne',
  client: { name: 'Cafe', email: 'owner@cafe.test', client_approval_required: false },
  accounts: ACCOUNTS as never, contacts: [], locations: [], suggested: [],
}

const APPROVED = { version: 1, by: 'joy', hat: 'quality_reviewer', on_behalf_of_client: false, agreed_via: null, note: null, at: inHours(-1) }

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1', client_id: 'c1', item_id: 'item1', source_item_id: 'item1', created_by: 'maker',
    stage: 'draft', rev: 4, stage_at: inHours(-2), draft_version: 1, sent_version: null,
    slides: imgs(2), caption: 'Hello there', channels: ['ig'], per_channel: {}, scheduled_for: inHours(24), timezone: 'Australia/Melbourne',
    approval_steps: null, approval: null, qc_pass: null, changes_asked: null, client_send: null, last_client_send: null,
    booking: null, outcomes: {}, problem: null, cancelled: null, assigned_to: null, source_deleted: false,
    ...over,
  }
}

/** A server that must never be reached by drawing. */
const NO_SERVER: PostWindowApi = {
  create: () => { throw new Error('create was called while drawing') },
  save: () => { throw new Error('save was called while drawing') },
  act: () => { throw new Error('act was called while drawing') },
}

function draw(postRow: Record<string, unknown> | null, me: NonNullable<typeof h.me>, extra: Record<string, Record<string, Record<string, unknown>>> = {}) {
  h.me = me
  h.rows = { social_posts: postRow ? { [String(postRow.id)]: postRow } : {}, ...extra }
  return renderToStaticMarkup(
    <PostWindow postId={postRow ? String(postRow.id) : null} context={CONTEXT} onClose={() => {}} api={NO_SERVER}
      seed={postRow ? null : { itemId: 'item1', title: 'Menu carousel', slides: imgs(3) as never, pieceFiles: imgs(3) as never, versionNumber: 1, coverUrl: null, at: inHours(30) }} />,
  )
}

/** The footer's buttons, in the order drawn. */
const actionsIn = (html: string) => [...html.matchAll(/data-action="([a-z_]+)" data-kind="([a-z]+)"/g)].map(m => [m[1], m[2]])

/** What `postActions` says this viewer gets — the list the window must draw as it is. */
function expected(r: Record<string, unknown>, me: NonNullable<typeof h.me>) {
  const p = readPostState(r) as PostState
  const list = postActions(p, hatsFor(me, p), NOW, {
    accounts: ACCOUNTS.map(a => ({ id: a.id, platform: a.platform, live: a.active, name: a.username ?? a.name })),
    client: CONTEXT.client, clientHasContact: true,
  })
  return [
    ...(list.primary ? [[list.primary.action, 'primary']] : []),
    ...list.secondary.map(a => [a.action, 'secondary']),
    ...(list.danger ? [[list.danger.action, 'danger']] : []),
  ]
}

const SCHEDULER = { id: 'maker', role: 'scheduler', name: 'Sam' }
const REVIEWER = { id: 'joy', role: 'quality_checker', name: 'Joy' }
const MANAGER = { id: 'akmal', role: 'account_manager', name: 'Akmal' }

beforeEach(() => { h.rows = {}; h.me = null })

describe('the footer is postActions, rendered as it is, wherever the window opens (decision 2)', () => {
  const cases: [string, Record<string, unknown>, NonNullable<typeof h.me>][] = [
    ['draft · maker', row(), SCHEDULER],
    ['draft · manager', row(), MANAGER],
    ['quality check · reviewer', row({ stage: 'quality_check', sent_version: 1, draft_version: 2 }), REVIEWER],
    ['quality check · manager', row({ stage: 'quality_check', sent_version: 1, draft_version: 2 }), MANAGER],
    ['with client · manager', row({ stage: 'with_client', sent_version: 1, draft_version: 2, qc_pass: { version: 1, by: 'joy', at: inHours(-3) },
      client_send: { version: 1, at: inHours(-1), to: ['owner@cafe.test'], via: 'email', approve_by: inHours(20), for_time: inHours(24) } }), MANAGER],
    ['ready · scheduler', row({ stage: 'ready', sent_version: 1, draft_version: 2, approval: APPROVED, qc_pass: { version: 1, by: 'joy', at: inHours(-1) } }), SCHEDULER],
    ['booked · scheduler', row({ stage: 'booked', sent_version: 1, draft_version: 2, approval: APPROVED, booking: { job_ids: ['j1'], pending: false, at: inHours(-1), for_time: inHours(24) } }), SCHEDULER],
    ['posted in part · scheduler', row({ stage: 'posted', sent_version: 1, draft_version: 2, approval: APPROVED, channels: ['ig', 'li'],
      outcomes: { instagram: { status: 'published', url: 'https://instagram.test/p/1', at: inHours(-1), error: null }, linkedin: { status: 'failed', url: null, at: inHours(-1), error: 'Token expired' } } }), SCHEDULER],
    ['cancelled · scheduler', row({ stage: 'cancelled', sent_version: 1, draft_version: 2, cancelled: { by: 'maker', at: inHours(-1), from_stage: 'ready', reason: null } }), SCHEDULER],
  ]

  for (const [name, r, me] of cases) {
    it(name, () => {
      const html = draw(r, me)
      expect(actionsIn(html)).toEqual(expected(r, me))
      for (const [action] of actionsIn(html)) expect(TEAM_ACT_ACTIONS, action).toContain(action)
      expect(actionsIn(html).length, 'every stage has a way forward').toBeGreaterThan(0)
    })
  }
})

describe('the top says the post\'s own stage and who has it', () => {
  it('a draft reads Draft, and the caption can be typed into', () => {
    const html = draw(row(), SCHEDULER)
    expect(html).toMatch(/data-stage-chip="true">Draft</)
    expect(html).toMatch(/<textarea[^>]*data-caption="true"(?![^>]*readonly)/)
    expect(html).toContain('Send for quality check')
  })

  it('with the client, a manager is told it waits on the client — and Approve is not the main button (B7, W5)', () => {
    const html = draw(row({
      stage: 'with_client', sent_version: 1, draft_version: 2,
      client_send: { version: 1, at: inHours(-1), to: ['owner@cafe.test'], via: 'email', approve_by: inHours(20), for_time: inHours(24) },
    }), MANAGER)
    expect(html).toMatch(/data-stage-chip="true">With client</)
    expect(html).toMatch(/data-waiting-line="true">Waiting on the client</)
    expect(html).not.toMatch(/waiting on you/i)
    expect(html).not.toMatch(/data-action="approve_for_client" data-kind="primary"/)
    expect(html).toMatch(/data-action="approve_for_client" data-kind="secondary"[^>]*>Approve for the client/)
    expect(html).toContain('Emailed to owner@cafe.test')
  })

  it('once sent, the middle is the frozen version, read only — Edit is a footer button (decision 8)', () => {
    const frozen = { id: 'p1_v1', post_id: 'p1', client_id: 'c1', n: 1, slides: imgs(2), caption: 'The frozen words', channels: ['ig'], per_channel: {}, scheduled_for: inHours(24), frozen_at: inHours(-2), frozen_for: 'quality_check' }
    const html = draw(row({ stage: 'quality_check', sent_version: 1, draft_version: 2, caption: 'A later working copy' }), REVIEWER, { post_versions: { p1_v1: frozen } })
    expect(html).toContain('The frozen words')
    expect(html).not.toContain('A later working copy')
    expect(html).toMatch(/<textarea[^>]*readOnly=""|<textarea[^>]*readonly=""/)
    expect(html).toMatch(/data-version-line="true">Version 1 · frozen /)
    expect(html).not.toContain('Change media')
  })

  it('a cancelled post offers Re-book as the main button (W2)', () => {
    const html = draw(row({ stage: 'cancelled', sent_version: 1, draft_version: 2, cancelled: { by: 'maker', at: inHours(-1), from_stage: 'booked', reason: null } }), SCHEDULER)
    expect(html).toMatch(/data-action="rebook" data-kind="primary"[^>]*>Re-book/)
  })

  it('a post that went out on one network but not the other says so, with the live link', () => {
    const html = draw(row({ stage: 'posted', sent_version: 1, draft_version: 2, approval: APPROVED, channels: ['ig', 'li'],
      problem: 'Did not go out on LinkedIn.',
      outcomes: { instagram: { status: 'published', url: 'https://instagram.test/p/1', at: inHours(-1), error: null }, linkedin: { status: 'failed', url: null, at: inHours(-1), error: 'Token expired' } } }), SCHEDULER)
    expect(html).toContain('Posted on 1 of 2 — LinkedIn did not go out')
    expect(html).toContain('https://instagram.test/p/1')
    expect(html).toMatch(/data-action="missing_networks" data-kind="primary"/)
  })

  it('a new post, not saved yet, opens on its piece with Send for quality check', () => {
    const html = draw(null, SCHEDULER)
    expect(html).toContain('New post — not saved yet')
    expect(html).toContain('Menu carousel')
    expect(html).toMatch(/data-action="send_to_qc"/)
    expect(html).toMatch(/data-action="delete_draft" data-kind="danger"/)
  })
})

describe('Instagram takes ten (decision 10)', () => {
  it('eleven files on Instagram and LinkedIn: the counter, the refusal, and the three choices', () => {
    const html = draw(row({ slides: imgs(11), channels: ['ig', 'li'] }), SCHEDULER)
    expect(html).toMatch(/data-instagram-counter="true"[^>]*>Instagram 11 of 10</)
    expect(html).toMatch(/data-composition-problems/)
    expect(html).toMatch(/Instagram takes 10/)
    expect(html).toContain('Keep 10 — take 1 out')
    expect(html).toContain('Split it into two posts')
    expect(html).toContain('Give Instagram its own 10 — the other networks keep all 11')
    // the send is still drawn, stopped, with its reason beside it
    expect(html).toMatch(/data-action="send_to_qc"[^>]*disabled=""/)
  })

  it('ten is fine and asks nothing', () => {
    const html = draw(row({ slides: imgs(10), channels: ['ig'] }), SCHEDULER)
    expect(html).toMatch(/Instagram 10 of 10/)
    expect(html).not.toContain('Split it into two posts')
  })
})

describe('notes are per file, Team by default (decision 9)', () => {
  it('opens on the Team thread, says the client never sees it, and offers every file', () => {
    const html = draw(row({ slides: imgs(3) }), SCHEDULER, {
      post_comments: { n1: { id: 'n1', post_id: 'p1', file_url: img(2).url, visibility: 'team', body: 'Crop tighter', author_name: 'Joy', created_at: inHours(-1), version: 1 } },
    })
    expect(html).toMatch(/data-note-thread="team">Team only — the client never sees this/)
    expect(html).toContain('Notes on file 3')
    // "All notes" lists every note with its slide (30 Sep 2026) — the Team default stands when the client said nothing
    expect(html).toContain('All notes')
    expect(html).toContain('Slide 2')
  })
})

describe('the audit\'s window fixes are in the source (SPEC §8.3)', () => {
  const src = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')

  it('there is one window: NewPostDialog and SendForApprovalDialog are gone, and the flow opens PostWindow', () => {
    expect(existsSync('app/dashboard/social/schedule/NewPostDialog.tsx')).toBe(false)
    expect(existsSync('app/dashboard/scheduler/SendForApprovalDialog.tsx')).toBe(false)
    const flow = readFileSync('app/dashboard/social/schedule/useComposeFlow.tsx', 'utf8')
    expect(flow).toMatch(/import PostWindow/)
    expect(flow).not.toMatch(/NewPostDialog|reviewOnly/)
    const button = readFileSync('app/dashboard/scheduler/NewPostButton.tsx', 'utf8')
    expect(button).toMatch(/useComposeFlow/)
    expect(button).not.toMatch(/SendForApprovalDialog|NewCardDialog/)
  })

  it('W6/W10: no review-only mode, no second way to send to the client', () => {
    expect(src).not.toMatch(/reviewOnly/)
    expect(src).not.toMatch(/SendToClientDialog|sendToClient|posting-approval|\/send['`]/)
    expect(src).not.toMatch(/footerActions|live_status|posting_approval_state|client_sent/)
  })

  it('W1: the keyboard effect depends on [picking] only, and focus lands once on open', () => {
    const effect = src.slice(src.indexOf("document.addEventListener('keydown', onKey)") - 1400, src.indexOf("document.addEventListener('keydown', onKey)") + 200)
    expect(effect).toMatch(/\}, \[picking\]\)/)
    expect(effect).not.toMatch(/\[picking, state\.dirty\]|state\.dirty\]/)
    expect(src).toMatch(/useEffect\(\(\) => \{ card\.current\?\.focus\(\) \}, \[\]\)/)
    expect(src.match(/card\.current\?\.focus\(\)/g)).toHaveLength(1)
  })

  it('every press goes through the act route (the P0 contract), with the server injectable for tests', () => {
    expect(src).toMatch(/pressAction\(api,/)
    const api = readFileSync('app/dashboard/social/schedule/post-window-api.ts', 'utf8')
    expect(api).toMatch(/act: postAct,/)
  })

  it('W3/W9: the time picker has a Now chip, five-minute steps with the odd minute kept, and no 6 pm default', () => {
    const tp = readFileSync('app/dashboard/social/schedule/TimePicker.tsx', 'utf8')
    expect(tp).toMatch(/now\?: \{ enabled: boolean; reason: string \| null; onNow: \(\) => void \}/)
    expect(tp).toMatch(/minuteOptions\(current\.minute\)/)
    expect(tp).toMatch(/splitClock\(defaultPostTime\(nowMs\), tz\)/)
    expect(tp).toMatch(/hourIsPast\(/)
  })

  it('W7: the media picker shows a refusal only after a Save pressed in that opening', () => {
    const mp = readFileSync('app/dashboard/social/schedule/MediaPicker.tsx', 'utf8')
    expect(mp).toMatch(/triedSave && saveProblems\.length > 0/)
    expect(src).toMatch(/const openPicker = \(\) => \{ setMediaProblems\(\[\]\); setReply\(null\); setPicking\(true\) \}/)
    expect(mp).not.toMatch(/NEW_VERSION_NOTICE|Approved by the client/)
  })
})
