import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'

/**
 * THE WHOLE JOURNEY OF THE TEAM'S PLAYBOOK, ON THE REAL DATABASE — 11 Sep 2026.
 *
 *   super admin   starts a shoot for the test client
 *   AM            fills the nine parts, names the editor and crew, shares it,
 *                 is refused "go" until everyone has read it, then signs off
 *   editor/crew   press "I've read the plan"
 *   Ops           sends the reminder; after the day, hands the footage over
 *   editor        acknowledges the card, uploads the final, flags a risk,
 *                 presses Ready for checking
 *   AM            cannot send it to the client (the gate); sends it to Joy
 *   Joy           asks for changes once, then passes it; the card is handed
 *                 to the client's default scheduler and they are told
 *   client        approves on the portal
 *   scheduler     books it (dry run); the provider says it went out; Posted
 *
 * At EVERY step the SCREEN is written down for every role — the page and
 * column, the card's words, the chip, the buttons, the tiles, the portal —
 * using the same pure functions the pages draw from, into a script file
 * the report is built from. Nothing here is assumed from memory.
 *
 * SAFETY: the ZZ TEST client and its `.invalid` accounts only; a temporary
 * `.invalid` quality reviewer made for this run and deleted after;
 * EMAIL_TEST_ONLY (the mailer refuses a real address); PUBLISH_DRY_RUN (no
 * socket to the provider); every row this run makes is deleted at the end
 * and the deletion read back; the client's default schedulers are restored.
 *
 *   EMAIL_TEST_ONLY=1 PUBLISH_DRY_RUN=1 \
 *     npx vitest run --config vitest.e2e.config.mts tests/e2e/playbook-roleplay.e2e.ts
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
import type { AssetVersion, Batch, ContentItem, PublishJob, SocialAccount, SocialPost, TeamUserClient } from '../../lib/db-types'
import type { TeamUser } from '../../app/lib/authz'
import { performTransition } from '../../app/lib/workflow'
import { visibleItems } from '../../app/lib/scope-client'
import { cardActions, cardLines, overviewTiles, pageCards, EDITOR_LANE_LABELS } from '../../app/lib/board-view-core'
import { boardColumn, columnOf } from '../../app/lib/board-core'
import { whoseTurn, CLIENT_LABELS, type ItemStatus } from '../../app/lib/workflow-core'
import { UNASKED_LINE } from '../../app/lib/waiting-core'
import {
  briefChecklist, ackState, goReady, shootStage, STAGE_LABEL, clockWords, canSeeShoot, hasAcknowledged, type SopShoot,
} from '../../app/lib/shoot-sop-core'
import { flagsOf } from '../../app/lib/card-flag-core'
import { createPost, sendForApproval } from '../../app/lib/social-schedule'
import { postingEligibility } from '../../app/lib/social-schedule-core'
import { recordPublishOnItem } from '../../app/lib/production-publish'
import { getPortalData } from '../../app/lib/portal-data'
import { putObject, deleteStoredObject } from '../../app/lib/storage'
import { POST as createShoot } from '../../app/api/production/batches/route'
import { PATCH as patchShoot } from '../../app/api/production/batches/[id]/route'
import { POST as moveShoot } from '../../app/api/production/batches/[id]/stage/route'
import { POST as acknowledgeShoot } from '../../app/api/production/batches/[id]/acknowledge/route'
import { POST as addVersion } from '../../app/api/production/items/[id]/versions/route'
import { POST as flagCard } from '../../app/api/production/items/[id]/flag/route'
import { POST as portalAct } from '../../app/api/portal/act/route'
import { GET as postsList } from '../../app/api/social/publish/route'

// every step writes the screen down for seven people and waits on the
// fan-out; a step is minutes, not the harness's default minute
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const IDS = {
  am: '3548cc71-5a34-4fe9-9130-11579d1a4137',
  editor: 'e30e0242-63f1-4855-8e3a-b23b293ec11d',
  scheduler: '0e7fcf9f-bcf5-4080-ab7c-1b1f8fed1d13',
  client: '634d5636-70a7-4f5a-96e9-5b48cce73999',
}
/** a super admin needs no row: the libraries take the person, not a session.
 *  A real-shaped UUID nobody has (the routes refuse anything else), so a
 *  notification could never resolve to a real inbox. */
const SUPER: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000a1', role: 'super_admin',
  email: 'zz-superadmin@mdmedia-test.invalid', name: 'ZZ Super admin', clerk_user_id: null,
} as TeamUser
/** a second scheduler, who must see NONE of it until it is handed over */
const OTHER: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000a2', role: 'scheduler',
  email: 'zz-other-scheduler@mdmedia-test.invalid', name: 'ZZ Other', clerk_user_id: null,
} as TeamUser
/** a general user: sees every shoot, and only their own cards */
const GENERAL: TeamUser = {
  id: 'a0000000-0000-4000-8000-0000000000a3', role: 'general',
  email: 'zz-general@mdmedia-test.invalid', name: 'ZZ General', clerk_user_id: null,
} as TeamUser

const STAMP = Date.now()
const TAG = `ZZ TEST PLAYBOOK ${STAMP}`
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9])
const SLIDES: { url: string; name: string; type: 'image'; bytes: number; source: 'upload' }[] = []
const melbourneToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
const plusDays = (n: number) => {
  const [y, m, d] = melbourneToday().split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

let am: TeamUser, editor: TeamUser, scheduler: TeamUser, clientUser: TeamUser, joy: TeamUser
let channelId = ''
let shootId = ''
let itemId = ''
let postId = ''
let originalDefaults: unknown = []
let shareToken = ''
const runStart = new Date().toISOString()
const created = {
  items: new Set<string>(), versions: new Set<string>(), posts: new Set<string>(), jobs: new Set<string>(),
  locks: new Set<string>(), accounts: new Set<string>(), entries: new Set<string>(), users: new Set<string>(),
  links: new Set<string>(), batches: new Set<string>(),
}
let assignments: TeamUserClient[] = []
const names = new Map<string, string>()

/* ── the screen, written down ─────────────────────────────────────────── */

const script: string[] = []
const say = (line: string) => { script.push(line); console.log(line) }
const SCRIPT_PATH = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-myProjects-content/c33ff7c1-ad55-46c0-8973-dffcbb410744/scratchpad/playbook-roleplay-script.txt'

const as = (who: TeamUser) => {
  Object.assign(h.user, { id: who.id, role: who.role, email: who.email, name: who.name, clerk_user_id: who.clerk_user_id ?? null, quality_reviewer: (who as { quality_reviewer?: boolean }).quality_reviewer === true })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (res: Response | undefined) => res ? ({ status: res.status, body: await res.json().catch(() => ({})) }) : ({ status: 0, body: { error: 'no response' } })
const viewerOf = (who: TeamUser) => ({ id: who.id, role: who.role, quality_reviewer: (who as { quality_reviewer?: boolean }).quality_reviewer === true }) as never
const shootRow = async () => (await table<Batch>('batches').get(shootId, { fresh: true }))! as unknown as SopShoot & Batch
const itemRow = async () => (await table<ContentItem>('content_items').get(itemId, { fresh: true }))!
const clientRows = async () => {
  const rows = await table<ContentItem>('content_items').list({ fresh: true, by: { client_id: TEST_CLIENT_ID } as never })
  return (await attachOne(rows, 'work_kind_id', 'work_kinds', ['slug', 'name'])).map(r => ({ ...r, clients: { name: 'ZZ TEST' } })) as unknown as (ContentItem & { work_kinds?: { slug?: string } | null })[]
}
const ourRows = async () => (await clientRows()).filter(r => r.batch_id === shootId || r.id === itemId)
const activityOf = async (id: string) =>
  table<{ id: string; action: string; actor_id?: string | null; detail?: string | null; created_at?: string | null; entity_id?: string }>('workflow_activity')
    .list({ fresh: true, where: a => String(a.entity_id ?? '') === id })

/** who may see which of OUR rows, by the same rule the pages use */
const seenBy = (who: TeamUser, rows: ContentItem[]) =>
  visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false } as never).map(r => r.id)

/** every notification SENT since the run began — a refused one (the kill switch) is not a leak */
async function toldSince(since: string): Promise<{ recipient_email: string; subject: string; event_type: string; status: string }[]> {
  const rows = await table<{ id: string; recipient_email?: string; subject?: string; event_type?: string; created_at?: string; status?: string; entity_id?: string }>('notification_log')
    .list({ fresh: true, where: n => String(n.created_at ?? '') >= since && (String(n.recipient_email ?? '').endsWith('.invalid') || [shootId, itemId].some(x => x && String(n.entity_id ?? '').includes(x))) })
  return rows.map(r => ({ recipient_email: String(r.recipient_email ?? ''), subject: String(r.subject ?? ''), event_type: String(r.event_type ?? ''), status: String(r.status ?? '') }))
}
const settle = () => new Promise(r => setTimeout(r, 1200))
/** the fan-out is fire-and-forget and the mailer is slow per recipient: ask every 300 ms until the rows are there, two minutes at most */
async function toldUntil(since: string, done: (rows: Awaited<ReturnType<typeof toldSince>>) => boolean) {
  // the mailer tries every .invalid address in turn and each one is refused
  // slowly; five recipients ahead of the one asked about can take a minute
  const deadline = Date.now() + 120_000
  let rows = await toldSince(since)
  while (!done(rows) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300))
    rows = await toldSince(since)
  }
  return rows
}
const noLeak = (told: { recipient_email: string; status: string }[]) =>
  expect(told.filter(t => t.status === 'sent').every(t => t.recipient_email.endsWith('.invalid')), 'a real inbox was emailed').toBe(true)

function turnWords(card: ContentItem, who: TeamUser): string {
  const t = whoseTurn(card.status as ItemStatus, card as never, viewerOf(who))
  if (t.hat === null) return 'no chip'
  if (t.unassigned) return t.hat === 'editor' ? 'Nobody on it — anyone can take it' : t.hat === 'scheduler' ? 'Nobody on it — any scheduler can take it' : UNASKED_LINE
  if (t.mine) return 'Your turn'
  return `Waiting on the ${String(t.hat).replace('_', ' ')}`
}

/** what this person's board shows for OUR card(s) — page, column, words, chip, buttons */
async function screenBoard(who: TeamUser, page: 'editor' | 'scheduler', label: string) {
  const rows = await ourRows()
  const visible = visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false } as never) as unknown as ContentItem[]
  const cards = pageCards(page, visible as never, viewerOf(who), melbourneToday()) as unknown as ContentItem[]
  const pageName = page === 'editor' ? 'Editor' : 'Post approval'
  if (cards.length === 0) { say(`   ${label} — ${pageName}: nothing`); return cards }
  for (const c of cards) {
    const col = columnOf(c.status as ItemStatus)
    const colLabel = page === 'editor' ? (EDITOR_LANE_LABELS[col] ?? boardColumn(col).label) : boardColumn(col).label
    const lines = cardLines(c as never, { names, today: melbourneToday(), viewerId: who.id })
    const acts = cardActions(c as never, viewerOf(who))
    const buttons = [acts.primary, ...acts.more].filter(Boolean).map(a => a!.label)
    const flags = flagsOf(await activityOf(c.id), who.id)
    say(`   ${label} — ${pageName}: card "${lines.title}" in ${colLabel} · ${lines.kind ?? 'no kind'} · ${lines.assignee}${lines.due ? ` · ${lines.due}` : ''}${lines.delivered ? ` · ${lines.delivered}` : ''}${lines.posted ? ` · ${lines.posted}` : ''} · chip "${turnWords(c, who)}"${flags.acknowledged ? ' · acknowledged' : ''}${flags.risk ? ` · risk "${flags.risk}"` : ''} · buttons: ${buttons.length ? buttons.join(' · ') : 'none'}`)
  }
  return cards
}

async function screenShoot(who: TeamUser, label: string) {
  const b = await shootRow()
  const clientIds = assignments.filter(a => a.team_user_id === who.id).map(a => a.client_id)
  const sees = canSeeShoot({ id: who.id, role: who.role as never }, b, clientIds)
  if (!sees) { say(`   ${label} — Shoots: nothing`); return }
  const itemCount = await table<ContentItem>('content_items').count({ by: { batch_id: shootId } } as never)
  const list = briefChecklist(b, { itemCount })
  const ack = ackState(b)
  const go = goReady(b, { itemCount })
  say(`   ${label} — Shoots: "${b.title}" in ${STAGE_LABEL[shootStage(b, melbourneToday())]} · ${clockWords(b, melbourneToday())} · ${list.words}${list.missing.length ? ` (missing: ${list.missing.map(m => m.label).join(', ')})` : ''} · ${ack.words} · go: ${go.ok ? 'ready' : go.reasons[0]}`)
}

async function screenOverview(who: TeamUser, label: string) {
  const rows = await clientRows()
  const visible = visibleItems(viewerOf(who), rows as never, assignments as never, { schedulerPostFilter: false } as never)
  const clientCount = who.role === 'super_admin' ? 1 : assignments.filter(a => a.team_user_id === who.id).length
  const tiles = overviewTiles({ viewer: viewerOf(who), cards: visible as never, today: melbourneToday(), clientCount })
  say(`   ${label} — Overview: ${tiles.map(t => `${t.title} [${t.stats.map(s => `${s.value} ${s.label}`).join(' / ')}]`).join(' · ')}`)
}

async function screenPortal(label: string) {
  const data = await getPortalData(TEST_CLIENT_ID)
  const card = data?.cards.find(c => c.id === itemId)
  if (!card) { say(`   ${label} — client portal: card not shown`); return null }
  say(`   ${label} — client portal: "${card.title}" in ${card.column} · "${card.line}"${card.channels.length ? ` · ${card.channels.map(ch => `${ch.network} ${ch.kind.toLowerCase()} ${ch.words}`).join('; ')}` : ''}`)
  return card
}

async function everyone(step: string) {
  say(`\n${step}`)
  await screenShoot(am, 'AM'); await screenShoot(editor, 'Editor'); await screenShoot(scheduler, 'Scheduler'); await screenShoot(SUPER, 'Super admin'); await screenShoot(GENERAL, 'General')
  if (itemId) {
    await screenBoard(editor, 'editor', 'Editor'); await screenBoard(GENERAL, 'editor', 'General')
    await screenBoard(am, 'scheduler', 'AM'); await screenBoard(joy, 'scheduler', 'Joy'); await screenBoard(scheduler, 'scheduler', 'Scheduler'); await screenBoard(OTHER, 'scheduler', 'Other scheduler'); await screenBoard(SUPER, 'scheduler', 'Super admin')
    await screenOverview(am, 'AM'); await screenOverview(SUPER, 'Super admin')
    await screenPortal('Client')
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

  // Joy, for this run only: a manager on the test client flagged as the quality reviewer
  const j = await table<TeamUser & { id: string }>('team_users').insert({
    email: `zz-joy-${STAMP}@mdmedia-test.invalid`, name: 'ZZ Joy', role: 'account_manager', clerk_user_id: null,
    active_status: true, employment_type: 'employee', timezone: 'Australia/Melbourne', client_id: null,
    quality_reviewer: true, ops_contact: false,
  } as never)
  created.users.add(j.id); joy = { ...j, quality_reviewer: true } as never
  const link = await table<TeamUserClient>('team_user_clients').insert({ id: `${j.id}__${TEST_CLIENT_ID}`, team_user_id: j.id, client_id: TEST_CLIENT_ID } as never)
  created.links.add(link.id)
  assignments = await table<TeamUserClient>('team_user_clients').list({ fresh: true, by: { client_id: TEST_CLIENT_ID } })
  for (const p of [am, editor, scheduler, joy, SUPER, OTHER, GENERAL]) names.set(p.id, p.name)

  // the client's default scheduler for this run: the test scheduler
  await table('clients').update(TEST_CLIENT_ID, { default_scheduler_ids: [scheduler.id] } as never)

  const account = await table<SocialAccount>('social_accounts').insert({
    client_id: TEST_CLIENT_ID, platform: 'instagram', provider_account_id: `zz-test-${STAMP}`,
    name: `${TAG} channel`, username: `zz_test_${STAMP}`, avatar_url: null, active: true,
    connected_at: new Date().toISOString(), last_synced_at: new Date().toISOString(),
  } as never)
  created.accounts.add(account.id); channelId = account.id
  for (const n of ['one', 'two']) {
    const put = await putObject(`zztest-pb-${STAMP}-${n}.jpg`, JPEG, 'image/jpeg')
    SLIDES.push({ url: put.publicUrl, name: `${n}.jpg`, type: 'image', bytes: JPEG.length, source: 'upload' })
  }
  say(`[setup] client=${TEST_CLIENT_ID} joy=${joy.email} channel=${channelId} files=${SLIDES.length}`)
}))

/* ── the journey ────────────────────────────────────────────────────────── */

describe('the playbook, start to finish, live', () => {
  it('1. the super admin starts a shoot; the AM fills the nine parts and names the team', async () => {
    as(SUPER)
    const made = await json(await createShoot(new Request('https://x.test/batches', {
      method: 'POST',
      body: JSON.stringify({
        client_id: TEST_CLIENT_ID, title: `${TAG} — launch shoot`, shoot_date: plusDays(10), location: '12 Test St, Melbourne',
        planned_deliverables: [{ id: 'line-1', title: 'Launch photo set' }],
        shot_list: [{ id: 's1', text: 'Opening: walk in through the door' }, { id: 's2', text: 'Product on the counter, hands only' }],
      }),
    })))
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    shootId = String(made.body.id); created.batches.add(shootId)
    await everyone('Step 1a — Super admin pressed New shoot plan')
    let b = await shootRow()
    expect(shootStage(b, melbourneToday())).toBe('drafting')
    expect(briefChecklist(b).complete).toBe(false)

    // the AM cannot share half a plan
    as(am)
    const early = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'shared' }) }), params(shootId)))
    expect(early.status).toBe(422)
    expect(early.body.error).toMatch(/still to fill in/)
    say(`   AM drags to Shared with team → refused: "${early.body.error}"`)

    // the nine parts, and the people
    const filled = await json(await patchShoot(new Request('https://x.test/batch', {
      method: 'PATCH',
      body: JSON.stringify({
        objective: 'Launch the spring range — pillar: product', script: 'Talking points: three lines on the fabric, one on the price',
        call_time: '8:30 am', talent: 'Founder on camera', props_wardrobe: 'Two outfits, the spring rack — the AM brings them',
        client_availability: 'Founder on set 8:30–11', editor_priorities: 'The reel first, then the photo set; hero photo for the launch post',
        edit_deadline: plusDays(14), editor_id: editor.id, crew_ids: [scheduler.id],
      }),
    }), params(shootId)))
    expect(filled.status, JSON.stringify(filled.body)).toBe(200)
    b = await shootRow()
    const list = briefChecklist(b)
    expect(list.complete, JSON.stringify(list.missing)).toBe(true)
    expect(b.editor_id).toBe(editor.id)
    expect(ackState(b).total).toBe(2)
    await everyone('Step 1b — AM filled the nine parts, named the editor and the crew')
  })

  it('2. the AM shares the plan; the team is emailed; go is refused until everyone has read it', async () => {
    as(am)
    const since = new Date().toISOString()
    const shared = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'shared' }) }), params(shootId)))
    expect(shared.status, JSON.stringify(shared.body)).toBe(200)
    expect(shootStage(await shootRow(), melbourneToday())).toBe('shared')
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === scheduler.email) && t.some(x => x.recipient_email === editor.email))
    noLeak(told)
    expect(told.some(t => t.recipient_email === editor.email && /Read the plan/.test(t.subject))).toBe(true)
    expect(told.some(t => t.recipient_email === scheduler.email && /Read the plan/.test(t.subject))).toBe(true)
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)

    // go before anyone has read it
    const tooSoon = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'confirmed' }) }), params(shootId)))
    expect(tooSoon.status).toBe(422)
    say(`   AM presses Confirm — it is go → refused: "${tooSoon.body.error}"`)
    expect(tooSoon.body.error).toMatch(/Aligned|acknowledged|Client availability/)
    await everyone('Step 2 — plan shared with the team')
  })

  it('3. the editor and the crew acknowledge; the AM ticks aligned and confirmed; go books the shoot', async () => {
    // the other scheduler is not on the shoot and cannot acknowledge it
    as(OTHER)
    const notOn = await json(await acknowledgeShoot(new Request('https://x.test/ack', { method: 'POST' }), params(shootId)))
    expect(notOn.status).toBe(403)
    say(`   Other scheduler presses I've read the plan → refused: "${notOn.body.error}"`)
    as(editor)
    expect((await json(await acknowledgeShoot(new Request('https://x.test/ack', { method: 'POST' }), params(shootId)))).status).toBe(200)
    as(scheduler)
    expect((await json(await acknowledgeShoot(new Request('https://x.test/ack', { method: 'POST' }), params(shootId)))).status).toBe(200)
    let b = await shootRow()
    expect(ackState(b).complete).toBe(true)
    expect(hasAcknowledged(b, editor.id)).toBe(true)
    await everyone('Step 3a — editor and crew have read the plan')

    as(am)
    const stillNo = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'confirmed' }) }), params(shootId)))
    expect(stillNo.status).toBe(422)
    expect(stillNo.body.error).toMatch(/Aligned/)
    say(`   AM presses go → refused: "${stillNo.body.error}"`)
    expect((await json(await patchShoot(new Request('https://x.test/batch', { method: 'PATCH', body: JSON.stringify({ aligned: true, client_confirmed: true }) }), params(shootId)))).status).toBe(200)
    b = await shootRow()
    expect(goReady(b).ok).toBe(true)
    const go = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'confirmed' }) }), params(shootId)))
    expect(go.status, JSON.stringify(go.body)).toBe(200)
    b = await shootRow()
    expect(shootStage(b, melbourneToday())).toBe('confirmed')
    expect(b.status).toBe('locked')
    expect(b.go_by).toBe(am.id)
    // go booked the shoot: the plan's line is a card now, owned by nobody yet
    const cards = await table<ContentItem>('content_items').list({ fresh: true, by: { batch_id: shootId } as never })
    for (const c of cards) created.items.add(c.id)
    // ONE SHOOT, ONE CARD (the owner, 11 Sep 2026): the card carries the
    // shoot's title and the deliverables as its brief
    const photo = cards.find(c => /launch shoot/.test(String(c.title)))
    expect(photo, JSON.stringify(cards.map(c => c.title))).toBeTruthy()
    itemId = photo!.id
    // GO IS THE HANDOVER (the rule of 11 Sep 2026, `shoot-handover`): the
    // plan's cards are the named editor's from the moment the shoot is
    // confirmed, so their Editor page shows the coming work; the footage
    // step later fills what is still empty and tells them the footage is in
    expect(photo!.owner_id).toBe(editor.id)
    await everyone('Step 3b — go: shoot confirmed and booked, the plan line is a card, already the editor’s')
  })

  it('4. Ops sends the reminder; after the day, footage is handed over and the editor holds the card', async () => {
    as(am)
    let since = new Date().toISOString()
    const rem = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'reminder_sent' }) }), params(shootId)))
    expect(rem.status, JSON.stringify(rem.body)).toBe(200)
    let told = await toldUntil(since, t => t.filter(x => /Shoot reminder/.test(x.subject)).length >= 2)
    noLeak(told)
    expect(told.filter(t => /Shoot reminder/.test(t.subject)).map(t => t.recipient_email).sort()).toEqual([editor.email, scheduler.email].sort())
    say(`   reminder told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    await everyone('Step 4a — reminder sent the day before')

    // footage cannot be handed over before the day
    const notYet = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'footage_handed' }) }), params(shootId)))
    expect(notYet.status).toBe(422)
    expect(notYet.body.error).toMatch(/not happened yet/)
    say(`   AM drags to Footage handed over → refused: "${notYet.body.error}"`)

    // the day passes (the test moves the calendar; nothing else changes)
    await table('batches').update(shootId, { shoot_date: plusDays(-1) } as never)
    expect(shootStage(await shootRow(), melbourneToday())).toBe('shoot_day')
    await everyone('Step 4b — the shoot day has passed')

    since = new Date().toISOString()
    const handed = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'footage_handed' }) }), params(shootId)))
    expect(handed.status, JSON.stringify(handed.body)).toBe(200)
    expect(handed.body.handed?.total).toBe(1)
    const card = await itemRow()
    expect(card.owner_id).toBe(editor.id)
    expect(String(card.due_date).slice(0, 10)).toBe(plusDays(14))
    expect(card.brief).toMatch(/hero photo/)
    told = await toldUntil(since, t => t.some(x => /Footage is in/.test(x.subject)))
    noLeak(told)
    expect(told.some(t => t.recipient_email === editor.email && /Footage is in/.test(t.subject))).toBe(true)
    say(`   handover told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)

    // a second drag creates nothing and changes nothing
    const again = await json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to: 'footage_handed' }) }), params(shootId)))
    expect(again.status).toBe(422)
    expect((await table<ContentItem>('content_items').list({ fresh: true, by: { batch_id: shootId } as never })).length).toBe(1)
    await everyone('Step 4c — footage handed over: the editor holds the card')
  })

  it('5. the editor acknowledges, uploads the final, flags a risk, presses Ready for checking', async () => {
    const rows = await ourRows()
    expect(seenBy(editor, rows)).toEqual([itemId])
    expect(seenBy(OTHER, rows)).toEqual([])
    expect(seenBy(scheduler, rows)).toEqual([])
    as(editor)
    const ack = await json(await flagCard(new Request('https://x.test/flag', { method: 'POST', body: JSON.stringify({ kind: 'acknowledged' }) }), params(itemId)))
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(flagsOf(await activityOf(itemId), editor.id).acknowledged).toBe(true)

    const since = new Date().toISOString()
    const risk = await json(await flagCard(new Request('https://x.test/flag', { method: 'POST', body: JSON.stringify({ kind: 'deadline_risk', note: 'Colour grade needs another day' }) }), params(itemId)))
    expect(risk.status, JSON.stringify(risk.body)).toBe(200)
    const told = await toldUntil(since, t => t.some(x => /Deadline at risk/.test(x.subject)))
    noLeak(told)
    expect(told.some(t => /Deadline at risk/.test(t.subject) && t.recipient_email.endsWith('.invalid'))).toBe(true)
    say(`   risk told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)

    const v = await json(await addVersion(new Request('https://x.test/versions', { method: 'POST', body: JSON.stringify({ files: [SLIDES[0]], dropbox_url: 'https://www.dropbox.com/s/zztest-source', notes: 'Final export' }) }), params(itemId)))
    expect(v.status, JSON.stringify(v.body)).toBe(201)
    for (const ver of await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })) created.versions.add(ver.id)
    const checked = await performTransition(editor, (await itemRow()) as never, 'internal_review')
    expect(checked.status).toBe('internal_review')
    await everyone('Step 5 — editor acknowledged, uploaded the final, flagged a risk, pressed Ready for checking')
  })

  it('6. the AM cannot send it to the client; sends it for quality check; the scheduler still sees nothing', async () => {
    as(am)
    await expect(performTransition(am, (await itemRow()) as never, 'client_review')).rejects.toThrow()
    say('   AM tries Send to client → refused (the gate)')
    const since = new Date().toISOString()
    const gated = await performTransition(am, (await itemRow()) as never, 'quality_check', { note: 'Caption and cover are right' })
    expect(gated.status).toBe('quality_check')
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === joy.email))
    noLeak(told)
    expect(told.some(t => t.recipient_email === joy.email)).toBe(true)
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    const rows = await ourRows()
    expect(seenBy(scheduler, rows)).toEqual([])
    expect(seenBy(editor, rows)).toEqual([itemId])
    expect(seenBy(joy, rows)).toEqual([itemId])
    await everyone('Step 6 — sent for quality check')
  })

  it('7. Joy asks for changes once, then passes it; the card is handed to the client’s scheduler', async () => {
    // an AM without the flag cannot pass the gate; Joy can send it back
    await expect(performTransition(am, (await itemRow()) as never, 'client_review')).rejects.toThrow()
    say('   AM tries Passed — send to client → refused')
    as(joy)
    expect((await performTransition(joy, (await itemRow()) as never, 'revision_required', { note: 'Crop the hero photo tighter' })).status).toBe('revision_required')
    await everyone('Step 7a — Joy asked for changes')
    as(editor)
    const v2 = await json(await addVersion(new Request('https://x.test/versions', { method: 'POST', body: JSON.stringify({ files: [SLIDES[1]], notes: 'Tighter crop' }) }), params(itemId)))
    expect(v2.status, JSON.stringify(v2.body)).toBe(201)
    for (const ver of await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })) created.versions.add(ver.id)
    expect((await performTransition(editor, (await itemRow()) as never, 'revision_complete')).status).toBe('revision_complete')
    as(am)
    expect((await performTransition(am, (await itemRow()) as never, 'quality_check')).status).toBe('quality_check')
    await everyone('Step 7b — revisions done, back with Joy')

    as(joy)
    const since = new Date().toISOString()
    const passed = await performTransition(joy, (await itemRow()) as never, 'client_review', { note: 'Passed' })
    expect(passed.status).toBe('client_review')
    const card = await itemRow()
    expect((card as { delivered_at?: string }).delivered_at).toBeTruthy()
    expect(card.scheduler_ids).toEqual([scheduler.id])
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === clientUser.email || /client/i.test(x.event_type)))
    noLeak(told)
    expect(told.some(t => t.recipient_email === clientUser.email || /portal|client/i.test(t.event_type))).toBe(true)
    // the scheduler holds the card but cannot open it yet — they are told at the approval
    expect(told.some(t => t.recipient_email === scheduler.email)).toBe(false)
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    await everyone('Step 7c — Joy passed it: with the client, handed to the scheduler')
  })

  it('8. the client approves on the portal; delivered stays the first date', async () => {
    const deliveredAt = (await itemRow() as { delivered_at?: string }).delivered_at
    const since = new Date().toISOString()
    const r = await json(await portalAct(new Request('https://x.test/portal/act', {
      method: 'POST', body: JSON.stringify({ token: shareToken, item_id: itemId, action: 'approve', author_name: 'ZZ Client' }),
    })))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const card = await itemRow()
    expect(card.status).toBe('approved_for_scheduling')
    expect((card as { delivered_at?: string }).delivered_at).toBe(deliveredAt)
    const rows = await ourRows()
    expect(seenBy(scheduler, rows)).toEqual([itemId])
    expect(seenBy(OTHER, rows)).toEqual([])
    const told = await toldUntil(since, t => t.some(x => x.recipient_email === scheduler.email))
    noLeak(told)
    expect(told.some(t => t.recipient_email === scheduler.email), JSON.stringify(told)).toBe(true)
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    await everyone('Step 8 — client approved on the portal')
    // a super admin could have passed the gate too (checked on a copy of the rule, not the live card)
    const superHats = cardActions({ ...(card as object), status: 'quality_check' } as never, viewerOf(SUPER))
    expect([superHats.primary, ...superHats.more].some(a => a?.kind === 'transition' && a.to === 'client_review')).toBe(true)
  })

  it('9. the scheduler books it (dry run); it goes out; everybody sees it Posted', async () => {
    as(scheduler)
    // the approved media, as the picker offers it: a static post is its first file
    const versions = await table<AssetVersion>('asset_versions').list({ fresh: true, by: { item_id: itemId } as never })
    const elig = postingEligibility((await itemRow()) as never, versions as never, false)
    expect(elig.ok).toBe(true)
    const approvedSlides = elig.ok ? elig.slides : []
    say(`   Scheduler — post window: ${approvedSlides.length} approved file(s) offered`)
    const draft = await createPost(scheduler, { item_id: itemId, slides: approvedSlides, caption: `${TAG} launch`, channels: [channelId], scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString() })
    postId = draft.id; created.posts.add(postId); created.locks.add(`social_post__${itemId}`); created.locks.add(`publish__${itemId}`)
    const booked = await sendForApproval(scheduler, draft.id, { mode: 'direct' })
    for (const j of booked.publish_job_ids) created.jobs.add(j)
    expect(booked.status).toBe('scheduled')
    for (const e of await table<{ id: string; item_id: string }>('schedule_entries').list({ fresh: true, by: { item_id: itemId } as never })) created.entries.add(e.id)
    expect((await itemRow()).status).toBe('scheduled')
    await everyone('Step 9a — booked in with the channel (dry run)')

    // the provider says it went out
    const jobId = booked.publish_job_ids[0]
    await table('publish_jobs').update(jobId, { status: 'published', published_at: new Date().toISOString() })
    await recordPublishOnItem(itemId, 'https://www.instagram.com/p/zztest-playbook/', ['instagram'])
    expect((await itemRow()).status).toBe('published')
    for (const e of await table<{ id: string; item_id: string }>('schedule_entries').list({ fresh: true, by: { item_id: itemId } as never })) created.entries.add(e.id)

    // the Posts page, as each role
    for (const who of [scheduler, am, SUPER]) {
      as(who)
      const r = await json(await postsList(new Request('https://x.test/api/social/publish?limit=50')))
      expect(r.status).toBe(200)
      const mine = (r.body.jobs as { id: string; status: string }[]).find(j => j.id === jobId)
      expect(mine?.status).toBe('published')
      say(`   ${who.name} — Posts page: job ${jobId} listed as ${mine?.status}`)
    }
    const portal = await screenPortal('Client')
    expect(portal?.column).toBe('posted')
    expect(CLIENT_LABELS.published).toBe('Published')
    expect(portal?.channels.some(c => /went out/.test(c.words))).toBe(true)
    await everyone('Step 9b — it went out: Posted everywhere')
    const told = await toldSince(runStart)
    noLeak(told)
    say(`
${told.length} notifications logged, every one to a .invalid address (${told.filter(t => t.status === 'sent').length} accepted by the mailer — a .invalid domain is refused by it, which is the point)`)
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
  for (const id of created.batches) await table('batches').remove(id).catch(() => {})
  for (const id of created.accounts) await table('social_accounts').remove(id).catch(() => {})
  for (const id of created.links) await table('team_user_clients').remove(id).catch(() => {})
  for (const id of created.users) await table('team_users').remove(id).catch(() => {})
  for (const s of SLIDES) await deleteStoredObject(s.url).catch(() => {})
  const ids = [...created.items]
  const ents = [...ids, ...created.batches]
  const strays = await Promise.all([
    table<AssetVersion>('asset_versions').list({ fresh: true, where: v => ids.includes(String(v.item_id)) }),
    table<SocialPost>('social_posts').list({ fresh: true, where: p => ids.includes(String(p.item_id)) }),
    table<PublishJob>('publish_jobs').list({ fresh: true, where: j => ids.includes(String(j.content_item_id ?? '')) }),
    table<{ id: string; item_id?: string }>('schedule_entries').list({ fresh: true, where: e => ids.includes(String(e.item_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string }>('workflow_activity').list({ fresh: true, where: a => ents.includes(String(a.entity_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string; recipient_email?: string }>('notification_log').list({ fresh: true, where: n => ents.some(i => String(n.entity_id ?? '').includes(i)) || String(n.recipient_email ?? '').includes(`zz-joy-${STAMP}`) }).catch(() => []),
    table<{ id: string; item_id?: string }>('item_comments').list({ fresh: true, where: c => ids.includes(String(c.item_id ?? '')) }).catch(() => []),
    table<{ id: string; item_id?: string }>('approvals').list({ fresh: true, where: c => ids.includes(String(c.item_id ?? '')) }).catch(() => []),
  ])
  const tables = ['asset_versions', 'social_posts', 'publish_jobs', 'schedule_entries', 'workflow_activity', 'notification_log', 'item_comments', 'approvals']
  for (let i = 0; i < strays.length; i++) for (const r of strays[i]) await table(tables[i] as never).remove(r.id).catch(() => {})
  const left = await Promise.all([
    table<ContentItem>('content_items').list({ fresh: true, where: i => String(i.title ?? '').startsWith(TAG) || ids.includes(i.id) }),
    table<Batch>('batches').list({ fresh: true, where: b => String(b.title ?? '').startsWith(TAG) }),
    table<SocialAccount>('social_accounts').list({ fresh: true, where: a => String(a.provider_account_id ?? '') === `zz-test-${STAMP}` }),
    table<{ id: string; email: string }>('team_users').list({ fresh: true, where: u => String(u.email).includes(`zz-joy-${STAMP}`) }),
    table<{ id: string; default_scheduler_ids?: unknown }>('clients').get(TEST_CLIENT_ID, { fresh: true }),
  ])
  console.log(`[teardown] left behind: items=${left[0].length} shoots=${left[1].length} accounts=${left[2].length} users=${left[3].length} defaults=${JSON.stringify(left[4]?.default_scheduler_ids)}`)
  expect(left[0].length + left[1].length + left[2].length + left[3].length).toBe(0)
  expect(left[4]?.default_scheduler_ids ?? []).toEqual(originalDefaults)
})
