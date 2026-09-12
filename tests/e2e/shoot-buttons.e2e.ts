import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'

/**
 * EVERY BUTTON ON THE SHOOT PLAN, PRESSED FOR REAL — 12 Sep 2026.
 *
 * The owner: "send a test agent to go through every part of the shoot plan,
 * its buttons, what happens and does it make sense. No mistakes." So every
 * control the Shoots page and the shoot page offer is pressed here, in the
 * order a person would, as the role that has it, THROUGH THE SAME ROUTES
 * THE BUTTONS CALL — and after each press the words the page would show are
 * read back with the same pure functions the page draws from
 * (`nextStepWords`, `shootStage`, `briefChecklist`, `ackState`, `goReady`).
 *
 *   super admin  New shoot plan
 *   AM           the nine parts one at a time, the editor, the crew, Share,
 *                the two ticks, Go, Reminder sent, moving a shoot back
 *   editor/crew  I've read the plan, the footage folder, Footage is in
 *   super admin  Go anyway (late plan, with a reason)
 *   the sweep    the 7-day nudge and the morning-after handover, twice each
 *   everybody    who may open which shoot, and who is refused
 *
 * SAFETY: the ZZ TEST client and its `.invalid` accounts only; EMAIL_TEST_ONLY
 * (the mailer refuses a real address); every row this run makes is deleted
 * at the end and the deletion read back. Nothing is rendered in a browser
 * here — this is the routes and the words, not the pixels.
 *
 *   EMAIL_TEST_ONLY=1 PUBLISH_DRY_RUN=1 \
 *     npx vitest run --config vitest.e2e.config.mts tests/e2e/shoot-buttons.e2e.ts
 */

const h: { user: { id: string; role: string; email: string; name: string; clerk_user_id: string | null } } = {
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
import type { Batch, ContentItem, TeamUserClient } from '../../lib/db-types'
import type { TeamUser } from '../../app/lib/authz'
import {
  BRIEF_ITEMS, ackState, briefChecklist, briefIsLate, canSeeShoot, clockWords, footageDueTargets, goReady, hasAcknowledged,
  lateNudgeTargets, lateShareNudgeTargets, nextStepWords, overrideWords, shootStage, STAGE_LABEL, sharedLate, type SopShoot,
} from '../../app/lib/shoot-sop-core'
import { shootCardId } from '../../app/lib/deliverable-group-core'
import { shootDeletion } from '../../app/lib/batch-brief-core'
import { runBriefLateNudge } from '../../app/lib/shoot-sop-notify'
import { runFootageDueSweep } from '../../app/lib/shoot-handover'
import { POST as createShoot } from '../../app/api/production/batches/route'
import { GET as getShoot, PATCH as patchShoot, DELETE as deleteShoot } from '../../app/api/production/batches/[id]/route'
import { POST as moveShoot } from '../../app/api/production/batches/[id]/stage/route'
import { POST as acknowledgeShoot, DELETE as unacknowledge } from '../../app/api/production/batches/[id]/acknowledge/route'

vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const IDS = {
  am: '3548cc71-5a34-4fe9-9130-11579d1a4137',
  editor: 'e30e0242-63f1-4855-8e3a-b23b293ec11d',
  scheduler: '0e7fcf9f-bcf5-4080-ab7c-1b1f8fed1d13',
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
const TAG = `ZZ TEST BUTTONS ${STAMP}`
const melbourneToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
const plusDays = (n: number) => {
  const [y, m, d] = melbourneToday().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

let am: TeamUser, editor: TeamUser, scheduler: TeamUser
let shootA = ''
let shootB = ''
let assignments: TeamUserClient[] = []
const created = { batches: new Set<string>(), items: new Set<string>() }

const script: string[] = []
const say = (line: string) => { script.push(line); console.log(line) }
const SCRIPT_PATH = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-myProjects-content/c33ff7c1-ad55-46c0-8973-dffcbb410744/scratchpad/shoot-buttons-script.txt'

const as = (who: TeamUser) => {
  Object.assign(h.user, { id: who.id, role: who.role, email: who.email, name: who.name, clerk_user_id: who.clerk_user_id ?? null })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (res: Response | undefined) => res ? ({ status: res.status, body: await res.json().catch(() => ({})) }) : ({ status: 0, body: { error: 'no response' } })
const row = async (id: string) => (await table<Batch>('batches').get(id, { fresh: true }))! as unknown as SopShoot & Batch
const cardsOf = async (id: string) => {
  const rows = await table<ContentItem>('content_items').list({ fresh: true, by: { batch_id: id } as never })
  const joined = await attachOne(rows, 'work_kind_id', 'work_kinds', ['slug'])
  for (const c of rows) created.items.add(c.id)
  return joined.filter(c => (c.work_kinds as { slug?: string } | null)?.slug !== 'shoot_brief')
}
const move = async (id: string, to: string, reason?: string) =>
  json(await moveShoot(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to, ...(reason ? { reason } : {}) }) }), params(id)))
const patch = async (id: string, body: Record<string, unknown>) =>
  json(await patchShoot(new Request('https://x.test/batch', { method: 'PATCH', body: JSON.stringify(body) }), params(id)))
const ack = async (id: string) => json(await acknowledgeShoot(new Request('https://x.test/ack', { method: 'POST' }), params(id)))
const unack = async (id: string, who: string) => json(await unacknowledge(new Request('https://x.test/ack', { method: 'DELETE', body: JSON.stringify({ user_id: who }) }), params(id)))
const open = async (id: string) => json(await getShoot(new Request('https://x.test/batch'), params(id)))

/**
 * THE SWEEPS RUN OVER THE WHOLE TABLE. They stamp and email whatever is late
 * or shot — a real client's shoot included. So they are only called when
 * nothing but our own rows would be touched; otherwise the step says so and
 * asserts the pure rule on our rows instead. Never a side effect on a real
 * shoot from a test.
 */
async function sweepSafe(which: 'late' | 'footage'): Promise<boolean> {
  const today = melbourneToday()
  const all = await table<Batch>('batches').list({ fresh: true, where: r => !!r.shoot_date && r.status !== 'wrapped' })
  const others = all.filter(b => !String(b.title ?? '').startsWith(TAG))
  const would = which === 'late'
    ? [...lateNudgeTargets(others.filter(r => !r.late_nudged_at), today), ...lateShareNudgeTargets(others)]
    : [...footageDueTargets(others, today).hand, ...footageDueTargets(others, today).askEditor]
  if (would.length > 0) say(`   (the ${which} sweep would touch ${would.length} real shoot(s) — not run; the rule is asserted on our rows instead)`)
  return would.length === 0
}

/** every notification since `since` to our people — a refused one (the kill switch) is not a leak */
async function toldSince(since: string, ids: string[]) {
  const rows = await table<{ id: string; recipient_email?: string; subject?: string; created_at?: string; status?: string; entity_id?: string }>('notification_log')
    .list({ fresh: true, where: n => String(n.created_at ?? '') >= since && ids.some(x => String(n.entity_id ?? '').includes(x)) })
  return rows.map(r => ({ recipient_email: String(r.recipient_email ?? ''), subject: String(r.subject ?? ''), status: String(r.status ?? '') }))
}
async function toldUntil(since: string, ids: string[], done: (rows: Awaited<ReturnType<typeof toldSince>>) => boolean) {
  const deadline = Date.now() + 120_000
  let rows = await toldSince(since, ids)
  while (!done(rows) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300))
    rows = await toldSince(since, ids)
  }
  return rows
}
const noLeak = (told: { recipient_email: string; status: string }[]) =>
  expect(told.filter(t => t.status === 'sent').every(t => t.recipient_email.endsWith('.invalid')), 'a real inbox was emailed').toBe(true)

/** the shoot page's words, as the page draws them, for the role looking */
async function screen(id: string, who: TeamUser, label: string) {
  const b = await row(id)
  const clientIds = assignments.filter(a => a.team_user_id === who.id).map(a => a.client_id)
  if (!canSeeShoot({ id: who.id, role: who.role as never }, b, clientIds)) { say(`   ${label}: cannot see this shoot`); return b }
  const itemCount = (await cardsOf(id)).length
  const list = briefChecklist(b, { itemCount })
  const a = ackState(b)
  const go = goReady(b, { itemCount, role: who.role as never })
  say(`   ${label}: "${b.title}" · ${STAGE_LABEL[shootStage(b, melbourneToday())]} · ${clockWords(b, melbourneToday())} · ${list.words}${list.missing.length ? ` (missing: ${list.missing.map(m => m.label).join(', ')})` : ''} · ${a.words} · go: ${go.ok ? 'ready' : go.reasons[0]}${overrideWords(b) ? ` · ${overrideWords(b)}` : ''}`)
  say(`      strip: ${nextStepWords(b, melbourneToday(), { itemCount, role: who.role as never })}`)
  return b
}

beforeAll(() => withRequestCache(async () => {
  if (process.env.EMAIL_TEST_ONLY !== '1') throw new Error('EMAIL_TEST_ONLY is not set — refusing to run')
  const client = await table<{ id: string; name: string }>('clients').get(TEST_CLIENT_ID)
  if (!client || !/^ZZ TEST/.test(client.name)) throw new Error('ZZ TEST client not found')
  const people = await table<TeamUser & { id: string }>('team_users').list({ where: u => Object.values(IDS).includes(u.id) })
  am = people.find(u => u.id === IDS.am)!; editor = people.find(u => u.id === IDS.editor)!; scheduler = people.find(u => u.id === IDS.scheduler)!
  if (!am || !editor || !scheduler) throw new Error('Test accounts missing')
  for (const p of [am, editor, scheduler]) if (!p.email.endsWith('.invalid')) throw new Error(`refusing: ${p.email} is real`)
  assignments = await table<TeamUserClient>('team_user_clients').list({ fresh: true, by: { client_id: TEST_CLIENT_ID } })
  const emails = (await attachOne(assignments, 'team_user_id', 'team_users', ['email'])).map(r => (r.team_users as { email: string } | null)?.email).filter((e): e is string => !!e)
  if (emails.some(e => !e.endsWith('.invalid'))) throw new Error('ZZ TEST client is managed by real people')
  say(`[setup] client=${TEST_CLIENT_ID} am=${am.email} editor=${editor.email} crew=${scheduler.email}`)
}))

describe('the shoot plan, every button, live', () => {
  it('1. New shoot plan — who can open it afterwards', async () => {
    as(SUPER)
    const made = await json(await createShoot(new Request('https://x.test/batches', {
      method: 'POST', body: JSON.stringify({ client_id: TEST_CLIENT_ID, title: `${TAG} A`, shoot_date: plusDays(10), location: '12 Test St, Melbourne' }),
    })))
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    shootA = String(made.body.id); created.batches.add(shootA)
    say('\nStep 1 — super admin pressed Create the shoot plan')
    const b = await screen(shootA, SUPER, 'Super admin')
    expect(shootStage(b, melbourneToday())).toBe('drafting')
    expect(briefChecklist(b).words).toBe('0 of 9 filled')
    expect(nextStepWords(b, melbourneToday())).toMatch(/^Next: fill in the plan/)
    expect(clockWords(b, melbourneToday())).toBe('10 days to the shoot')

    // who may open the page: the client's AM, general, super admin — not an
    // editor or scheduler who is not on it
    as(am); expect((await open(shootA)).status).toBe(200)
    as(GENERAL); expect((await open(shootA)).status).toBe(200)
    as(OTHER); expect((await open(shootA)).status).toBe(403)
    // the test editor is on the ZZ TEST client's team, so the shoot is theirs to open
    as(editor); expect((await open(shootA)).status).toBe(200)
    say('   opens for: AM, general, super admin, the client team · refused: a scheduler not on the client or the shoot')

    // an empty plan cannot be shared
    as(am)
    const early = await move(shootA, 'shared')
    expect(early.status).toBe(422)
    expect(early.body.error).toMatch(/^Not yet — .* still to fill in\. Nothing moves forward on half-information\.$/)
    say(`   AM presses Share the plan → refused: "${early.body.error}"`)
  })

  it('2. the nine parts, one field at a time — the count climbs, the words follow', async () => {
    as(am)
    const steps: [Record<string, unknown>, number][] = [
      [{ objective: 'Launch the spring range — pillar: product' }, 1],
      [{ planned_deliverables: [{ id: 'l1', title: '5 reels' }, { id: 'l2', title: '1 photo set' }] }, 2],
      [{ shot_list: [{ id: 's1', text: 'Opening: walk in through the door' }] }, 3],
      [{ script: 'Three lines on the fabric, one on the price' }, 4],
      [{ call_time: '8:30 am' }, 5],
      [{ talent: 'Founder on camera' }, 6],
      [{ props_wardrobe: 'Two outfits, the spring rack' }, 7],
      [{ client_availability: 'Founder on set 8:30–11' }, 8],
      [{ editor_priorities: 'The reel first, then the photo set' }, 8],
      [{ edit_deadline: plusDays(14) }, 9],
    ]
    say('\nStep 2 — AM fills the nine parts')
    for (const [body, expectFilled] of steps) {
      const r = await patch(shootA, body)
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      const list = briefChecklist(await row(shootA))
      expect(list.filled, JSON.stringify(body)).toBe(expectFilled)
      say(`   ${Object.keys(body)[0]} → ${list.words}`)
    }
    expect(briefChecklist(await row(shootA)).complete).toBe(true)
    expect(BRIEF_ITEMS.length).toBe(9)
    // a scheduler not on the shoot cannot write the plan
    as(OTHER)
    expect((await patch(shootA, { objective: 'x' })).status).toBe(403)
    // a bad footage link is refused with a reason; the folder field is not shown in Draft anyway
    as(am)
    const bad = await patch(shootA, { footage_url: 'not a link' })
    expect(bad.status).toBe(422)
    say(`   footage folder "not a link" → refused: "${bad.body.error}"`)
    say(`      strip: ${nextStepWords(await row(shootA), melbourneToday())}`)
    expect(nextStepWords(await row(shootA), melbourneToday())).toBe('Next: share the plan with the team. Everyone on it is emailed and asked to read it.')
  })

  it('3. the editor and the crew — pick, add, take off; only the right people', async () => {
    as(am)
    say('\nStep 3 — AM names who is on the shoot')
    const wrong = await patch(shootA, { editor_id: scheduler.id })
    expect(wrong.status).toBe(422)
    say(`   Editor picker given a scheduler → refused: "${wrong.body.error}"`)
    expect((await patch(shootA, { editor_id: editor.id })).status).toBe(200)
    expect((await patch(shootA, { crew_ids: [scheduler.id] })).status).toBe(200)
    let b = await row(shootA)
    expect(ackState(b).words).toBe('0 of 2 acknowledged')
    expect((await patch(shootA, { crew_ids: [] })).status).toBe(200)
    expect(ackState(await row(shootA)).words).toBe('0 of 1 acknowledged')
    say('   crew: added the scheduler → 0 of 2 · took them off → 0 of 1')
    expect((await patch(shootA, { crew_ids: [scheduler.id] })).status).toBe(200)
    as(OTHER)
    expect((await patch(shootA, { crew_ids: [OTHER.id] })).status).toBe(403)
    as(editor)
    // the editor is on the shoot now: the page opens, but the people are the AM's call
    expect((await open(shootA)).status).toBe(200)
    expect((await patch(shootA, { editor_id: null })).status).toBe(403)
    b = await row(shootA)
    expect(b.editor_id).toBe(editor.id)
    say('   editor sees the shoot now; cannot change who is on it')
  })

  it('4. Share the plan — the team is emailed; go is refused until everyone has read it', async () => {
    say('\nStep 4 — Share')
    as(scheduler)
    const notMine = await move(shootA, 'shared')
    expect(notMine.status).toBe(422)
    say(`   crew member presses Share → refused: "${notMine.body.error}"`)
    as(am)
    // wrong order first: go, reminder, shoot day, footage from Draft
    for (const [to, words] of [['confirmed', /Share the plan with the team first/], ['reminder_sent', /Sign the shoot off as go/], ['shoot_day', /The calendar moves a shoot here/], ['footage_handed', /not happened yet/]] as const) {
      const r = await move(shootA, to)
      expect(r.status, to).toBe(422)
      expect(r.body.error).toMatch(words)
      say(`   Move… to ${STAGE_LABEL[to]} from Draft → refused: "${r.body.error}"`)
    }
    const since = new Date().toISOString()
    const shared = await move(shootA, 'shared')
    expect(shared.status, JSON.stringify(shared.body)).toBe(200)
    expect(shared.body.moved).toBe('Plan shared with the team')
    const b = await screen(shootA, am, 'AM')
    expect(shootStage(b, melbourneToday())).toBe('shared')
    expect(sharedLate(b)).toBe(false)
    const told = await toldUntil(since, [shootA], t => t.some(x => x.recipient_email === editor.email) && t.some(x => x.recipient_email === scheduler.email))
    noLeak(told)
    expect(told.filter(t => /^Read the plan:/.test(t.subject)).map(t => t.recipient_email).sort()).toEqual([editor.email, scheduler.email].sort())
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    const again = await move(shootA, 'shared')
    expect(again.status).toBe(422)
    expect(again.body.error).toBe('Already in Shared with team')
    const go = await move(shootA, 'confirmed')
    expect(go.status).toBe(422)
    expect(go.body.error).toMatch(/Aligned with the strategist/)
    say(`   AM presses Confirm — it is go → refused: "${go.body.error}"`)
  })

  it('5. I’ve read the plan — one press each, idempotent; a manager can undo one', async () => {
    say('\nStep 5 — acknowledgements')
    as(OTHER)
    const notOn = await ack(shootA)
    expect(notOn.status).toBe(403)
    say(`   somebody not on the shoot → refused: "${notOn.body.error}"`)
    as(editor)
    expect((await ack(shootA)).status).toBe(200)
    expect((await ack(shootA)).status).toBe(200)
    expect(ackState(await row(shootA)).words).toBe('1 of 2 acknowledged')
    as(scheduler)
    expect((await ack(shootA)).status).toBe(200)
    let b = await row(shootA)
    expect(ackState(b).complete).toBe(true)
    expect(hasAcknowledged(b, scheduler.id)).toBe(true)
    say('   editor pressed twice → counted once · crew pressed → 2 of 2 acknowledged')
    as(editor)
    expect((await unack(shootA, scheduler.id)).status).toBe(403)
    as(am)
    expect((await unack(shootA, scheduler.id)).status).toBe(200)
    expect(ackState(await row(shootA)).words).toBe('1 of 2 acknowledged')
    say('   Undo by an editor → refused · Undo by the AM → 1 of 2')
    as(scheduler)
    expect((await ack(shootA)).status).toBe(200)
    b = await screen(shootA, am, 'AM')
    expect(nextStepWords(b, melbourneToday())).toMatch(/^Next: the account manager ticks/)
  })

  it('6. the two ticks and Go — one press books the shoot and makes the editor’s one card', async () => {
    say('\nStep 6 — Go')
    as(editor)
    expect((await patch(shootA, { aligned: true })).status).toBe(403)
    expect((await move(shootA, 'confirmed')).status).toBe(422)
    as(am)
    expect((await patch(shootA, { aligned: true })).status).toBe(200)
    const stillNo = await move(shootA, 'confirmed')
    expect(stillNo.status).toBe(422)
    expect(stillNo.body.error).toMatch(/Client availability and location confirmed/)
    expect((await patch(shootA, { client_confirmed: true })).status).toBe(200)
    let b = await row(shootA)
    expect(goReady(b).ok).toBe(true)
    expect(nextStepWords(b, melbourneToday())).toMatch(/^Next: the account manager presses Go/)
    const since = new Date().toISOString()
    const go = await move(shootA, 'confirmed')
    expect(go.status, JSON.stringify(go.body)).toBe(200)
    expect(go.body.moved).toBe('Shoot confirmed — it is go')
    b = await screen(shootA, am, 'AM')
    expect(shootStage(b, melbourneToday())).toBe('confirmed')
    expect(b.status).toBe('locked')
    expect(b.go_by).toBe(am.id)
    expect(b.locked_by).toBe(am.id)
    // ONE SHOOT, ONE CARD
    const cards = await cardsOf(shootA)
    expect(cards.length).toBe(1)
    const card = cards[0]
    expect(card.id).toBe(shootCardId(shootA))
    expect(card.owner_id).toBe(editor.id)
    expect(String(card.due_date).slice(0, 10)).toBe(plusDays(14))
    expect(card.brief).toMatch(/5 reels/)
    expect(card.brief).toMatch(/1 photo set/)
    expect(card.brief).toMatch(/The reel first/)
    say(`   one card: "${card.title}" · owner the editor · due ${String(card.due_date).slice(0, 10)}`)
    const told = await toldUntil(since, [shootA], t => t.some(x => x.recipient_email === editor.email && /^You’re on/.test(x.subject)))
    noLeak(told)
    expect(told.filter(t => t.recipient_email === editor.email && /^You’re on/.test(t.subject)).length).toBe(1)
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    const again = await move(shootA, 'confirmed')
    expect(again.status).toBe(422)
    expect(again.body.error).toBe('Already in Confirmed')
    expect(nextStepWords(b, melbourneToday())).toMatch(/^Confirmed for .*\. The editor’s card is on the Editor page, due .*\. Next: Ops presses Reminder sent/)
    // the date is a commitment now
    expect((await patch(shootA, { shoot_date: plusDays(12) })).status).toBe(409)
  })

  it('7. Reminder sent — everyone on the shoot gets call time and location', async () => {
    say('\nStep 7 — Reminder sent')
    as(scheduler)
    expect((await move(shootA, 'reminder_sent')).status).toBe(422)
    as(am)
    const since = new Date().toISOString()
    const rem = await move(shootA, 'reminder_sent')
    expect(rem.status, JSON.stringify(rem.body)).toBe(200)
    expect(rem.body.moved).toBe('Reminder sent')
    const told = await toldUntil(since, [shootA], t => t.filter(x => /^Shoot reminder:/.test(x.subject)).length >= 2)
    noLeak(told)
    expect(told.filter(t => /^Shoot reminder:/.test(t.subject)).map(t => t.recipient_email).sort()).toEqual([editor.email, scheduler.email].sort())
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    const b = await screen(shootA, am, 'AM')
    expect(nextStepWords(b, melbourneToday())).toMatch(/^Reminder sent\. Next: the shoot on .*\. Nothing to press until then\.$/)
    expect((await move(shootA, 'reminder_sent')).body.error).toBe('Already in Reminder sent')
    const notYet = await move(shootA, 'footage_handed')
    expect(notYet.status).toBe(422)
    expect(notYet.body.error).toBe('The shoot has not happened yet')
  })

  it('8. shoot day — the footage folder, then Footage is in; the sweep then does nothing twice', async () => {
    say('\nStep 8 — shoot day')
    // the calendar moves it: the test moves the date to today
    await table('batches').update(shootA, { shoot_date: plusDays(0) } as never)
    let b = await screen(shootA, editor, 'Editor')
    expect(shootStage(b, melbourneToday())).toBe('shoot_day')
    expect(clockWords(b, melbourneToday())).toBe('Shoot is today')
    expect(nextStepWords(b, melbourneToday())).toMatch(/^Shooting today\./)
    // the footage folder: the crew may paste it, whatever their role; a stranger may not
    as(OTHER)
    expect((await patch(shootA, { footage_url: 'https://www.dropbox.com/scl/fo/abc/h' })).status).toBe(403)
    as(scheduler)
    const badLink = await patch(shootA, { footage_url: 'dropbox folder' })
    expect(badLink.status).toBe(422)
    const folder = await patch(shootA, { footage_url: 'https://www.dropbox.com/scl/fo/abc/h' })
    expect(folder.status, JSON.stringify(folder.body)).toBe(200)
    b = await row(shootA)
    expect(b.footage_url).toBe('https://www.dropbox.com/scl/fo/abc/h')
    say('   crew pasted the Dropbox folder · a scheduler not on the shoot is refused · "dropbox folder" is refused')
    // Footage is in — the editor may press it
    as(editor)
    const since = new Date().toISOString()
    const inn = await move(shootA, 'footage_handed')
    expect(inn.status, JSON.stringify(inn.body)).toBe(200)
    expect(inn.body.moved).toBe('Footage handed to the editor')
    expect(inn.body.handed?.total).toBe(1)
    b = await screen(shootA, editor, 'Editor')
    expect(shootStage(b, melbourneToday())).toBe('footage_handed')
    const cards = await cardsOf(shootA)
    expect(cards.length).toBe(1)
    expect(cards[0].raw_assets_url).toBe('https://www.dropbox.com/scl/fo/abc/h')
    const told = await toldUntil(since, [shootA], t => t.some(x => x.recipient_email === editor.email && /^Footage is in:/.test(x.subject)))
    noLeak(told)
    expect(told.filter(t => t.recipient_email === editor.email && /^Footage is in:/.test(t.subject)).length).toBe(1)
    say(`   told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    const again = await move(shootA, 'footage_handed')
    expect(again.status).toBe(422)
    expect(again.body.error).toBe('Already in Footage in')
    expect((await cardsOf(shootA)).length).toBe(1)
    // the morning-after sweep has nothing to do with a shoot a person handed over
    const before = (await toldSince(since, [shootA])).length
    expect(footageDueTargets([await row(shootA)], melbourneToday()).hand).toEqual([])
    if (await sweepSafe('footage')) {
      await runFootageDueSweep()
      await runFootageDueSweep()
      expect((await row(shootA)).footage_due_nudged_at ?? null).toBeNull()
      expect((await toldSince(since, [shootA])).length).toBe(before)
      say('   the sweep ran twice: nothing handed again, nobody told again')
    }
    expect(nextStepWords(b, melbourneToday())).toMatch(/^Footage should be in — the editor has been told/)
  })

  it('9. a late plan — the nudge once, go refused for the AM, a super admin goes ahead with a reason', async () => {
    say('\nStep 9 — the late plan')
    as(am)
    const made = await json(await createShoot(new Request('https://x.test/batches', {
      method: 'POST', body: JSON.stringify({ client_id: TEST_CLIENT_ID, title: `${TAG} B`, shoot_date: plusDays(3), location: '9 Test Lane' }),
    })))
    expect(made.status).toBe(201)
    shootB = String(made.body.id); created.batches.add(shootB)
    let b = await screen(shootB, am, 'AM')
    expect(briefIsLate(b, melbourneToday())).toBe(true)
    expect(clockWords(b, melbourneToday())).toBe('Plan is late — needed 7 days before the shoot')
    // the morning nudge: once
    let since = new Date().toISOString()
    expect(lateNudgeTargets([b], melbourneToday()).map(x => x.id)).toEqual([shootB])
    const lateSafe = await sweepSafe('late')
    if (lateSafe) {
      await runBriefLateNudge()
      const told = await toldUntil(since, [shootB], t => t.some(x => /Plan is late/.test(x.subject)))
      noLeak(told)
      expect(told.some(t => t.recipient_email === am.email && /Plan is late — needed 7 days before the shoot:/.test(t.subject))).toBe(true)
      expect((await row(shootB)).late_nudged_at).toBeTruthy()
      const n1 = told.filter(t => /Plan is late/.test(t.subject)).length
      await runBriefLateNudge()
      await new Promise(r => setTimeout(r, 1500))
      expect((await toldSince(since, [shootB])).filter(t => /Plan is late/.test(t.subject)).length).toBe(n1)
      say(`   nudge: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')} · a second run told nobody`)
    }

    // fill it, staff it, share it — late
    expect((await patch(shootB, {
      objective: 'Quick turnaround', planned_deliverables: [{ id: 'l1', title: '2 reels' }], shot_list: [{ id: 's1', text: 'Counter' }],
      script: 'Two lines', call_time: '9 am', talent: 'Founder', props_wardrobe: 'None', client_availability: 'All morning',
      editor_priorities: 'Reel 1 first', edit_deadline: plusDays(8), editor_id: editor.id, crew_ids: [scheduler.id],
    })).status).toBe(200)
    expect((await move(shootB, 'shared')).status).toBe(200)
    b = await row(shootB)
    expect(sharedLate(b)).toBe(true)
    since = new Date().toISOString()
    expect(lateShareNudgeTargets([b]).map(x => x.id)).toEqual([shootB])
    let told: Awaited<ReturnType<typeof toldSince>> = []
    if (lateSafe && await sweepSafe('late')) {
      await runBriefLateNudge()
      told = await toldUntil(since, [shootB], t => t.some(x => /Plan shared late/.test(x.subject)))
      expect(told.some(t => /Plan shared late:/.test(t.subject))).toBe(true)
      say(`   shared with 3 days to go → Ops told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
    }
    as(editor); expect((await ack(shootB)).status).toBe(200)
    as(scheduler); expect((await ack(shootB)).status).toBe(200)
    as(am)
    expect((await patch(shootB, { aligned: true, client_confirmed: true })).status).toBe(200)
    b = await screen(shootB, am, 'AM')
    const lateGo = await move(shootB, 'confirmed')
    expect(lateGo.status).toBe(400)
    expect(lateGo.body.needsOverride).toBe(true)
    expect(lateGo.body.error).toBe('The plan was shared 3 days before the shoot — the playbook needs 7. A super admin can override with a reason.')
    say(`   AM presses Go → refused: "${lateGo.body.error}"`)
    as(SUPER)
    expect((await move(shootB, 'confirmed')).status).toBe(400)
    since = new Date().toISOString()
    const override = await move(shootB, 'confirmed', 'The client moved the date; the crew is already booked')
    expect(override.status, JSON.stringify(override.body)).toBe(200)
    expect(override.body.moved).toBe('Shoot confirmed — went ahead late, with a reason')
    b = await screen(shootB, SUPER, 'Super admin')
    expect(overrideWords(b)).toBe('Went ahead late — The client moved the date; the crew is already booked')
    expect(b.status).toBe('locked')
    expect((await cardsOf(shootB)).length).toBe(1)
    told = await toldUntil(since, [shootB], t => t.some(x => /^Went ahead late:/.test(x.subject)))
    noLeak(told)
    expect(told.some(t => t.recipient_email === am.email && /^Went ahead late:/.test(t.subject))).toBe(true)
    say(`   super admin: Go anyway with a reason → confirmed · told: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
  })

  it('10. moving back, the morning-after handover by itself, and who may delete', async () => {
    say('\nStep 10 — back, the sweep, delete')
    as(editor)
    const back = await move(shootB, 'shared')
    expect(back.status).toBe(422)
    expect(back.body.error).toBe('Only an account manager can move a shoot back')
    as(am)
    expect((await move(shootB, 'shared')).status).toBe(200)
    let b = await row(shootB)
    expect(shootStage(b, melbourneToday())).toBe('shared')
    expect(b.go_at ?? null).toBeNull()
    say('   AM moved it back to Shared with team — the go stamp is cleared')
    as(SUPER)
    expect((await move(shootB, 'confirmed', 'Still going ahead')).status).toBe(200)
    // the shoot day passes with nobody pressing anything
    await table('batches').update(shootB, { shoot_date: plusDays(-1) } as never)
    b = await screen(shootB, editor, 'Editor')
    expect(shootStage(b, melbourneToday())).toBe('shoot_day')
    expect(clockWords(b, melbourneToday())).toBe('Shot yesterday')
    const since = new Date().toISOString()
    expect(footageDueTargets([b], melbourneToday()).hand.map(x => x.id)).toEqual([shootB])
    if (await sweepSafe('footage')) {
      const swept = await runFootageDueSweep()
      expect(swept.handed).toBeGreaterThanOrEqual(1)
      b = await screen(shootB, editor, 'Editor')
      expect(shootStage(b, melbourneToday())).toBe('footage_handed')
      expect(b.footage_due_nudged_at).toBeTruthy()
      const told = await toldUntil(since, [shootB], t => t.some(x => x.recipient_email === editor.email && /^Footage should be in:/.test(x.subject)))
      noLeak(told)
      expect(told.filter(t => t.recipient_email === editor.email && /^Footage should be in:/.test(t.subject)).length).toBe(1)
      const n = (await toldSince(since, [shootB])).length
      await runFootageDueSweep()
      await new Promise(r => setTimeout(r, 1500))
      expect((await toldSince(since, [shootB])).length).toBe(n)
      say(`   the morning after: handed by itself, told once: ${told.map(t => `${t.recipient_email} "${t.subject}"`).join(', ')}`)
      // Footage is in after the sweep: nothing to do
      as(am)
      expect((await move(shootB, 'footage_handed')).body.error).toBe('Already in Footage in')
    } else {
      // the person presses it instead; the rule is the same handover
      as(am)
      expect((await move(shootB, 'footage_handed')).status).toBe(200)
      b = await row(shootB)
      expect(shootStage(b, melbourneToday())).toBe('footage_handed')
    }

    // delete: the card is kept, the shoot goes — and only a manager may
    const cards = await cardsOf(shootB)
    const verdict = shootDeletion(cards)
    expect(verdict.allowed).toBe(true)
    as(editor)
    expect((await json(await deleteShoot(new Request('https://x.test/batch', { method: 'DELETE' }), params(shootB)))).status).toBe(403)
    as(scheduler)
    expect((await json(await deleteShoot(new Request('https://x.test/batch', { method: 'DELETE' }), params(shootB)))).status).toBe(403)
    as(am)
    const del = await json(await deleteShoot(new Request('https://x.test/batch', { method: 'DELETE' }), params(shootB)))
    expect(del.status, JSON.stringify(del.body)).toBe(200)
    expect(del.body.detached).toBe(cards.length)
    expect(await table<Batch>('batches').get(shootB, { fresh: true })).toBeNull()
    const kept = await table<ContentItem>('content_items').get(cards[0].id, { fresh: true })
    expect(kept?.batch_id ?? null).toBeNull()
    say(`   delete: editor and scheduler refused · AM deleted it, ${del.body.detached} card kept as its own card`)
  })

  it('11. who sees what, at the end', async () => {
    const b = await row(shootA)
    const sees = (who: TeamUser) => canSeeShoot({ id: who.id, role: who.role as never }, b, assignments.filter(a => a.team_user_id === who.id).map(a => a.client_id))
    expect(sees(SUPER)).toBe(true)
    expect(sees(GENERAL)).toBe(true)
    expect(sees(am)).toBe(true)
    expect(sees(editor)).toBe(true)
    expect(sees(scheduler)).toBe(true)
    expect(sees(OTHER)).toBe(false)
    as(OTHER); expect((await open(shootA)).status).toBe(403)
    as(scheduler); expect((await open(shootA)).status).toBe(200)
    say('\nStep 11 — sees shoot A: super admin, general, AM, editor, crew · not: another scheduler')
    const all = await toldSince(new Date(STAMP).toISOString(), [shootA, shootB])
    noLeak(all)
    expect(all.every(t => t.recipient_email.endsWith('.invalid') || t.status !== 'sent')).toBe(true)
  })
})

afterAll(async () => {
  writeFileSync(SCRIPT_PATH, script.join('\n'), 'utf8')
  for (const id of created.items) await table('content_items').remove(id).catch(() => {})
  for (const id of created.batches) await table('batches').remove(id).catch(() => {})
  const ents = [...created.items, ...created.batches]
  const strays = await Promise.all([
    table<{ id: string; entity_id?: string }>('workflow_activity').list({ fresh: true, where: a => ents.includes(String(a.entity_id ?? '')) }).catch(() => []),
    table<{ id: string; entity_id?: string }>('notification_log').list({ fresh: true, where: n => ents.some(i => String(n.entity_id ?? '').includes(i)) }).catch(() => []),
  ])
  const tables = ['workflow_activity', 'notification_log']
  for (let i = 0; i < strays.length; i++) for (const r of strays[i]) await table(tables[i] as never).remove(r.id).catch(() => {})
  const left = await Promise.all([
    table<ContentItem>('content_items').list({ fresh: true, where: i => String(i.title ?? '').startsWith(TAG) || created.items.has(i.id) }),
    table<Batch>('batches').list({ fresh: true, where: b => String(b.title ?? '').startsWith(TAG) }),
  ])
  console.log(`[teardown] left behind: items=${left[0].length} shoots=${left[1].length}`)
  expect(left[0].length + left[1].length).toBe(0)
})
