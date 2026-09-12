import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'

/**
 * EVERY BUTTON ON THE EDITOR'S CARD, PRESSED FOR REAL — 12 Sep 2026.
 *
 * The Editor page and the editor's drawer, walked in the order the Video
 * Editors SOP (pp.20–21) gives the work, against the real database and the
 * real routes the buttons call. Each press is the request the button makes,
 * with the answer read back off the row, the history and the notification
 * log — never assumed. The page itself is NOT rendered here; the words the
 * page draws from are asserted through the same pure functions it uses.
 *
 *   manager   makes the card with files and a folder — the editor is told
 *   editor    sees only theirs · Acknowledge (once; a second press is a no-op)
 *             · Before you start rows ("Not given" when empty) · an empty card
 *             cannot be submitted · Upload the final (v1) · Pick from Drive, or
 *             its refusal · Source files link, checked · flag a deadline risk
 *             (managers told) · I'm blocked (need → SOP people, named person
 *             told, "Waiting on … from … since …") · Unblocked · the seven
 *             checks gate submit · Where should the reviewer look (https only)
 *             · Submit for quality check — STRAIGHT TO JOY (Abby's rule), the
 *             manager's check refused for content
 *   Joy       is told once, as are Ops and the client's managers · asks for
 *             changes (the card is back In Progress with the note)
 *   editor    revisions done needs a new version · v2 · back to Joy
 *   AM        may only ask for changes at the quality check — not pass it
 *   Joy       passes it: With the client, handed to the default scheduler
 *   client    approves on the portal → For Handoff; two ticks by hand, the
 *             third by the app
 *   scheduler books it (dry run) → Done
 *   editor    New card (simple): no kind picker — the kind follows the files
 *   general   sees their own card and nobody else's
 *
 * SAFETY: the ZZ TEST client and its `.invalid` accounts only; temporary
 * `.invalid` rows for Joy, Ops and a general user, deleted after;
 * EMAIL_TEST_ONLY (the mailer refuses a real address); PUBLISH_DRY_RUN;
 * every row this run makes is deleted at the end and the deletion read back.
 *
 *   EMAIL_TEST_ONLY=1 PUBLISH_DRY_RUN=1 \
 *     npx vitest run --config vitest.e2e.config.mts tests/e2e/editor-buttons.e2e.ts
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
import type { AssetVersion, ContentItem, PublishJob, SocialAccount, SocialPost, TeamUserClient, WorkKind } from '../../lib/db-types'
import type { TeamUser } from '../../app/lib/authz'
import { performTransition } from '../../app/lib/workflow'
import { visibleItems } from '../../app/lib/scope-client'
import { cardActions, cardLines, pageCards, EDITOR_LANE_LABELS, needsWorkFirst, UPLOAD_FIRST } from '../../app/lib/board-view-core'
import { boardColumn, columnOf } from '../../app/lib/board-core'
import { type ItemStatus } from '../../app/lib/workflow-core'
import {
  EDITOR_LANES, reviewWords, reviewerNameOf, beforeYouStart, NOT_GIVEN, QC_KEYS, qcDoneFor, handoverState, showsHandover,
  blockerWords, blockerNudgeDue, ackNudgeDue, assignedAtOf, blockedChip, HOUR,
} from '../../app/lib/editor-sop-core'
import { flagsOf } from '../../app/lib/card-flag-core'
import { kindIdForContentType } from '../../app/lib/work-kinds-core'
import { createPost, sendForApproval } from '../../app/lib/social-schedule'
import { postingEligibility } from '../../app/lib/social-schedule-core'
import { getPortalData } from '../../app/lib/portal-data'
import { putObject, deleteStoredObject } from '../../app/lib/storage'
import { POST as createItems } from '../../app/api/production/items/route'
import { PATCH as patchItem } from '../../app/api/production/items/[id]/route'
import { POST as addVersion } from '../../app/api/production/items/[id]/versions/route'
import { POST as flagCard } from '../../app/api/production/items/[id]/flag/route'
import { PUT as putLink } from '../../app/api/production/items/[id]/link/route'
import { POST as moveCard } from '../../app/api/production/items/[id]/transition/route'
import { POST as sendBack } from '../../app/api/production/items/[id]/send-back/route'
import { GET as driveList } from '../../app/api/social/schedule/drive/route'
import { POST as portalAct } from '../../app/api/portal/act/route'

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
  id: 'a0000000-0000-4000-8000-0000000000b2', role: 'editor',
  email: 'zz-other-editor@mdmedia-test.invalid', name: 'ZZ Other editor', clerk_user_id: null,
} as TeamUser

const STAMP = Date.now()
const TAG = `ZZ TEST EDITOR BUTTONS ${STAMP}`
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9])
const SLIDES: { url: string; name: string; type: 'image'; bytes: number; source: 'upload' }[] = []
const melbourneToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
const plusDays = (n: number) => {
  const [y, m, d] = melbourneToday().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

let am: TeamUser, editor: TeamUser, scheduler: TeamUser, clientUser: TeamUser, joy: TeamUser, ops: TeamUser, general: TeamUser
let kinds: WorkKind[] = []
let channelId = ''
let itemId = ''
let simpleId = ''
let generalId = ''
let shareToken = ''
let originalDefaults: unknown = []
const runStart = new Date().toISOString()
const created = {
  items: new Set<string>(), versions: new Set<string>(), posts: new Set<string>(), jobs: new Set<string>(),
  locks: new Set<string>(), accounts: new Set<string>(), entries: new Set<string>(), users: new Set<string>(), links: new Set<string>(),
}
let assignments: TeamUserClient[] = []
const names = new Map<string, string>()

/* ── the screen, written down ─────────────────────────────────────────── */

const script: string[] = []
const say = (line: string) => { script.push(line); console.log(line) }
const SCRIPT_PATH = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-myProjects-content/c33ff7c1-ad55-46c0-8973-dffcbb410744/scratchpad/editor-buttons-script.txt'

const as = (who: TeamUser) => {
  Object.assign(h.user, { id: who.id, role: who.role, email: who.email, name: who.name, clerk_user_id: who.clerk_user_id ?? null, quality_reviewer: (who as { quality_reviewer?: boolean }).quality_reviewer === true })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (res: Response | undefined) => res ? ({ status: res.status, body: await res.json().catch(() => ({})) }) : ({ status: 0, body: { error: 'no response' } })
const req = (body: unknown, method = 'POST') => new Request('https://x.test/r', { method, body: JSON.stringify(body) })
const viewerOf = (who: TeamUser) => ({ id: who.id, role: who.role, quality_reviewer: (who as { quality_reviewer?: boolean }).quality_reviewer === true }) as never
const row = async (id = itemId) => (await table<ContentItem>('content_items').get(id, { fresh: true }))!
const ourRows = async () => {
  const ids = [...created.items]
  const rows = await table<ContentItem>('content_items').list({ fresh: true, where: r => ids.includes(r.id) })
  return (await attachOne(rows, 'work_kind_id', 'work_kinds', ['slug', 'name'])).map(r => ({ ...r, clients: { name: 'ZZ TEST' } })) as unknown as (ContentItem & { work_kinds?: { slug?: string } | null })[]
}
const activityOf = async (id: string) =>
  table<{ id: string; action: string; actor_id?: string | null; detail?: string | null; created_at?: string | null; entity_id?: string }>('workflow_activity')
    .list({ fresh: true, where: a => String(a.entity_id ?? '') === id })
const seenBy = (who: TeamUser, rows: ContentItem[]) =>
  visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false } as never).map(r => r.id).sort()

type Told = { recipient_email: string; subject: string; event_type: string; status: string; entity_id: string }
/** every notification for OUR rows since a moment — a refused one (the kill switch) is not a leak */
async function toldSince(since: string, id = itemId): Promise<Told[]> {
  const rows = await table<{ id: string; recipient_email?: string; subject?: string; event_type?: string; created_at?: string; status?: string; entity_id?: string }>('notification_log')
    .list({ fresh: true, where: n => String(n.created_at ?? '') >= since && String(n.entity_id ?? '').includes(id) })
  return rows.map(r => ({ recipient_email: String(r.recipient_email ?? ''), subject: String(r.subject ?? ''), event_type: String(r.event_type ?? ''), status: String(r.status ?? ''), entity_id: String(r.entity_id ?? '') }))
}
async function toldUntil(since: string, done: (rows: Told[]) => boolean, id = itemId) {
  const deadline = Date.now() + 120_000
  let rows = await toldSince(since, id)
  while (!done(rows) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300))
    rows = await toldSince(since, id)
  }
  return rows
}
const settle = () => new Promise(r => setTimeout(r, 1500))
const noLeak = (told: { recipient_email: string; status: string }[]) =>
  expect(told.filter(t => t.status === 'sent').every(t => t.recipient_email.endsWith('.invalid')), 'a real inbox was emailed').toBe(true)
const toldLine = (told: Told[]) => told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ') || 'nobody'

/** the editor's board for OUR cards — lane, words, chip, face button */
async function screenEditor(who: TeamUser, label: string) {
  const rows = await ourRows()
  const visible = visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false } as never) as unknown as ContentItem[]
  const cards = pageCards('editor', visible as never, viewerOf(who), melbourneToday()) as unknown as ContentItem[]
  if (cards.length === 0) { say(`   ${label} — Editor: nothing`); return }
  const team = await table<TeamUser>('team_users').list({ fresh: true, where: u => u.id === joy.id })
  for (const c of cards) {
    const col = columnOf(c.status as ItemStatus)
    const lane = EDITOR_LANES.find(l => l.columns.includes(col))
    const lines = cardLines(c as never, { names, today: melbourneToday(), viewerId: who.id })
    const acts = cardActions(c as never, viewerOf(who))
    const primary = acts.primary
    // the face's own rule (BoardCard.tsx): the maker's submit opens the card
    const faceOpens = primary?.kind === 'transition' && ['quality_check', 'internal_review', 'revision_complete'].includes(String(primary.to))
    const face = primary ? (faceOpens ? (needsWorkFirst(c as never) ? UPLOAD_FIRST : 'Quality check, then submit') : primary.label) : acts.more[0]?.label ?? 'none'
    const flags = flagsOf(await activityOf(c.id), who.id)
    const review = reviewWords(c.status, reviewerNameOf(team as never))
    say(`   ${label} — Editor: "${lines.title}" in ${lane?.label ?? EDITOR_LANE_LABELS[col] ?? boardColumn(col).label}${review ? ` · ${review}` : ''} · ${lines.assignee}${lines.due ? ` · ${lines.due}` : ''}${flags.acknowledged ? ' · acknowledged' : ' · New — press Acknowledge'}${flags.risk ? ` · risk "${flags.risk}"` : ''}${blockedChip(c as never) ? ` · ${blockedChip(c as never)}` : ''} · face button: ${face}`)
  }
}

/* ── setup ─────────────────────────────────────────────────────────────── */

beforeAll(() => withRequestCache(async () => {
  if (process.env.EMAIL_TEST_ONLY !== '1') throw new Error('EMAIL_TEST_ONLY is not set — refusing to run')
  process.env.PUBLISH_DRY_RUN = '1'
  const client = await table<{ id: string; name: string; share_token: string | null; default_scheduler_ids?: unknown }>('clients').get(TEST_CLIENT_ID)
  if (!client || !/^ZZ TEST/.test(client.name)) throw new Error('ZZ TEST client not found')
  shareToken = String(client.share_token ?? '')
  originalDefaults = client.default_scheduler_ids ?? []
  const people = await table<TeamUser & { id: string }>('team_users').list({ where: u => Object.values(IDS).includes(u.id) })
  am = people.find(u => u.id === IDS.am)!; editor = people.find(u => u.id === IDS.editor)!
  scheduler = people.find(u => u.id === IDS.scheduler)!; clientUser = people.find(u => u.id === IDS.client)!
  if (!am || !editor || !scheduler || !clientUser) throw new Error('Test accounts missing')
  for (const p of [am, editor, scheduler, clientUser]) if (!p.email.endsWith('.invalid')) throw new Error(`refusing: ${p.email} is real`)
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: TEST_CLIENT_ID } })
  const emails = (await attachOne(links, 'team_user_id', 'team_users', ['email'])).map(r => (r.team_users as { email: string } | null)?.email).filter((e): e is string => !!e)
  if (emails.some(e => !e.endsWith('.invalid'))) throw new Error('ZZ TEST client is managed by real people')

  const mk = async (fields: Record<string, unknown>) => {
    const r = await table<TeamUser & { id: string }>('team_users').insert({
      clerk_user_id: null, active_status: true, employment_type: 'employee', timezone: 'Australia/Melbourne', client_id: null,
      quality_reviewer: false, ops_contact: false, ...fields,
    } as never)
    created.users.add(r.id)
    return r
  }
  // Joy: a manager on the test client, flagged as the quality reviewer
  const j = await mk({ email: `zz-joy-${STAMP}@mdmedia-test.invalid`, name: 'Joy ZZTest', role: 'account_manager', quality_reviewer: true })
  joy = { ...j, quality_reviewer: true } as never
  const link = await table<TeamUserClient>('team_user_clients').insert({ id: `${j.id}__${TEST_CLIENT_ID}`, team_user_id: j.id, client_id: TEST_CLIENT_ID } as never)
  created.links.add(link.id)
  // Ops: flagged, NOT on the client — told only as the Ops contact
  ops = (await mk({ email: `zz-ops-${STAMP}@mdmedia-test.invalid`, name: 'ZZ Ops', role: 'account_manager', ops_contact: true })) as never
  // a general user with a row (a card can only be owned by a real row)
  general = (await mk({ email: `zz-general-${STAMP}@mdmedia-test.invalid`, name: 'ZZ General', role: 'general' })) as never
  assignments = await table<TeamUserClient>('team_user_clients').list({ fresh: true, by: { client_id: TEST_CLIENT_ID } })
  for (const p of [am, editor, scheduler, joy, ops, general, SUPER, OTHER]) names.set(p.id, p.name)
  kinds = await table<WorkKind>('work_kinds').list({ fresh: true })

  await table('clients').update(TEST_CLIENT_ID, { default_scheduler_ids: [scheduler.id] } as never)
  const account = await table<SocialAccount>('social_accounts').insert({
    client_id: TEST_CLIENT_ID, platform: 'instagram', provider_account_id: `zz-test-eb-${STAMP}`,
    name: `${TAG} channel`, username: `zz_test_eb_${STAMP}`, avatar_url: null, active: true,
    connected_at: new Date().toISOString(), last_synced_at: new Date().toISOString(),
  } as never)
  created.accounts.add(account.id); channelId = account.id
  for (const n of ['one', 'two', 'raw']) {
    const put = await putObject(`zztest-eb-${STAMP}-${n}.jpg`, JPEG, 'image/jpeg')
    SLIDES.push({ url: put.publicUrl, name: `${n}.jpg`, type: 'image', bytes: JPEG.length, source: 'upload' })
  }
  say(`[setup] client=${TEST_CLIENT_ID} joy=${joy.email} ops=${ops.email} general=${general.email} files=${SLIDES.length}`)
}))

/* ── the walk ───────────────────────────────────────────────────────────── */

describe('the editor’s card, every button, live', () => {
  it('1. the manager makes the card with files and a folder; the editor is told; only the editor sees it', async () => {
    as(am)
    const since = new Date().toISOString()
    const made = await json(await createItems(req({
      client_id: TEST_CLIENT_ID, title: `${TAG} — hero reel`, work_kind_id: kindIdForContentType(kinds as never, 'video'),
      owner_id: editor.id, content_type: 'reel', due_date: plusDays(7),
      brief: 'Hero reel, 30 seconds. Hook in the first two seconds; end on the logo.',
      raw_assets: [{ url: SLIDES[2].url, name: 'raw.jpg' }], raw_assets_url: 'https://www.dropbox.com/scl/fo/zztest-footage',
      adhoc_reason: 'ZZ TEST: the footage is in the Dropbox folder',
    })))
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    const first = Array.isArray(made.body) ? made.body[0] : made.body
    itemId = String(first.id); created.items.add(itemId)
    const card = await row()
    expect(card.status).toBe('draft_uploaded')
    expect(card.owner_id).toBe(editor.id)
    expect(Array.isArray(card.raw_assets) && (card.raw_assets as unknown[]).length).toBe(1)
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === editor.email))
    noLeak(told)
    expect(told.filter(t => t.recipient_email === editor.email && /yours to make/.test(t.subject))).toHaveLength(1)
    say(`Step 1 — AM pressed New card: "${card.title}" · told: ${toldLine(told)}`)

    const rows = await ourRows()
    expect(seenBy(editor, rows)).toEqual([itemId])
    expect(seenBy(OTHER, rows)).toEqual([])
    expect(seenBy(scheduler, rows)).toEqual([])
    expect(seenBy(general, rows)).toEqual([])
    await screenEditor(editor, 'Editor'); await screenEditor(OTHER, 'Other editor')
  })

  it('2. Acknowledge — once; a second press changes nothing; the morning-after nudge rule', async () => {
    as(editor)
    const one = await json(await flagCard(req({ kind: 'acknowledged' }), params(itemId)))
    expect(one.status, JSON.stringify(one.body)).toBe(200)
    expect(one.body.already).toBeUndefined()
    const two = await json(await flagCard(req({ kind: 'acknowledged' }), params(itemId)))
    expect(two.status).toBe(200)
    expect(two.body.already).toBe(true)
    const acts = await activityOf(itemId)
    expect(acts.filter(a => a.action === 'acknowledged')).toHaveLength(1)
    expect(flagsOf(acts, editor.id).acknowledged).toBe(true)
    // the sweep's own rule on this row: acknowledged → no nudge, ever
    const card = await row()
    expect(ackNudgeDue({ assignedAt: assignedAtOf(card, acts), acknowledged: true, ack_nudged_at: null, todayKey: melbourneToday() })).toBe(false)
    // …and an unacknowledged card assigned yesterday gets exactly one
    expect(ackNudgeDue({ assignedAt: plusDays(-1), acknowledged: false, ack_nudged_at: null, todayKey: melbourneToday() })).toBe(true)
    expect(ackNudgeDue({ assignedAt: plusDays(-1), acknowledged: false, ack_nudged_at: new Date().toISOString(), todayKey: melbourneToday() })).toBe(false)
    // somebody else cannot acknowledge the editor's card
    as(OTHER)
    const notMine = await json(await flagCard(req({ kind: 'acknowledged' }), params(itemId)))
    expect([403, 404]).toContain(notMine.status)
    say(`Step 2 — Acknowledge pressed twice: one history line · other editor refused: "${notMine.body.error}"`)
    await screenEditor(editor, 'Editor')
  })

  it('3. Before you start: every row drawn, an empty one says Not given, previous edits opens the editor’s own page', async () => {
    const card = await row()
    const rows = beforeYouStart({ card: card as never, shoot: null, specs: [], driveFolderUrl: null })
    const byKey = Object.fromEntries(rows.map(r => [r.key, r]))
    expect(byKey.objective.value).toMatch(/Hero reel/)
    expect(byKey.deadline.value).toBe(plusDays(7))
    for (const k of ['deliverables', 'specs', 'shot_list', 'script', 'notes']) expect(byKey[k].value, k).toBeNull()
    expect(byKey.previous.href).toBe(`/dashboard/editor?client=${encodeURIComponent(TEST_CLIENT_ID)}&column=posted`)
    say(`Step 3 — Before you start: ${rows.map(r => `${r.label}: ${r.value ?? NOT_GIVEN}`).join(' · ')}`)
  })

  it('4. an empty card cannot be submitted: the face says Upload the final first; the route refuses', async () => {
    as(editor)
    const card = await row()
    expect(needsWorkFirst(card as never)).toBe(true)
    const acts = cardActions(card as never, viewerOf(editor))
    expect(acts.primary?.kind).toBe('transition')
    expect((acts.primary as { to?: string }).to).toBe('quality_check')
    const r = await json(await moveCard(req({ to: 'quality_check' }), params(itemId)))
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.body.error).toMatch(/Add a version|version/i)
    expect((await row()).status).toBe('draft_uploaded')
    say(`Step 4 — Submit on an empty card: face "${UPLOAD_FIRST}" · route: "${r.body.error}"`)
  })

  it('5. Upload the final (v1); Pick from Google Drive answers or says why not; the source files link is checked', async () => {
    as(editor)
    const v = await json(await addVersion(req({ files: [SLIDES[0]], notes: 'Final export' }), params(itemId)))
    expect(v.status, JSON.stringify(v.body)).toBe(201)
    for (const ver of await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })) created.versions.add(ver.id)
    expect(Number((await row()).current_version_number)).toBe(1)

    const drive = await json(await driveList(new Request(`https://x.test/api/social/schedule/drive?itemId=${itemId}`)))
    expect(drive.status).toBe(200)
    const driveWords = drive.body.error ? `refused: "${drive.body.error}"` : `${(drive.body.files ?? []).length} file(s) offered`
    if (drive.body.error) expect(String(drive.body.error)).toMatch(/Drive|folder/i)

    const bad = await json(await putLink(req({ url: 'not a link' }, 'PUT'), params(itemId)))
    expect(bad.status).toBe(400)
    const good = await json(await putLink(req({ url: 'https://www.dropbox.com/scl/fo/zztest-source' }, 'PUT'), params(itemId)))
    expect(good.status, JSON.stringify(good.body)).toBe(200)
    expect((await row()).link_url).toBe('https://www.dropbox.com/scl/fo/zztest-source')
    // somebody else cannot change the link
    as(OTHER)
    const notMine = await json(await putLink(req({ url: 'https://www.dropbox.com/scl/fo/other' }, 'PUT'), params(itemId)))
    expect([403, 404]).toContain(notMine.status)
    say(`Step 5 — v1 uploaded · Drive: ${driveWords} · bad source link: "${bad.body.error}" · saved · other editor: "${notMine.body.error}"`)
    await screenEditor(editor, 'Editor')
  })

  it('6. Something looks wrong — flag it: a line is required; the client’s managers are told, not the editor', async () => {
    as(editor)
    const empty = await json(await flagCard(req({ kind: 'deadline_risk' }), params(itemId)))
    expect(empty.status).toBe(400)
    expect(empty.body.error).toBe('Say in a line why the date is at risk')
    const since = new Date().toISOString()
    const r = await json(await flagCard(req({ kind: 'deadline_risk', note: 'Colour grade needs another day' }), params(itemId)))
    expect(r.status).toBe(200)
    const told = await toldUntil(since, t => t.some(x => /Deadline at risk/.test(x.subject)))
    noLeak(told)
    const risk = told.filter(t => /Deadline at risk/.test(t.subject))
    expect(risk.length).toBeGreaterThan(0)
    expect(risk.every(t => t.recipient_email !== editor.email)).toBe(true)
    expect(new Set(risk.map(t => t.recipient_email)).size).toBe(risk.length)
    expect(flagsOf(await activityOf(itemId), editor.id).risk).toBe('Colour grade needs another day')
    say(`Step 6 — flag it: empty → "${empty.body.error}" · told: ${toldLine(risk)}`)
    await screenEditor(editor, 'Editor')
  })

  it('7. I’m blocked: a need and a line are required; the SOP’s people and the named person are told; Unblocked clears it', async () => {
    as(editor)
    const noNeed = await json(await flagCard(req({ kind: 'blocked', note: 'x' }), params(itemId)))
    expect(noNeed.status).toBe(400); expect(noNeed.body.error).toBe('Pick what you need from the list')
    const noNote = await json(await flagCard(req({ kind: 'blocked', need: 'brief' }), params(itemId)))
    expect(noNote.status).toBe(400); expect(noNote.body.error).toBe('Say in a line what is blocked')
    const since = new Date().toISOString()
    const r = await json(await flagCard(req({ kind: 'blocked', need: 'brief', from_id: am.id, note: 'The brief does not say what the reel is for' }), params(itemId)))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.told).toContain(am.name)
    const card = await row() as ContentItem & { blocked_need?: string; blocked_from_id?: string; blocked_at?: string }
    expect(card.blocked_need).toBe('brief'); expect(card.blocked_from_id).toBe(am.id); expect(card.blocked_at).toBeTruthy()
    const words = blockerWords(card, id => names.get(String(id)) ?? null, iso => iso.slice(0, 16))
    expect(words).toMatch(/^Waiting on brief or creative direction from .+ since /)
    expect(blockedChip(card)).toBe('Blocked: brief or creative direction')
    const told = await toldUntil(since, t => t.some(x => x.event_type === 'editor_blocked' && x.recipient_email === am.email))
    noLeak(told)
    expect(told.filter(t => t.event_type === 'editor_blocked' && t.recipient_email === am.email)).toHaveLength(1)
    expect(told.some(t => t.recipient_email === editor.email)).toBe(false)
    // the ladder, on this very row: nothing yet, Ops at 12 h, leadership at 24 h — each once
    const at = new Date(card.blocked_at!).getTime()
    expect(blockerNudgeDue(card, at + 1 * HOUR)).toBeNull()
    expect(blockerNudgeDue(card, at + 13 * HOUR)).toBe('12')
    expect(blockerNudgeDue({ ...card, blocked_nudged_12_at: 'x' }, at + 13 * HOUR)).toBeNull()
    expect(blockerNudgeDue({ ...card, blocked_nudged_12_at: 'x' }, at + 25 * HOUR)).toBe('24')
    expect(blockerNudgeDue({ ...card, blocked_nudged_12_at: 'x', blocked_nudged_24_at: 'x' }, at + 30 * HOUR)).toBeNull()
    say(`Step 7 — I’m blocked: "${words}" · told: ${toldLine(told.filter(t => t.event_type === 'editor_blocked'))}`)
    await screenEditor(editor, 'Editor')

    const un = await json(await flagCard(req({ kind: 'unblocked' }), params(itemId)))
    expect(un.status).toBe(200)
    const after = await row() as ContentItem & { blocked_at?: string | null }
    expect(after.blocked_at ?? null).toBeNull()
    expect(blockerWords(after as never, () => null, s => s)).toBeNull()
    say('   Unblocked pressed: the line is gone')
  })

  it('8. the seven checks gate submit; where the reviewer looks must be https; submit goes straight to Joy; Joy, Ops and the AM told once each', async () => {
    as(editor)
    const six = await json(await flagCard(req({ kind: 'qc_done', ticks: QC_KEYS.slice(0, 6) }), params(itemId)))
    expect(six.status).toBe(400); expect(six.body.error).toBe('Tick every check before you submit')
    const seven = await json(await flagCard(req({ kind: 'qc_done', ticks: QC_KEYS }), params(itemId)))
    expect(seven.status).toBe(200)
    expect(qcDoneFor(await row() as never)).toBe(true)
    expect((await activityOf(itemId)).some(a => a.action === 'qc_done' && /^QC done: Watched the full export/.test(String(a.detail)))).toBe(true)

    const badLink = await json(await patchItem(req({ review_link: 'canva.com/design/abc', review_note: 'page 3' }, 'PATCH'), params(itemId)))
    expect(badLink.status).toBe(400); expect(badLink.body.error).toBe('The review link must start with https://')
    const where = await json(await patchItem(req({ review_link: 'https://www.canva.com/design/zztest', review_note: 'page 3' }, 'PATCH'), params(itemId)))
    expect(where.status, JSON.stringify(where.body)).toBe(200)
    const withLink = await row() as ContentItem & { review_link?: string; review_note?: string }
    expect(withLink.review_link).toBe('https://www.canva.com/design/zztest'); expect(withLink.review_note).toBe('page 3')

    // the manager's check is not on the road for content
    const old = await json(await moveCard(req({ to: 'internal_review' }), params(itemId)))
    expect(old.status).toBeGreaterThanOrEqual(400)
    expect(old.body.error).toMatch(/tasks and shoot plans/)
    const since = new Date().toISOString()
    const r = await json(await moveCard(req({ to: 'quality_check' }), params(itemId)))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect((await row()).status).toBe('quality_check')
    const told = await toldUntil(since, t => [joy.email, ops.email, am.email].every(e => t.some(x => x.recipient_email === e)))
    noLeak(told)
    for (const p of [joy, ops, am]) expect(told.filter(t => t.recipient_email === p.email), p.name).toHaveLength(1)
    expect(told.some(t => t.recipient_email === editor.email)).toBe(false)
    // the chip: the reviewer's first name
    expect(reviewWords('quality_check', reviewerNameOf([joy as never]))).toBe('With Joy')
    expect(reviewWords('quality_check', null)).toBe('With the quality reviewer')
    const rows = await ourRows()
    expect(seenBy(editor, rows)).toEqual([itemId]); expect(seenBy(scheduler, rows)).toEqual([]); expect(seenBy(joy, rows)).toEqual([itemId])
    say(`Step 8 — six ticks: "${six.body.error}" · bad link: "${badLink.body.error}" · manager's check: "${old.body.error}" · Submit for quality check → Quality check · told: ${toldLine(told)}`)
    await screenEditor(editor, 'Editor')
  })

  it('9. Joy asks for changes: the card is back In Progress with the note; revisions done needs a new version; v2 goes back to Joy', async () => {
    as(joy)
    const empty = await json(await sendBack(req({}), params(itemId)))
    expect(empty.status).toBe(400); expect(empty.body.error).toBe('Say what needs changing first')
    const since = new Date().toISOString()
    const back = await json(await sendBack(req({ note: 'Tighten the hook — first two seconds are slow' }), params(itemId)))
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    const card = await row() as ContentItem & { change_note?: string }
    expect(card.status).toBe('revision_required')
    expect(card.change_note).toMatch(/Tighten the hook/)
    expect(EDITOR_LANES.find(l => l.columns.includes(columnOf('revision_required')))?.key).toBe('in_progress')
    expect(beforeYouStart({ card: card as never, shoot: null, specs: [], driveFolderUrl: null }).find(r => r.key === 'notes')?.value).toMatch(/Tighten the hook/)
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === editor.email))
    noLeak(told)
    expect(told.filter(t => t.recipient_email === editor.email)).toHaveLength(1)
    say(`Step 9 — Joy asked for changes: In Progress, "What to change: ${card.change_note}" · told: ${toldLine(told)}`)
    await screenEditor(editor, 'Editor')

    as(editor)
    const tooSoon = await json(await moveCard(req({ to: 'quality_check' }), params(itemId)))
    expect(tooSoon.status).toBeGreaterThanOrEqual(400)
    expect(tooSoon.body.error).toMatch(/new version/i)
    const v2 = await json(await addVersion(req({ files: [SLIDES[1]], notes: 'Tighter hook' }), params(itemId)))
    expect(v2.status, JSON.stringify(v2.body)).toBe(201)
    for (const ver of await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })) created.versions.add(ver.id)
    const since2 = new Date().toISOString()
    const again = await json(await moveCard(req({ to: 'quality_check' }), params(itemId)))
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect((await row()).status).toBe('quality_check')
    const told2 = await toldUntil(since2, t => t.some(x => x.recipient_email === joy.email))
    noLeak(told2)
    expect(told2.filter(t => t.recipient_email === joy.email)).toHaveLength(1)
    say(`   revisions done without a version: "${tooSoon.body.error}" · v2 → back with Joy · told: ${toldLine(told2)}`)
    await screenEditor(editor, 'Editor')
  })

  it('10. the AM may only ask for changes at the quality check; Joy passes it: With the client, handed to the scheduler', async () => {
    const card = await row()
    const amActs = cardActions(card as never, viewerOf(am))
    // the manager's one button: Send back for changes — no pass, no approve
    const amButtons = [amActs.primary, ...amActs.more].filter((a): a is NonNullable<typeof a> => !!a)
    expect(amButtons.map(a => a.kind)).toEqual(['send_back'])
    expect(amButtons.some(a => a.kind === 'transition')).toBe(false)
    await expect(performTransition(am, card as never, 'client_review')).rejects.toThrow()
    await expect(performTransition(am, card as never, 'approved_for_scheduling')).rejects.toThrow()
    as(joy)
    const passed = await json(await moveCard(req({ to: 'client_review', note: 'Passed' }), params(itemId)))
    expect(passed.status, JSON.stringify(passed.body)).toBe(200)
    const after = await row() as ContentItem & { delivered_at?: string }
    expect(after.status).toBe('client_review')
    expect(after.scheduler_ids).toEqual([scheduler.id])
    expect(after.delivered_at).toBeTruthy()
    expect(reviewWords(after.status)).toBe('With the client')
    expect(EDITOR_LANES.find(l => l.columns.includes(columnOf('client_review')))?.key).toBe('quality_check')
    const portal = (await getPortalData(TEST_CLIENT_ID))?.cards.find(c => c.id === itemId)
    expect(portal).toBeTruthy()
    say(`Step 10 — AM's buttons at Quality check: Ask for changes only · Joy passed → With the client · portal: "${portal?.title}" in ${portal?.column}`)
    await screenEditor(editor, 'Editor')
  })

  it('11. the client approves: For Handoff; two ticks by hand, the third by the app', async () => {
    const r = await json(await portalAct(req({ token: shareToken, item_id: itemId, action: 'approve', author_name: 'ZZ Client' })))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    let card = await row()
    expect(card.status).toBe('approved_for_scheduling')
    expect(showsHandover(card.status)).toBe(true)
    expect(EDITOR_LANES.find(l => l.columns.includes(columnOf(card.status as ItemStatus)))?.key).toBe('for_handoff')
    let hand = handoverState(card as never)
    expect(hand.map(x => [x.key, x.done])).toEqual([['drive', false], ['source', false], ['owner', true]])
    as(editor)
    expect((await json(await flagCard(req({ kind: 'handover_drive' }), params(itemId)))).status).toBe(200)
    expect((await json(await flagCard(req({ kind: 'handover_source' }), params(itemId)))).status).toBe(200)
    card = await row()
    hand = handoverState(card as never)
    expect(hand.every(x => x.done)).toBe(true)
    // the editor's buttons here: none — the scheduler's turn
    const acts = cardActions(card as never, viewerOf(editor))
    expect([acts.primary, ...acts.more].filter(Boolean).filter(a => a!.kind === 'transition')).toEqual([])
    say(`Step 11 — client approved → For Handoff · ticks: ${hand.map(x => `${x.label}: ${x.done ? 'Done' : 'Not yet'}`).join(' · ')}`)
    await screenEditor(editor, 'Editor')
  })

  it('12. the scheduler books it (dry run): Done, folded; the files are the channel’s now', async () => {
    as(scheduler)
    const versions = await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })
    const elig = postingEligibility((await row()) as never, versions as never, false)
    expect(elig.ok, JSON.stringify(elig)).toBe(true)
    const draft = await createPost(scheduler, { item_id: itemId, slides: elig.ok ? elig.slides : [], caption: `${TAG} hero`, channels: [channelId], scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString() })
    created.posts.add(draft.id); created.locks.add(`social_post__${itemId}`); created.locks.add(`publish__${itemId}`)
    const booked = await sendForApproval(scheduler, draft.id, { mode: 'direct' })
    for (const j of booked.publish_job_ids) created.jobs.add(j)
    expect(booked.status).toBe('scheduled')
    for (const e of await table<{ id: string; item_id: string }>('schedule_entries').list({ fresh: true, by: { item_id: itemId } as never })) created.entries.add(e.id)
    const card = await row()
    expect(card.status).toBe('scheduled')
    expect(EDITOR_LANES.find(l => l.columns.includes(columnOf('scheduled')))?.key).toBe('done')
    expect(EDITOR_LANES.find(l => l.key === 'done')?.folded).toBe(true)
    say('Step 12 — booked in (dry run) → Done')
    await screenEditor(editor, 'Editor')
  })

  it('13. New card (simple): no kind picker — stills make a graphics card, owned by the editor; a general user sees only their own', async () => {
    as(editor)
    const since = new Date().toISOString()
    // the dialog's own rule: every file a still → graphics; else a video edit
    const kindId = kindIdForContentType(kinds as never, 'static')
    const made = await json(await createItems(req({
      client_id: TEST_CLIENT_ID, title: `${TAG} — story tile`, work_kind_id: kindId, owner_id: editor.id, content_type: 'other',
      raw_assets: [{ url: SLIDES[2].url, name: 'raw.jpg' }], adhoc_reason: 'Made on the board',
    })))
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    simpleId = String((Array.isArray(made.body) ? made.body[0] : made.body).id); created.items.add(simpleId)
    const simple = (await ourRows()).find(r => r.id === simpleId)!
    expect(simple.status).toBe('draft_uploaded'); expect(simple.owner_id).toBe(editor.id)
    expect(simple.work_kinds?.slug).toBe('graphics')
    expect(kindIdForContentType(kinds as never, 'video')).not.toBe(kindId)
    // no email to yourself for your own card
    await settle()
    expect((await toldSince(since, simpleId)).filter(t => t.recipient_email === editor.email)).toHaveLength(0)

    as(SUPER)
    const g = await json(await createItems(req({
      client_id: TEST_CLIENT_ID, title: `${TAG} — general's task`, work_kind_id: kindIdForContentType(kinds as never, 'video'), owner_id: general.id, content_type: 'reel',
      adhoc_reason: 'ZZ TEST general',
    })))
    expect(g.status, JSON.stringify(g.body)).toBe(201)
    generalId = String((Array.isArray(g.body) ? g.body[0] : g.body).id); created.items.add(generalId)
    const rows = await ourRows()
    expect(seenBy(general, rows)).toEqual([generalId])
    expect(seenBy(editor, rows)).toEqual([itemId, simpleId].sort())
    expect(seenBy(OTHER, rows)).toEqual([])
    say(`Step 13 — New card (simple): "${simple.title}" · kind ${simple.work_kinds?.slug} · general sees ${seenBy(general, rows).length} card(s), the editor ${seenBy(editor, rows).length}`)
    await screenEditor(editor, 'Editor'); await screenEditor(general, 'General')
  })

  it('14. no real inbox was emailed, ever', async () => {
    const all: Told[] = []
    for (const id of created.items) all.push(...await toldSince(runStart, id))
    noLeak(all)
    expect(all.every(t => t.recipient_email.endsWith('.invalid'))).toBe(true)
    say(`\n${all.length} notifications logged for this run, every one to a .invalid address (${all.filter(t => t.status === 'sent').length} accepted by the mailer)`)
  })
})

afterAll(async () => {
  writeFileSync(SCRIPT_PATH, script.join('\n'), 'utf8')
  await settle()
  await table('clients').update(TEST_CLIENT_ID, { default_scheduler_ids: originalDefaults } as never).catch(() => {})
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
    table<{ id: string; entity_id?: string; recipient_email?: string }>('notification_log').list({ fresh: true, where: n => ids.some(i => String(n.entity_id ?? '').includes(i)) || [joy, ops, general].some(p => p && String(n.recipient_email ?? '') === p.email) }).catch(() => []),
    table<{ id: string; item_id?: string }>('item_comments').list({ fresh: true, where: c => ids.includes(String(c.item_id ?? '')) }).catch(() => []),
    table<{ id: string; item_id?: string }>('approvals').list({ fresh: true, where: c => ids.includes(String(c.item_id ?? '')) }).catch(() => []),
  ])
  const tables = ['asset_versions', 'social_posts', 'publish_jobs', 'schedule_entries', 'workflow_activity', 'notification_log', 'item_comments', 'approvals']
  for (let i = 0; i < tables.length; i++) for (const r of strays[i] as { id: string }[]) await table(tables[i] as never).remove(r.id).catch(() => {})
  // read the deletion back
  for (const id of ids) expect(await table('content_items').get(id, { fresh: true })).toBeNull()
  for (const id of created.users) expect(await table('team_users').get(id, { fresh: true })).toBeNull()
  for (const id of created.accounts) expect(await table('social_accounts').get(id, { fresh: true })).toBeNull()
  const left = await table<{ id: string; entity_id?: string }>('workflow_activity').list({ fresh: true, where: a => ids.includes(String(a.entity_id ?? '')) }).catch(() => [])
  expect(left).toEqual([])
  const client = await table<{ id: string; default_scheduler_ids?: unknown }>('clients').get(TEST_CLIENT_ID, { fresh: true })
  expect(client?.default_scheduler_ids ?? []).toEqual(originalDefaults)
  console.log(`[teardown] ${ids.length} cards, ${created.users.size} people, ${strays.flat().length} stray rows removed and read back as gone`)
})
