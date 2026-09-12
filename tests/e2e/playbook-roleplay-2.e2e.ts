import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'

/**
 * THE PLAYBOOK, PART TWO, ON THE REAL DATABASE — 11 Sep 2026.
 *
 *   A. a scheduler books a card, then wants ANOTHER approved asset instead:
 *      cancel, pick the other, book again — no second approval is asked,
 *      both cards move, the portal follows. A file nobody approved cannot
 *      take the same shortcut: it goes to the gate.
 *   B. a client who posts their own content: the card ends at Delivered,
 *      no scheduler ever sees it, the client downloads the finals.
 *   C. a manager hands a scheduler a card with the Drive folder to post from.
 *
 * At every step the SCREEN is written down for every role with the same
 * pure functions the pages draw from (see playbook-roleplay.e2e.ts).
 *
 * SAFETY: the ZZ TEST client and its `.invalid` accounts only; a temporary
 * `.invalid` quality reviewer made for this run and deleted after;
 * EMAIL_TEST_ONLY (the mailer refuses a real address); PUBLISH_DRY_RUN (no
 * socket to the provider); every row this run makes is deleted at the end
 * and the deletion read back; the client's default schedulers and its
 * "posts own content" setting are restored.
 *
 *   EMAIL_TEST_ONLY=1 PUBLISH_DRY_RUN=1 \
 *     npx vitest run --config vitest.e2e.config.mts tests/e2e/playbook-roleplay-2.e2e.ts
 */

const h: { user: { id: string; role: string; email: string; name: string; clerk_user_id: string | null; quality_reviewer?: boolean } } = {
  user: { id: '', role: 'scheduler', email: '', name: '', clerk_user_id: null },
}
vi.mock('../../app/lib/authz', async () => {
  const real = await vi.importActual<typeof import('../../app/lib/authz')>('../../app/lib/authz')
  const ORDER = ['scheduler', 'editor', 'general', 'account_manager', 'super_admin']
  const ok = (actual: string, required: string) => {
    if (actual === 'super_admin') return true
    if (required === 'client') return actual === 'client'
    if (actual === 'client') return false
    return ORDER.indexOf(actual) >= ORDER.indexOf(required)
  }
  return {
    ...real,
    requireRole: async (required: string) => {
      if (!ok(String(h.user.role), required)) throw new real.AuthzError('Insufficient permissions', 403)
      return h.user
    },
    requireSignedIn: async () => h.user,
  }
})

import { table, withRequestCache } from '../../lib/db'
import { attachOne } from '../../lib/db-join'
import type { AssetVersion, ContentItem, PublishJob, SocialAccount, SocialPost, TeamUserClient } from '../../lib/db-types'
import type { TeamUser } from '../../app/lib/authz'
import { performTransition } from '../../app/lib/workflow'
import { visibleItems } from '../../app/lib/scope-client'
import { cardActions, cardLines, overviewTiles, pageCards, EDITOR_LANE_LABELS } from '../../app/lib/board-view-core'
import { boardColumn, cardColumn, columnOf } from '../../app/lib/board-core'
import { whoseTurn, type ItemStatus } from '../../app/lib/workflow-core'
import { UNASKED_LINE } from '../../app/lib/waiting-core'
import { DELIVERED_LINE, DELIVER_ONLY_REASON, PORTAL_DELIVERED_LINE, isDelivered } from '../../app/lib/deliver-only-core'
import { monthStages, stagesLine } from '../../app/lib/overview-stages-core'
import { createPost, sendForApproval, cancelPost, schedulePost } from '../../app/lib/social-schedule'
import { postingEligibility } from '../../app/lib/social-schedule-core'
import { getPortalData } from '../../app/lib/portal-data'
import { putObject, deleteStoredObject } from '../../app/lib/storage'
import { POST as addVersion } from '../../app/api/production/items/[id]/versions/route'
import { POST as portalAct } from '../../app/api/portal/act/route'
import { POST as fromUpload } from '../../app/api/social/schedule/from-upload/route'
import { PUT as putLink } from '../../app/api/production/items/[id]/link/route'
import { POST as handoff } from '../../app/api/production/items/[id]/handoff/route'

vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const IDS = {
  am: '3548cc71-5a34-4fe9-9130-11579d1a4137',
  editor: 'e30e0242-63f1-4855-8e3a-b23b293ec11d',
  scheduler: '0e7fcf9f-bcf5-4080-ab7c-1b1f8fed1d13',
  client: '634d5636-70a7-4f5a-96e9-5b48cce73999',
}
const SUPER: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000b1', role: 'super_admin',
  email: 'zz-superadmin@mdmedia-test.invalid', name: 'ZZ Super admin', clerk_user_id: null,
} as TeamUser
const OTHER: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000b2', role: 'scheduler',
  email: 'zz-other-scheduler@mdmedia-test.invalid', name: 'ZZ Other', clerk_user_id: null,
} as TeamUser
const GENERAL: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000b3', role: 'general',
  email: 'zz-general@mdmedia-test.invalid', name: 'ZZ General', clerk_user_id: null,
} as TeamUser

const STAMP = Date.now()
const TAG = `ZZ TEST PLAYBOOK2 ${STAMP}`
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9])
const SLIDES: { url: string; name: string; type: 'image'; bytes: number; source: 'upload' }[] = []
const melbourneToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
const DRIVE_FOLDER = 'https://drive.google.com/drive/folders/1ZZtestPlaybookFolder'

let am: TeamUser, editor: TeamUser, scheduler: TeamUser, clientUser: TeamUser, joy: TeamUser
let channelId = ''
let shareToken = ''
let originalDefaults: unknown = []
let originalSelfPosts: unknown = null
const runStart = new Date().toISOString()
const cards: Record<string, string> = {}     // A, B, C, D, E, F → item id
const postIds: Record<string, string> = {}
const created = {
  items: new Set<string>(), versions: new Set<string>(), posts: new Set<string>(), jobs: new Set<string>(),
  locks: new Set<string>(), accounts: new Set<string>(), entries: new Set<string>(), users: new Set<string>(),
  links: new Set<string>(),
}
let assignments: TeamUserClient[] = []
const names = new Map<string, string>()

/* ── the screen, written down ─────────────────────────────────────────── */

const script: string[] = []
const say = (line: string) => { script.push(line); console.log(line) }
const SCRIPT_PATH = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-myProjects-content/c33ff7c1-ad55-46c0-8973-dffcbb410744/scratchpad/playbook-roleplay-2-script.txt'

const as = (who: TeamUser) => {
  Object.assign(h.user, { id: who.id, role: who.role, email: who.email, name: who.name, clerk_user_id: who.clerk_user_id ?? null, quality_reviewer: (who as { quality_reviewer?: boolean }).quality_reviewer === true })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (res: Response | undefined) => res ? ({ status: res.status, body: await res.json().catch(() => ({})) }) : ({ status: 0, body: { error: 'no response' } })
const viewerOf = (who: TeamUser) => ({ id: who.id, role: who.role, quality_reviewer: (who as { quality_reviewer?: boolean }).quality_reviewer === true }) as never
const itemRow = async (id: string) => (await table<ContentItem>('content_items').get(id, { fresh: true }))!
const clientRow = async () => (await table<{ id: string; name: string; posts_own_content?: unknown }>('clients').get(TEST_CLIENT_ID, { fresh: true }))!
/** our cards, with the joins the boards read (kind, client — the client's
 *  "posts own content" flag is what the Delivered column is drawn from) */
const ourRows = async () => {
  const ids = Object.values(cards)
  const client = await clientRow()
  const rows = await table<ContentItem>('content_items').list({ fresh: true, where: r => ids.includes(r.id) })
  return (await attachOne(rows, 'work_kind_id', 'work_kinds', ['slug', 'name']))
    .map(r => ({ ...r, clients: { name: 'ZZ TEST', posts_own_content: client.posts_own_content === true } })) as unknown as (ContentItem & { clients: { name: string; posts_own_content: boolean } })[]
}
const activityOf = async (id: string) =>
  table<{ id: string; action: string; actor_id?: string | null; detail?: string | null; created_at?: string | null; entity_id?: string; entity_type?: string; new_value?: string | null }>('workflow_activity')
    .list({ fresh: true, where: a => String(a.entity_id ?? '') === id })
const selfPostingIds = async () => new Set((await clientRow()).posts_own_content === true ? [TEST_CLIENT_ID] : [])
/** who may see which of OUR rows, by the same rule the server and the pages use */
const seenBy = async (who: TeamUser, rows: ContentItem[]) =>
  visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false, selfPostingClientIds: await selfPostingIds() } as never).map(r => r.id)
const keyOf = (id: string) => Object.entries(cards).find(([, v]) => v === id)?.[0] ?? '?'

async function toldSince(since: string) {
  const ids = Object.values(cards)
  const rows = await table<{ id: string; recipient_email?: string; subject?: string; event_type?: string; created_at?: string; status?: string; entity_id?: string; body_html?: string }>('notification_log')
    .list({ fresh: true, where: n => String(n.created_at ?? '') >= since && (String(n.recipient_email ?? '').endsWith('.invalid') || ids.some(x => x && String(n.entity_id ?? '').includes(x))) })
  return rows.map(r => ({ recipient_email: String(r.recipient_email ?? ''), subject: String(r.subject ?? ''), event_type: String(r.event_type ?? ''), status: String(r.status ?? ''), body: String(r.body_html ?? ''), entity_id: String(r.entity_id ?? '') }))
}
async function toldUntil(since: string, done: (rows: Awaited<ReturnType<typeof toldSince>>) => boolean, ms = 120_000) {
  const deadline = Date.now() + ms
  let rows = await toldSince(since)
  while (!done(rows) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300))
    rows = await toldSince(since)
  }
  return rows
}
const settle = (ms = 1500) => new Promise(r => setTimeout(r, ms))
const noLeak = (told: { recipient_email: string; status: string }[]) =>
  expect(told.filter(t => t.status === 'sent').every(t => t.recipient_email.endsWith('.invalid')), 'a real inbox was emailed').toBe(true)

function turnWords(card: ContentItem, who: TeamUser): string {
  const t = whoseTurn(card.status as ItemStatus, card as never, viewerOf(who))
  if (t.hat === null) return 'no chip'
  if (t.unassigned) return t.hat === 'editor' ? 'Nobody on it — anyone can take it' : t.hat === 'scheduler' ? 'Nobody on it — any scheduler can take it' : UNASKED_LINE
  if (t.mine) return 'Your turn'
  return `Waiting on the ${String(t.hat).replace('_', ' ')}`
}

async function screenBoard(who: TeamUser, page: 'editor' | 'scheduler', label: string) {
  const rows = await ourRows()
  const visible = visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false, selfPostingClientIds: await selfPostingIds() } as never) as unknown as typeof rows
  const shown = pageCards(page, visible as never, viewerOf(who), melbourneToday()) as unknown as typeof rows
  const pageName = page === 'editor' ? 'Editor' : 'Post approval'
  if (shown.length === 0) { say(`   ${label} — ${pageName}: nothing`); return shown }
  for (const c of shown) {
    const col = cardColumn(c as never)
    const colLabel = page === 'editor' ? (EDITOR_LANE_LABELS[col] ?? boardColumn(col).label) : boardColumn(col).label
    const lines = cardLines(c as never, { names, today: melbourneToday(), viewerId: who.id })
    const acts = cardActions(c as never, viewerOf(who))
    const buttons = [acts.primary, ...acts.more].filter(Boolean).map(a => a!.label)
    say(`   ${label} — ${pageName}: card ${keyOf(c.id)} "${lines.title}" in ${colLabel}${lines.deliverOnly ? ' · Client posts it' : ''}${lines.link ? ` · link ${lines.link.label}` : ''}${lines.delivered ? ` · ${lines.delivered}` : ''}${lines.posted ? ` · ${lines.posted}` : ''} · chip "${turnWords(c, who)}" · buttons: ${buttons.length ? buttons.join(' · ') : 'none'}`)
  }
  return shown
}

async function screenOverview(who: TeamUser, label: string) {
  const rows = await ourRows()
  const visible = visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false, selfPostingClientIds: await selfPostingIds() } as never)
  const clientCount = who.role === 'super_admin' ? 1 : assignments.filter(a => a.team_user_id === who.id).length
  const tiles = overviewTiles({ viewer: viewerOf(who), cards: visible as never, today: melbourneToday(), clientCount })
  say(`   ${label} — Overview: ${tiles.map(t => `${t.title} [${t.stats.map(s => `${s.value} ${s.label}`).join(' / ')}]`).join(' · ')}`)
  return tiles
}

async function screenPortal(label: string) {
  const data = await getPortalData(TEST_CLIENT_ID)
  const out: Record<string, NonNullable<typeof data>['cards'][number]> = {}
  for (const [key, id] of Object.entries(cards)) {
    const card = data?.cards.find(c => c.id === id)
    if (!card) { say(`   ${label} — client portal: card ${key} not shown`); continue }
    out[key] = card
    say(`   ${label} — client portal: ${key} "${card.title}" in ${card.column} · "${card.line}"${card.posted_when ? ` · posting ${card.posted_when}` : ''}${card.deliver_only && card.column === 'approved' ? ` · download × ${card.slides.length}${card.caption ? ' · caption shown' : ''}` : ''}`)
  }
  return out
}

async function everyone(step: string) {
  say(`\n${step}`)
  await screenBoard(editor, 'editor', 'Editor')
  await screenBoard(am, 'scheduler', 'AM'); await screenBoard(joy, 'scheduler', 'Joy'); await screenBoard(scheduler, 'scheduler', 'Scheduler'); await screenBoard(OTHER, 'scheduler', 'Other scheduler'); await screenBoard(GENERAL, 'scheduler', 'General'); await screenBoard(SUPER, 'scheduler', 'Super admin')
  await screenOverview(am, 'AM'); await screenOverview(SUPER, 'Super admin')
  return screenPortal('Client')
}

/* ── making a card and walking it through the gate ─────────────────────── */

async function makeCard(key: string, title: string, extra: Record<string, unknown> = {}) {
  const row = await table<ContentItem>('content_items').insert({
    client_id: TEST_CLIENT_ID, title: `${TAG} — ${title}`, content_type: 'static', platform_targets: ['instagram'],
    priority: 'normal', client_approval_required: true, status: 'draft_uploaded', current_version_number: 0,
    owner_id: editor.id, caption: `${title} caption #zztest`, ...extra,
  } as never)
  cards[key] = row.id; created.items.add(row.id)
  return row.id
}

/** editor uploads → Ready for quality check (straight to Joy, Abby's rule) → Joy passes → client approves */
async function throughTheGate(id: string, slide: (typeof SLIDES)[number]) {
  as(editor)
  const v = await json(await addVersion(new Request('https://x.test/versions', { method: 'POST', body: JSON.stringify({ files: [slide], notes: 'Final export' }) }), params(id)))
  expect(v.status, JSON.stringify(v.body)).toBe(201)
  for (const ver of await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: id } as never })) created.versions.add(ver.id)
  expect((await performTransition(editor, (await itemRow(id)) as never, 'quality_check')).status).toBe('quality_check')
  as(joy)
  expect((await performTransition(joy, (await itemRow(id)) as never, 'client_review', { note: 'Passed' })).status).toBe('client_review')
  const r = await json(await portalAct(new Request('https://x.test/portal/act', {
    method: 'POST', body: JSON.stringify({ token: shareToken, item_id: id, action: 'approve', author_name: 'ZZ Client' }),
  })))
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  const card = await itemRow(id)
  expect(card.status).toBe('approved_for_scheduling')
  return card
}

/* ── setup ─────────────────────────────────────────────────────────────── */

beforeAll(() => withRequestCache(async () => {
  if (process.env.EMAIL_TEST_ONLY !== '1') throw new Error('EMAIL_TEST_ONLY is not set — refusing to run')
  process.env.PUBLISH_DRY_RUN = '1'
  const client = await table<{ id: string; name: string; share_token: string | null; default_scheduler_ids?: unknown; posts_own_content?: unknown }>('clients').get(TEST_CLIENT_ID)
  if (!client || !/^ZZ TEST/.test(client.name)) throw new Error('ZZ TEST client not found')
  shareToken = String(client.share_token ?? '')
  originalDefaults = client.default_scheduler_ids ?? []
  originalSelfPosts = client.posts_own_content ?? null
  const people = await table<TeamUser & { id: string }>('team_users').list({ where: u => Object.values(IDS).includes(u.id) })
  am = people.find(u => u.id === IDS.am)!; editor = people.find(u => u.id === IDS.editor)!
  scheduler = people.find(u => u.id === IDS.scheduler)!; clientUser = people.find(u => u.id === IDS.client)!
  if (!am || !editor || !scheduler || !clientUser) throw new Error('Test accounts missing')
  for (const p of [am, editor, scheduler, clientUser]) if (!p.email.endsWith('.invalid')) throw new Error(`refusing: ${p.email} is real`)
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: TEST_CLIENT_ID } })
  const emails = (await attachOne(links, 'team_user_id', 'team_users', ['email'])).map(r => (r.team_users as { email: string } | null)?.email).filter((e): e is string => !!e)
  if (emails.some(e => !e.endsWith('.invalid'))) throw new Error('ZZ TEST client is managed by real people')

  const j = await table<TeamUser & { id: string }>('team_users').insert({
    email: `zz-joy2-${STAMP}@mdmedia-test.invalid`, name: 'ZZ Joy', role: 'account_manager', clerk_user_id: null,
    active_status: true, employment_type: 'employee', timezone: 'Australia/Melbourne', client_id: null,
    quality_reviewer: true, ops_contact: false,
  } as never)
  created.users.add(j.id); joy = { ...j, quality_reviewer: true } as never
  const link = await table<TeamUserClient>('team_user_clients').insert({ id: `${j.id}__${TEST_CLIENT_ID}`, team_user_id: j.id, client_id: TEST_CLIENT_ID } as never)
  created.links.add(link.id)
  assignments = await table<TeamUserClient>('team_user_clients').list({ fresh: true, by: { client_id: TEST_CLIENT_ID } })
  for (const p of [am, editor, scheduler, joy, SUPER, OTHER, GENERAL]) names.set(p.id, p.name)

  await table('clients').update(TEST_CLIENT_ID, { default_scheduler_ids: [scheduler.id], posts_own_content: false } as never)

  const account = await table<SocialAccount>('social_accounts').insert({
    client_id: TEST_CLIENT_ID, platform: 'instagram', provider_account_id: `zz-test2-${STAMP}`,
    name: `${TAG} channel`, username: `zz_test2_${STAMP}`, avatar_url: null, active: true,
    connected_at: new Date().toISOString(), last_synced_at: new Date().toISOString(),
  } as never)
  created.accounts.add(account.id); channelId = account.id
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const put = await putObject(`zztest-pb2-${STAMP}-${n}.jpg`, JPEG, 'image/jpeg')
    SLIDES.push({ url: put.publicUrl, name: `${n}.jpg`, type: 'image', bytes: JPEG.length, source: 'upload' })
  }
  say(`[setup] client=${TEST_CLIENT_ID} joy=${joy.email} channel=${channelId} files=${SLIDES.length}`)
}))

/* ── A. swap a booked post to another approved asset ────────────────────── */

describe('A. the scheduler swaps a booked post for another approved asset', () => {
  it('A1. two cards are approved through the gate; the scheduler books A', async () => {
    await makeCard('A', 'Launch reel A'); await makeCard('B', 'Launch photo B')
    await throughTheGate(cards.A, SLIDES[0]); await throughTheGate(cards.B, SLIDES[1])
    await everyone('Step A1a — A and B approved by the client, both in Ready to post')

    as(scheduler)
    const versions = await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: cards.A } as never })
    const elig = postingEligibility((await itemRow(cards.A)) as never, versions as never, false)
    expect(elig.ok).toBe(true)
    const since = new Date().toISOString()
    const draft = await createPost(scheduler, { item_id: cards.A, slides: elig.ok ? elig.slides : [], caption: `${TAG} A`, channels: [channelId], scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString() })
    postIds.A = draft.id; created.posts.add(draft.id); created.locks.add(`social_post__${cards.A}`); created.locks.add(`publish__${cards.A}`)
    const booked = await sendForApproval(scheduler, draft.id, { mode: 'direct' })
    for (const jb of booked.publish_job_ids) created.jobs.add(jb)
    expect(booked.status).toBe('scheduled')
    for (const e of await table<{ id: string; item_id: string }>('schedule_entries').list({ fresh: true, by: { item_id: cards.A } as never })) created.entries.add(e.id)
    const a = await itemRow(cards.A)
    expect(a.status).toBe('scheduled')
    expect(cardColumn({ ...a, clients: { posts_own_content: false } } as never)).toBe('booked')
    expect(cardColumn({ ...(await itemRow(cards.B)), clients: { posts_own_content: false } } as never)).toBe('ready_to_post')
    // the approved asset needed no second yes: the post was cleared on the board's approval
    const post = (await table<SocialPost>('social_posts').get(draft.id, { fresh: true }))!
    expect(String((post as { approval_mode?: string }).approval_mode)).toBe('assets')
    const told = await toldSince(since)
    noLeak(told)
    expect(told.some(t => t.recipient_email === clientUser.email)).toBe(false)
    const portal = await everyone('Step A1b — A booked in (dry run), B still in Ready to post')
    expect(portal.A?.posted_when).toBeTruthy()
    expect(portal.B?.posted_when).toBeNull()
  })

  it('A2. cancel A, pick B instead, book again — no second approval, both cards move, the portal follows', async () => {
    as(scheduler)
    const since = new Date().toISOString()
    const cancelled = await cancelPost(scheduler, postIds.A)
    expect(cancelled.status).toBe('cancelled')
    const a = await itemRow(cards.A)
    expect(a.status).toBe('approved_for_scheduling')
    expect((await activityOf(cards.A)).some(r => r.action === 'post_cancelled' && /back in Ready to post/.test(String(r.detail)))).toBe(true)
    say('   Scheduler pressed Cancel on A: pulled back from the channel, A back in Ready to post')
    await everyone('Step A2a — booking on A cancelled')

    // the other approved asset, exactly as the rail offers it: tick B, press Post
    const versions = await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: cards.B } as never })
    const elig = postingEligibility((await itemRow(cards.B)) as never, versions as never, false)
    expect(elig.ok).toBe(true)
    const draft = await createPost(scheduler, { item_id: cards.B, slides: elig.ok ? elig.slides : [], caption: `${TAG} B`, channels: [channelId], scheduled_for: new Date(Date.now() + 3 * 86_400_000).toISOString() })
    postIds.B = draft.id; created.posts.add(draft.id); created.locks.add(`social_post__${cards.B}`); created.locks.add(`publish__${cards.B}`)
    const booked = await sendForApproval(scheduler, draft.id, { mode: 'direct' })
    for (const jb of booked.publish_job_ids) created.jobs.add(jb)
    expect(booked.status).toBe('scheduled')
    for (const e of await table<{ id: string; item_id: string }>('schedule_entries').list({ fresh: true, by: { item_id: cards.B } as never })) created.entries.add(e.id)
    const b = await itemRow(cards.B)
    expect(b.status).toBe('scheduled')
    expect(b.status).not.toBe('quality_check')
    const post = (await table<SocialPost>('social_posts').get(draft.id, { fresh: true }))!
    expect(String((post as { approval_mode?: string }).approval_mode)).toBe('assets')
    expect(String((post as { status?: string }).status)).toBe('scheduled')
    await settle()
    const told = await toldSince(since)
    noLeak(told)
    expect(told.some(t => t.recipient_email === clientUser.email), 'the client was asked again').toBe(false)
    expect(told.some(t => t.recipient_email === joy.email && /Quality check/.test(t.subject)), 'Joy was asked again').toBe(false)
    say(`   Scheduler ticked B in the rail and pressed Post → booked (dry run), no second approval asked · told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ') || 'nobody'}`)
    const portal = await everyone('Step A2b — B booked in instead; A back in Ready to post')
    expect(portal.B?.posted_when).toBeTruthy()
    expect(portal.A?.posted_when).toBeNull()
    expect(portal.A?.column).toBe('approved')
    expect(cardColumn({ ...(await itemRow(cards.A)), clients: { posts_own_content: false } } as never)).toBe('ready_to_post')
    expect(cardColumn({ ...b, clients: { posts_own_content: false } } as never)).toBe('booked')
    // both histories say what happened
    expect((await activityOf(cards.A)).some(r => r.action === 'post_cancelled')).toBe(true)
    expect((await activityOf(cards.B)).some(r => /schedul/.test(String(r.action)) || String(r.new_value) === 'scheduled')).toBe(true)
  })

  it('A3. a file nobody approved cannot take the shortcut: it goes to the gate', async () => {
    as(scheduler)
    const r = await json(await fromUpload(new Request('https://x.test/from-upload', {
      method: 'POST',
      body: JSON.stringify({ client_id: TEST_CLIENT_ID, files: [SLIDES[2]], title: `${TAG} — fresh upload C`, decision: 'ask', reviewer_ids: [am.id], note: 'New photo, never checked' }),
    })))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    cards.C = String(r.body.item_id); created.items.add(cards.C)
    postIds.C = String(r.body.post?.id ?? ''); if (postIds.C) { created.posts.add(postIds.C); created.locks.add(`social_post__${cards.C}`); created.locks.add(`publish__${cards.C}`) }
    for (const v of await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: cards.C } as never })) created.versions.add(v.id)
    const c = await itemRow(cards.C)
    expect(c.status).toBe('quality_check')
    say(`   Scheduler uploaded a fresh file C and pressed Post → "${r.body.message ?? 'sent for approval'}" · card C in Quality check`)
    // booking it is refused until somebody says yes
    await expect(schedulePost(scheduler, postIds.C)).rejects.toThrow(/approval/i)
    await expect(sendForApproval(scheduler, postIds.C, { mode: 'direct' })).rejects.toThrow()
    say('   Scheduler tries to book C now → refused: waiting on approval')
    await everyone('Step A3 — the unapproved file waits at the gate')
  })
})

/* ── B. a client who posts their own content ────────────────────────────── */

describe('B. deliver only — the client posts their own', () => {
  it('B1. with the client set to post their own, an approved card ends at Delivered', async () => {
    await table('clients').update(TEST_CLIENT_ID, { posts_own_content: true } as never)
    await makeCard('D', 'Menu graphic D')
    as(editor)
    const since = new Date().toISOString()
    const d = await throughTheGate(cards.D, SLIDES[3])
    expect(isDelivered(d as never, { posts_own_content: true })).toBe(true)
    const rows = await ourRows()
    const dRow = rows.find(r => r.id === cards.D)!
    expect(cardColumn(dRow as never)).toBe('delivered')
    // nobody who schedules sees it — not the scheduler it would have been handed to, not another
    expect(await seenBy(scheduler, rows as never)).not.toContain(cards.D)
    expect(await seenBy(OTHER, rows as never)).not.toContain(cards.D)
    expect(pageCards('scheduler', [dRow] as never, viewerOf(scheduler), melbourneToday())).toEqual([])
    expect(pageCards('editor', [dRow] as never, viewerOf(editor), melbourneToday()).length).toBe(1)
    expect(EDITOR_LANE_LABELS.delivered).toBe('Done')
    expect(d.scheduler_ids ?? []).toEqual([])
    // the history says where it ended
    expect((await activityOf(cards.D)).some(r => String(r.detail) === DELIVERED_LINE)).toBe(true)
    await settle()
    const told = await toldSince(since)
    noLeak(told)
    expect(told.some(t => t.recipient_email === scheduler.email), 'the scheduler was told about a card that is not theirs').toBe(false)
    say(`   told since D began: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ') || 'nobody'}`)
    // the Schedule page refuses to book it, whoever asks
    as(scheduler)
    await expect(createPost(scheduler, { item_id: cards.D, slides: [SLIDES[3]], caption: 'x', channels: [channelId] })).rejects.toThrow(DELIVER_ONLY_REASON)
    as(SUPER)
    await expect(createPost(SUPER, { item_id: cards.D, slides: [SLIDES[3]], caption: 'x', channels: [channelId] })).rejects.toThrow(DELIVER_ONLY_REASON)
    say(`   Scheduler and super admin try to book D → refused: "${DELIVER_ONLY_REASON}"`)
    const portal = await everyone('Step B1 — D delivered: the client posts it themselves')
    expect(portal.D?.line).toBe(PORTAL_DELIVERED_LINE)
    expect(portal.D?.deliver_only).toBe(true)
    expect(portal.D?.slides.length).toBeGreaterThan(0)
    expect(portal.D?.slides.every(s => s.url && s.name)).toBe(true)
    expect(portal.D?.caption).toMatch(/Menu graphic D caption/)
    expect(portal.D?.posted_when).toBeNull()
    // the month counts it as delivered, never as something to book
    const client = await clientRow()
    const stages = monthStages({
      now: new Date(), items: [{ id: cards.D, client_id: TEST_CLIENT_ID, status: d.status, delivered_at: (d as { delivered_at?: string }).delivered_at }],
      activity: (await activityOf(cards.D)).map(a => ({ entity_type: a.entity_type ?? 'content_item', entity_id: a.entity_id, action: a.action, new_value: a.new_value ?? null, created_at: a.created_at ?? null })),
      clients: [{ id: TEST_CLIENT_ID, name: client.name, timezone: 'Australia/Melbourne' }], commitments: [], clientIds: null, defaultTz: 'Australia/Melbourne',
    })
    expect(stages[0]?.delivered).toBe(1)
    say(`   Overview this month for ZZ TEST: ${stagesLine(stages[0])}`)
    const tiles = overviewTiles({ viewer: viewerOf(SUPER), cards: [dRow] as never, today: melbourneToday(), clientCount: 1 })
    const ready = tiles.flatMap(t => t.stats).find(s => /ready to post|to book/.test(s.label))
    expect(Number(ready?.value ?? 0)).toBe(0)
  })

  it('B2. one card can say otherwise: deliver_only false goes to Ready to post as normal', async () => {
    await makeCard('E', 'Reel E we post', { deliver_only: false })
    const since = new Date().toISOString()
    const e = await throughTheGate(cards.E, SLIDES[4])
    const rows = await ourRows()
    const eRow = rows.find(r => r.id === cards.E)!
    expect(cardColumn(eRow as never)).toBe('ready_to_post')
    expect(e.scheduler_ids, 'E was not handed to the default scheduler').toEqual([scheduler.id])
    expect(await seenBy(scheduler, rows as never), 'the scheduler cannot see E').toContain(cards.E)
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === scheduler.email))
    noLeak(told)
    expect(told.some(t => t.recipient_email === scheduler.email), `the scheduler was not told about E: ${JSON.stringify(told.map(t => [t.recipient_email, t.subject]))}`).toBe(true)
    say(`   E (deliver_only: false on the card) → Ready to post, handed to the scheduler · told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    const portal = await everyone('Step B2 — E follows the ordinary road while D stays delivered')
    expect(portal.E?.line).not.toBe(PORTAL_DELIVERED_LINE)
    expect(portal.D?.line).toBe(PORTAL_DELIVERED_LINE)
    await table('clients').update(TEST_CLIENT_ID, { posts_own_content: false } as never)
  })
})

/* ── C. hand a scheduler a Drive folder to post from ────────────────────── */

describe('C. the manager hands a scheduler the Drive folder to post from', () => {
  it('C1. the folder is on the card, the email names it, the scheduler sees both', async () => {
    // an ordinary client again, whatever B left behind
    await table('clients').update(TEST_CLIENT_ID, { posts_own_content: false } as never)
    await makeCard('F', 'Story set F')
    const f = await throughTheGate(cards.F, SLIDES[5])
    expect(f.status).toBe('approved_for_scheduling')
    as(am)
    // the Hand to… dialog saves the folder first, so the email can name it
    const put = await json(await putLink(new Request('https://x.test/link', { method: 'PUT', body: JSON.stringify({ url: DRIVE_FOLDER }) }), params(cards.F)))
    expect(put.status, JSON.stringify(put.body)).toBe(200)
    expect(put.body.kind).toBe('drive')
    const since = new Date().toISOString()
    const handed = await json(await handoff(new Request('https://x.test/handoff', { method: 'POST', body: JSON.stringify({ scheduler_ids: [scheduler.id], note: 'Post the three stories from the folder' }) }), params(cards.F)))
    expect(handed.status, JSON.stringify(handed.body)).toBe(200)
    const after = await itemRow(cards.F)
    expect(after.link_url).toBe(DRIVE_FOLDER)
    expect(after.link_kind).toBe('drive')
    expect(after.scheduler_ids).toEqual([scheduler.id])
    expect(after.status).toBe('approved_for_scheduling')
    // the client's approval already told the default scheduler "needs a
    // posting date" (no folder yet); the hand-over email is the one that
    // names the folder, so that is the row waited for
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === scheduler.email && /Post from this folder/.test(x.body)))
    noLeak(told)
    const mail = told.find(t => t.recipient_email === scheduler.email && /Post from this folder/.test(t.body))
    expect(mail, JSON.stringify(told.map(t => [t.recipient_email, t.subject]))).toBeTruthy()
    expect(mail!.body).toContain(DRIVE_FOLDER)
    say(`   AM handed F to ${scheduler.name} with the folder · told: ${mail!.recipient_email} "${mail!.subject}" (body names the folder)`)
    const rows = await ourRows()
    expect(await seenBy(scheduler, rows as never)).toContain(cards.F)
    const shown = pageCards('scheduler', rows.filter(r => r.id === cards.F) as never, viewerOf(scheduler), melbourneToday())
    expect(shown.length).toBe(1)
    const lines = cardLines(shown[0] as never, { names, today: melbourneToday(), viewerId: scheduler.id })
    expect(lines.link?.label).toBe('Google Drive')
    expect(lines.link?.url).toBe(DRIVE_FOLDER)
    await everyone('Step C1 — F handed to the scheduler with the Drive folder')
    const told2 = await toldSince(runStart)
    noLeak(told2)
    say(`\n${told2.length} notifications logged since the run began, every one to a .invalid address`)
  })
})

afterAll(async () => {
  writeFileSync(SCRIPT_PATH, script.join('\n'), 'utf8')
  await settle()
  await table('clients').update(TEST_CLIENT_ID, { default_scheduler_ids: originalDefaults, posts_own_content: originalSelfPosts } as never).catch(() => {})
  for (const id of created.posts) await table('social_posts').remove(id).catch(() => {})
  for (const id of created.jobs) await table('publish_jobs').remove(id).catch(() => {})
  for (const id of created.locks) await table('claim_locks').remove(id).catch(() => {})
  for (const id of created.entries) await table('schedule_entries').remove(id).catch(() => {})
  for (const id of created.versions) await table('asset_versions').remove(id).catch(() => {})
  for (const id of created.items) await table('content_items').remove(id).catch(() => {})
  for (const id of created.accounts) await table('social_accounts').remove(id).catch(() => {})
  for (const id of created.links) await table('team_user_clients').remove(id).catch(() => {})
  for (const id of created.users) await table('team_users').remove(id).catch(() => {})
  for (const s of SLIDES) await deleteStoredObject(s.url).catch(() => {})
  const ids = [...created.items]
  const strays = await Promise.all([
    table<AssetVersion>('asset_versions').list({ fresh: true, where: v => ids.includes(String(v.item_id)) }),
    table<SocialPost>('social_posts').list({ fresh: true, where: p => ids.includes(String(p.item_id)) }),
    table<PublishJob>('publish_jobs').list({ fresh: true, where: j => ids.includes(String(j.content_item_id ?? '')) }),
    table<{ id: string; item_id?: string }>('schedule_entries').list({ fresh: true, where: e => ids.includes(String(e.item_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string }>('workflow_activity').list({ fresh: true, where: a => ids.includes(String(a.entity_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string; recipient_email?: string }>('notification_log').list({ fresh: true, where: n => ids.some(i => String(n.entity_id ?? '').includes(i)) || String(n.recipient_email ?? '').includes(`zz-joy2-${STAMP}`) }).catch(() => []),
    table<{ id: string; item_id?: string }>('item_comments').list({ fresh: true, where: c => ids.includes(String(c.item_id ?? '')) }).catch(() => []),
    table<{ id: string; item_id?: string }>('approvals').list({ fresh: true, where: c => ids.includes(String(c.item_id ?? '')) }).catch(() => []),
    table<{ id: string; item_id?: string }>('claim_locks').list({ fresh: true, where: c => ids.some(i => String(c.id ?? '').includes(i)) }).catch(() => []),
  ])
  const tables = ['asset_versions', 'social_posts', 'publish_jobs', 'schedule_entries', 'workflow_activity', 'notification_log', 'item_comments', 'approvals', 'claim_locks']
  for (let i = 0; i < strays.length; i++) for (const r of strays[i]) await table(tables[i] as never).remove(r.id).catch(() => {})
  const left = await Promise.all([
    table<ContentItem>('content_items').list({ fresh: true, where: i => String(i.title ?? '').startsWith(TAG) || ids.includes(i.id) }),
    table<SocialAccount>('social_accounts').list({ fresh: true, where: a => String(a.provider_account_id ?? '') === `zz-test2-${STAMP}` }),
    table<{ id: string; email: string }>('team_users').list({ fresh: true, where: u => String(u.email).includes(`zz-joy2-${STAMP}`) }),
    table<{ id: string; default_scheduler_ids?: unknown; posts_own_content?: unknown }>('clients').get(TEST_CLIENT_ID, { fresh: true }),
  ])
  console.log(`[teardown] left behind: items=${left[0].length} accounts=${left[1].length} users=${left[2].length} defaults=${JSON.stringify(left[3]?.default_scheduler_ids)} selfPosts=${JSON.stringify(left[3]?.posts_own_content ?? null)}`)
  expect(left[0].length + left[1].length + left[2].length).toBe(0)
  expect(left[3]?.default_scheduler_ids ?? []).toEqual(originalDefaults)
  expect(left[3]?.posts_own_content ?? null).toEqual(originalSelfPosts)
})
