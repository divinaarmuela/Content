if (process.env.EMAIL_TEST_ONLY !== '1') throw new Error('refusing to run')

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { table, encodeKey, rtdbFetch } from '../../lib/db'
import type {
  Booking, BookingAvailability, BookingResource, BookingService,
  Client, ClientBrand, ClientContact, IntakeForm, MonthlyUpdate, NotificationLog, TeamUser,
} from '../../lib/db-types'
import { insertBooking } from '../../app/lib/booking'
import { answerableBlocks, type TemplateDefinition } from '../../app/lib/intake-core'

/**
 * The SUBMIT journeys, played live against the real database.
 *
 * The owner asked for the intake form, the monthly intake and the bookings to
 * be exercised all the way through the button that actually commits — not up
 * to it. So every journey below drives the REAL route handlers (or the exact
 * lib function the route calls) against the real Realtime Database and reads
 * the rows back afterwards.
 *
 * Safety, the same discipline as booking-overlap-live.e2e.ts:
 *  - EMAIL_TEST_ONLY=1 (tests/e2e/load-env.ts) — app/lib/mailer.ts refuses any
 *    recipient not ending in `.invalid` on every exported send path;
 *  - AND every form created here carries its own `notify_emails` of
 *    `intake-test@mdmedia-test.invalid`, so the recipient is test-safe even
 *    without the switch — the intake route's fallback to the real agency
 *    inbox is never relied on;
 *  - only the ZZ TEST client and its `@mdmedia-test.invalid` users;
 *  - every resource/service/booking/form is labelled `ZZ TEST SUBMIT …`;
 *  - services are created with requires_payment:false / price_cents:0, so no
 *    Stripe path is ever entered;
 *  - everything created is deleted in afterAll and read back to prove it.
 *
 * Authentication: the dashboard-side routes go through `requireRole`, which
 * resolves a Clerk session that does not exist in a vitest process. It is
 * mocked to return the ZZ TEST account manager (a `.invalid` account) so the
 * REAL route bodies run. Nothing else in authz is mocked.
 */

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const AM_ID = '3548cc71-5a34-4fe9-9130-11579d1a4137'
const NOTIFY = ['intake-test@mdmedia-test.invalid']
const STAMP = Date.now()
const TZ = 'Australia/Melbourne'
const BOOKINGS_HREF = '/dashboard/bookings'

let actingUser: TeamUser

vi.mock('../../app/lib/authz', async orig => {
  const actual = await orig() as Record<string, unknown>
  return { ...actual, requireRole: async () => actingUser }
})

/* ── bookkeeping ────────────────────────────────────────────────────────── */

const created = {
  intakeForms: [] as string[],
  monthlyForms: [] as string[],
  resources: [] as string[],
  services: [] as string[],
  bookings: [] as string[],
  availability: [] as string[],
  seatKeys: [] as string[],
  pageAccess: [] as string[],
}
/** every entity_id prefix whose notification_log rows we must clear */
const notifyPrefixes: string[] = []

const findings: string[] = []
const note = (s: string) => { findings.push(s); console.log(`[finding] ${s}`) }

/* ── helpers ────────────────────────────────────────────────────────────── */

const json = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const patchReq = (url: string, body: unknown) =>
  new Request(url, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const p = <T>(v: T) => Promise.resolve(v)

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

async function until<T>(probe: () => Promise<T>, done: (v: T) => boolean, budgetMs = 8000): Promise<T> {
  const deadline = Date.now() + budgetMs
  let last = await probe()
  while (!done(last) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250))
    last = await probe()
  }
  return last
}

/** the /mdm/live/<channel> marker, as the dashboards read it */
const liveMarker = async (channel: string): Promise<Record<string, unknown> | null> =>
  rtdbFetch(`/mdm/live/${channel}`).catch(() => null)

const markerTs = (m: Record<string, unknown> | null) => Number(m?.ts ?? 0)

/** every notification_log row for one entity id prefix */
async function notificationsFor(prefix: string) {
  return table<NotificationLog>('notification_log').list({
    fresh: true,
    where: r => typeof r.entity_id === 'string' && r.entity_id.startsWith(prefix),
  })
}

/**
 * A complete, plausible answer set for a stored form definition.
 *
 * Built FROM the definition rather than hard-coded, so the harness stays
 * correct when the templates change. File blocks are skipped — nothing is
 * uploaded here — and are reported as the expected shortfall.
 */
function fullAnswers(def: TemplateDefinition): { answers: Record<string, string | string[]>; skipped: string[] } {
  const answers: Record<string, string | string[]> = {}
  const skipped: string[] = []
  for (const b of answerableBlocks(def)) {
    const hay = `${b.id} ${b.label}`.toLowerCase()
    if (b.type === 'file') { skipped.push(b.id); continue }
    if (b.type === 'multi_select' || b.type === 'checkbox') {
      answers[b.id] = b.options?.length ? [b.options[0]] : ['ZZ TEST']
      continue
    }
    if (b.type === 'select') {
      answers[b.id] = b.options?.length ? b.options[0] : 'ZZ TEST'
      continue
    }
    if (b.type === 'link') { answers[b.id] = 'https://zz-test.invalid/brand'; continue }
    if (/e-?mail/.test(hay)) { answers[b.id] = 'intake-test@mdmedia-test.invalid'; continue }
    if (/phone|mobile|contact number/.test(hay)) { answers[b.id] = '+61400000000'; continue }
    if (/business|company|brand name|trading/.test(hay)) { answers[b.id] = 'ZZ TEST intake run'; continue }
    answers[b.id] = `ZZ TEST intake run — ${b.label.slice(0, 60)}`
  }
  return { answers, skipped }
}

/* ── the ZZ TEST client, before and after ───────────────────────────────── */

let clientBefore: Client | null = null
let brandBefore: ClientBrand | null = null
let contactIdsBefore = new Set<string>()

/* ── setup ─────────────────────────────────────────────────────────────── */

beforeAll(async () => {
  // 1. the acting identity must be a .invalid test account, or nothing runs
  const am = await table<TeamUser>('team_users').get(AM_ID)
  if (!am) throw new Error('ZZ TEST account manager not found')
  if (!am.email?.endsWith('.invalid')) throw new Error(`refusing to act as ${am.email}`)
  // super_admin only for the route's own role gate — never written to the DB
  actingUser = { ...am, role: 'super_admin' } as TeamUser

  // 2. snapshot the client, its brand row and its contacts
  clientBefore = await table<Client>('clients').get(TEST_CLIENT_ID, { fresh: true })
  if (!clientBefore) throw new Error('ZZ TEST client not found')
  expect(clientBefore.name).toMatch(/^ZZ TEST/)
  brandBefore = await table<ClientBrand>('client_brand').get(TEST_CLIENT_ID, { fresh: true }).catch(() => null)
  const contacts = await table<ClientContact>('client_contacts')
    .list({ fresh: true, where: c => c.client_id === TEST_CLIENT_ID })
  contactIdsBefore = new Set(contacts.map(c => c.id))
  console.log('[snapshot] client:', JSON.stringify(clientBefore))
  console.log('[snapshot] client_brand:', brandBefore ? JSON.stringify(brandBefore).slice(0, 300) : 'null')
  console.log('[snapshot] client_contacts:', [...contactIdsBefore].join(', ') || '(none)')

  // 3. the bookings page is a grant-only page — give the TEST account the
  //    grant for the run, and take it back in afterAll
  const grantId = `${AM_ID}__${encodeKey(BOOKINGS_HREF)}`
  const existing = await table('user_page_access').get(grantId).catch(() => null)
  if (!existing) {
    await table('user_page_access').insert({ team_user_id: AM_ID, href: BOOKINGS_HREF, hidden: false })
    created.pageAccess.push(grantId)
  }
})

/* ══ 1. INTAKE ═══════════════════════════════════════════════════════════ */

describe('1 · intake form: create → read → autosave → SUBMIT', () => {
  let formId = ''
  let token = ''
  let definition: TemplateDefinition
  let expected: Record<string, string | string[]> = {}

  it('creates the form through the dashboard route', async () => {
    const { POST } = await import('../../app/api/clients/[id]/intake/route')
    const res = await POST(
      json('http://t/api/clients/x/intake', { template_key: 'one_off', title: `ZZ TEST SUBMIT intake ${STAMP}` }),
      { params: p({ id: TEST_CLIENT_ID }) },
    )
    const body = await res.json()
    console.log('[1] create →', res.status, JSON.stringify(body))
    expect(res.status).toBe(201)
    formId = body.id; token = body.token
    created.intakeForms.push(formId)
    notifyPrefixes.push(formId)
    expect(body.status).toBe('draft')
  })

  it('pins the recipients to the .invalid test inbox', async () => {
    const { PATCH } = await import('../../app/api/clients/[id]/intake/route')
    const res = await PATCH(
      patchReq('http://t/api/clients/x/intake', { form_id: formId, action: 'set_recipients', emails: NOTIFY }),
      { params: p({ id: TEST_CLIENT_ID }) },
    )
    expect(res.status).toBe(200)
    const row = await table<IntakeForm>('intake_forms').get(formId, { fresh: true })
    console.log('[1] notify_emails →', JSON.stringify(row?.notify_emails))
    expect(row?.notify_emails).toEqual(NOTIFY)
  })

  /**
   * BUG, captured rather than fixed (see the report): `createIntakeForm`
   * writes `answers: {}`, and the Realtime Database does not store an empty
   * object — so the row reads back with `answers` UNDEFINED. `completion()`
   * indexes into it unguarded, so the very first thing a client does with
   * their link (GET /api/intake/<token>) throws. The same read is on the
   * dashboard's own intake panel.
   */
  it('BUG: the public token route throws on a form with no answers yet', async () => {
    const { GET } = await import('../../app/api/intake/[token]/route')
    const row = await table<IntakeForm>('intake_forms').get(formId, { fresh: true })
    console.log('[1] stored answers on a fresh form:', JSON.stringify(row?.answers))
    let outcome = 'ok'
    try {
      const res = await GET(new Request('http://t'), { params: p({ token }) })
      outcome = `HTTP ${res.status}`
    } catch (e) {
      outcome = `THREW ${(e as Error).message}`
    }
    console.log('[1] GET /api/intake/<token> on a fresh form →', outcome)
    if (outcome !== 'ok' && !outcome.startsWith('HTTP 200')) {
      note(`intake: GET /api/intake/<token> ${outcome} on a newly created form — `
        + `createIntakeForm writes answers:{}, RTDB drops empty objects, completion() reads answers[b.id] unguarded`)
    }
    // the dashboard panel reads the same way
    const { GET: listGET } = await import('../../app/api/clients/[id]/intake/route')
    let panel = 'ok'
    try {
      const res = await listGET(new Request('http://t/api/clients/x/intake'), { params: p({ id: TEST_CLIENT_ID }) })
      panel = `HTTP ${res.status}`
    } catch (e) {
      panel = `THREW ${(e as Error).message}`
    }
    console.log('[1] GET /api/clients/<id>/intake with a fresh form →', panel)
    if (panel !== 'HTTP 200') note(`intake: the dashboard intake panel ${panel} while a fresh form exists on the client`)

    // whatever the route did, the definition is on the row — carry on
    definition = row!.definition as unknown as TemplateDefinition
    expect(definition.sections.length).toBeGreaterThan(0)
    expect(row!.status).toBe('draft')
  })

  it('autosaves two fields and persists them, and the token route recovers', async () => {
    const { PATCH } = await import('../../app/api/intake/[token]/route')
    const blocks = answerableBlocks(definition).filter(b => b.type === 'short_text' || b.type === 'long_text')
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const [a, b] = blocks

    const r1 = await PATCH(patchReq('http://t', { [a.id]: 'ZZ TEST intake run' }), { params: p({ token }) })
    expect(r1.status).toBe(200)
    const r2 = await PATCH(patchReq('http://t', { [b.id]: 'ZZ TEST autosave second field' }), { params: p({ token }) })
    const saved = await r2.json()
    expect(r2.status).toBe(200)
    expect(saved.status).toBe('in_progress')

    const row = await table<IntakeForm>('intake_forms').get(formId, { fresh: true })
    const answers = row?.answers as Record<string, unknown>
    console.log(`[1] autosave → ${a.id}=${JSON.stringify(answers[a.id])} ${b.id}=${JSON.stringify(answers[b.id])}`)
    expect(answers[a.id]).toBe('ZZ TEST intake run')
    expect(answers[b.id]).toBe('ZZ TEST autosave second field')
    expect(row?.status).toBe('in_progress')

    // once an answer exists the public read works — proof the failure above is
    // the empty-object case, not the route
    const { GET } = await import('../../app/api/intake/[token]/route')
    const res = await GET(new Request('http://t'), { params: p({ token }) })
    const body = await res.json()
    console.log(`[1] GET token after autosave → ${res.status} answered=${body.completion?.answered}/${body.completion?.total}`)
    expect(res.status).toBe(200)
    expect(body.completion.total).toBeGreaterThan(0)
    expect(body.completion.answered).toBe(2)
  })

  it('SUBMITS with a complete answer set', async () => {
    const { PATCH } = await import('../../app/api/intake/[token]/route')
    const { POST } = await import('../../app/api/intake/[token]/submit/route')
    const built = fullAnswers(definition)
    expected = built.answers
    console.log(`[1] file blocks skipped (nothing uploaded): ${built.skipped.join(', ') || '(none)'}`)

    const fill = await PATCH(patchReq('http://t', expected), { params: p({ token }) })
    expect(fill.status).toBe(200)

    const before = await liveMarker('intake')
    const res = await POST(new Request('http://t', { method: 'POST' }), { params: p({ token }) })
    const body = await res.json()
    console.log('[1] SUBMIT →', res.status, JSON.stringify(body))
    expect(res.status).toBe(200)              // NOT a 500 — the route survived
    expect(body.status).toBe('submitted')

    const row = await table<IntakeForm>('intake_forms').get(formId, { fresh: true })
    expect(row?.status).toBe('submitted')
    expect(row?.submitted_at).toBeTruthy()
    expect(row?.answers).toEqual(expected)

    const files = await table('intake_files').list({ fresh: true, where: (f: any) => f.form_id === formId })
    console.log(`[1] intake_files rows: ${files.length}`)
    expect(files.length).toBe(0)

    const after = await until(() => liveMarker('intake'), m => markerTs(m) > markerTs(before))
    console.log(`[1] /mdm/live/intake ${markerTs(before)} → ${markerTs(after)} ${JSON.stringify(after)}`)
    expect(markerTs(after)).toBeGreaterThan(markerTs(before))
    expect(after?.form_id).toBe(formId)
    expect(after?.status).toBe('submitted')
  })

  it('logged a notification for the .invalid recipient and nobody else', async () => {
    const rows = await until(() => notificationsFor(formId), r => r.length > 0)
    console.log('[1] notification_log:', rows.map(r => `${r.recipient_email} ${r.status} ${r.error ?? ''}`).join(' | '))
    expect(rows.length).toBe(1)
    expect(rows[0].recipient_email).toBe(NOTIFY[0])
    expect(rows[0].event_type).toBe('intake_submitted')
    for (const r of rows) expect(r.recipient_email.endsWith('.invalid')).toBe(true)
    if (rows[0].status === 'sent') note('intake: SMTP2GO accepted a .invalid recipient (row marked sent)')
  })

  it('left the ZZ TEST client row untouched (enrichment did not run locally)', async () => {
    const after = await table<Client>('clients').get(TEST_CLIENT_ID, { fresh: true })
    const brandAfter = await table<ClientBrand>('client_brand').get(TEST_CLIENT_ID, { fresh: true }).catch(() => null)
    const contactsAfter = await table<ClientContact>('client_contacts')
      .list({ fresh: true, where: c => c.client_id === TEST_CLIENT_ID })

    const changed: string[] = []
    const keys = new Set([...Object.keys(clientBefore ?? {}), ...Object.keys(after ?? {})])
    for (const k of keys) {
      const b = JSON.stringify((clientBefore as any)?.[k]); const a = JSON.stringify((after as any)?.[k])
      if (b !== a) changed.push(`${k}: ${b} → ${a}`)
    }
    const newContacts = contactsAfter.filter(c => !contactIdsBefore.has(c.id))
    console.log('[1] client diff:', changed.length ? changed.join(' ; ') : '(none)')
    console.log('[1] client_brand:', brandBefore ? 'existed' : 'absent', '→', brandAfter ? 'present' : 'absent')
    console.log('[1] new client_contacts:', newContacts.map(c => c.id).join(', ') || '(none)')

    // clean up anything enrichment did create, then assert we are back
    for (const c of newContacts) await table('client_contacts').remove(c.id)
    if (!brandBefore && brandAfter) await table('client_brand').remove(brandAfter.id)
    if (changed.length && clientBefore) {
      await table('clients').update(TEST_CLIENT_ID, clientBefore as unknown as Record<string, unknown>)
      note(`intake submit changed the client row: ${changed.join(' ; ')} (restored)`)
    }
    expect(changed).toEqual([])
    expect(newContacts.map(c => c.id)).toEqual([])
  })

  it('deletes the form through the dashboard route', async () => {
    const { DELETE } = await import('../../app/api/clients/[id]/intake/route')
    const guard = await DELETE(
      new Request(`http://t/api/clients/x/intake?form_id=${formId}`, { method: 'DELETE' }),
      { params: p({ id: TEST_CLIENT_ID }) },
    )
    expect(guard.status).toBe(409)            // answers present → confirmation required
    const res = await DELETE(
      new Request(`http://t/api/clients/x/intake?form_id=${formId}&confirm=answers`, { method: 'DELETE' }),
      { params: p({ id: TEST_CLIENT_ID }) },
    )
    const body = await res.json()
    console.log('[1] DELETE →', res.status, JSON.stringify(body))
    expect(res.status).toBe(200)
    expect(await table('intake_forms').get(formId, { fresh: true })).toBeNull()
  })
})

/* ══ 2. MONTHLY ══════════════════════════════════════════════════════════ */

describe('2 · monthly form: create → autosave → SUBMIT', () => {
  const MONTH = 12, YEAR = 2099
  let formId = ''
  let token = ''
  let definition: TemplateDefinition
  let expected: Record<string, string | string[]> = {}

  it('creates the monthly form through the dashboard route', async () => {
    const { POST } = await import('../../app/api/clients/[id]/monthly/route')
    const res = await POST(
      json('http://t/api/clients/x/monthly', {
        month: MONTH, year: YEAR, title: `ZZ TEST SUBMIT monthly ${STAMP}`, notify_emails: NOTIFY,
      }),
      { params: p({ id: TEST_CLIENT_ID }) },
    )
    const body = await res.json()
    console.log('[2] create →', res.status, JSON.stringify(body))
    expect(res.status).toBe(201)
    expect(body.existed).toBe(false)
    formId = body.id; token = body.token
    created.monthlyForms.push(formId)
    notifyPrefixes.push(formId)

    const row = await table<MonthlyUpdate>('monthly_updates').get(formId, { fresh: true })
    expect(row?.notify_emails).toEqual(NOTIFY)
    expect(row?.status).toBe('draft')
  })

  it('BUG: the public token route throws on a form with no answers yet', async () => {
    const { GET } = await import('../../app/api/monthly/[token]/route')
    const row = await table<MonthlyUpdate>('monthly_updates').get(formId, { fresh: true })
    console.log('[2] stored answers on a fresh form:', JSON.stringify(row?.answers))
    let outcome = 'ok'
    try {
      const res = await GET(new Request('http://t'), { params: p({ token }) })
      outcome = `HTTP ${res.status}`
    } catch (e) {
      outcome = `THREW ${(e as Error).message}`
    }
    console.log('[2] GET /api/monthly/<token> on a fresh form →', outcome)
    if (outcome !== 'HTTP 200') {
      note(`monthly: GET /api/monthly/<token> ${outcome} on a newly created form — same empty-answers cause as intake`)
    }
    const { GET: listGET } = await import('../../app/api/clients/[id]/monthly/route')
    let panel = 'ok'
    try {
      const res = await listGET(new Request('http://t/api/clients/x/monthly'), { params: p({ id: TEST_CLIENT_ID }) })
      panel = `HTTP ${res.status}`
    } catch (e) {
      panel = `THREW ${(e as Error).message}`
    }
    console.log('[2] GET /api/clients/<id>/monthly with a fresh form →', panel)
    if (panel !== 'HTTP 200') note(`monthly: the dashboard monthly panel ${panel} while a fresh form exists on the client`)

    definition = row!.definition as unknown as TemplateDefinition
    expect(definition.sections.length).toBeGreaterThan(0)
    expect(row!.status).toBe('draft')
  })

  it('autosaves two fields and persists them', async () => {
    const { PATCH } = await import('../../app/api/monthly/[token]/route')
    const blocks = answerableBlocks(definition).filter(b => b.type === 'short_text' || b.type === 'long_text')
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    const [a, b] = blocks
    await PATCH(patchReq('http://t', { [a.id]: 'ZZ TEST monthly run' }), { params: p({ token }) })
    const r2 = await PATCH(patchReq('http://t', { [b.id]: 'ZZ TEST monthly second field' }), { params: p({ token }) })
    const saved = await r2.json()
    expect(r2.status).toBe(200)
    expect(saved.status).toBe('in_progress')
    const row = await table<MonthlyUpdate>('monthly_updates').get(formId, { fresh: true })
    const answers = row?.answers as Record<string, unknown>
    console.log(`[2] autosave → ${a.id}=${JSON.stringify(answers[a.id])} ${b.id}=${JSON.stringify(answers[b.id])}`)
    expect(answers[a.id]).toBe('ZZ TEST monthly run')
    expect(answers[b.id]).toBe('ZZ TEST monthly second field')
  })

  it('SUBMITS with a complete answer set', async () => {
    const { PATCH } = await import('../../app/api/monthly/[token]/route')
    const { POST } = await import('../../app/api/monthly/[token]/submit/route')
    expected = fullAnswers(definition).answers
    await PATCH(patchReq('http://t', expected), { params: p({ token }) })

    const before = await liveMarker('monthly')
    const res = await POST(new Request('http://t', { method: 'POST' }), { params: p({ token }) })
    const body = await res.json()
    console.log('[2] SUBMIT →', res.status, JSON.stringify(body))
    expect(res.status).toBe(200)
    expect(body.status).toBe('submitted')

    const row = await table<MonthlyUpdate>('monthly_updates').get(formId, { fresh: true })
    expect(row?.status).toBe('submitted')
    expect(row?.submitted_at).toBeTruthy()
    expect(row?.answers).toEqual(expected)

    const after = await until(() => liveMarker('monthly'), m => markerTs(m) > markerTs(before))
    console.log(`[2] /mdm/live/monthly ${markerTs(before)} → ${markerTs(after)} ${JSON.stringify(after)}`)
    expect(markerTs(after)).toBeGreaterThan(markerTs(before))
    expect(after?.form_id).toBe(formId)

    // monthly_commitments are a production-page concept; submitting a monthly
    // form does not create any — recorded rather than assumed
    const commitments = await table('monthly_commitments')
      .list({ fresh: true, where: (c: any) => c.client_id === TEST_CLIENT_ID })
      .catch(() => [])
    console.log(`[2] monthly_commitments for the test client: ${commitments.length}`)
  })

  it('logged a notification for the .invalid recipient and nobody else', async () => {
    const rows = await until(() => notificationsFor(formId), r => r.length > 0)
    console.log('[2] notification_log:', rows.map(r => `${r.recipient_email} ${r.status} ${r.error ?? ''}`).join(' | '))
    expect(rows.length).toBe(1)
    expect(rows[0].recipient_email).toBe(NOTIFY[0])
    expect(rows[0].event_type).toBe('monthly_submitted')
  })

  it('deletes the form through the dashboard route', async () => {
    const { DELETE } = await import('../../app/api/clients/[id]/monthly/route')
    const res = await DELETE(
      new Request(`http://t/api/clients/x/monthly?form_id=${formId}&confirm=answers`, { method: 'DELETE' }),
      { params: p({ id: TEST_CLIENT_ID }) },
    )
    console.log('[2] DELETE →', res.status)
    expect(res.status).toBe(200)
    expect(await table('monthly_updates').get(formId, { fresh: true })).toBeNull()
  })
})

/* ══ booking fixtures ════════════════════════════════════════════════════ */

/** a room + a zero-price service + a full week of opening hours */
async function makeRoom(label: string, opts: { slug: string; duration: number; capacity: number; name: string }) {
  const resource = await table<BookingResource>('booking_resources').insert({
    created_at: new Date().toISOString(),
    label, email: 'booking-test@mdmedia-test.invalid', timezone: TZ, active: true, space_id: null,
  })
  created.resources.push(resource.id)

  for (let weekday = 0; weekday <= 6; weekday++) {
    const row = await table<BookingAvailability>('booking_availability')
      .insert({ resource_id: resource.id, weekday, start_min: 540, end_min: 1020 })
    created.availability.push(row.id)
  }

  const service = await table<BookingService>('booking_services').insert({
    created_at: new Date().toISOString(),
    name: opts.name, slug: opts.slug, description: 'ZZ TEST SUBMIT — automated harness',
    duration_min: opts.duration, price_cents: 0, currency: 'AUD',
    active: true, sort_order: 9999, policy_text: null, resource_id: resource.id,
    lead_time_min: 0, horizon_days: 365, requires_payment: false,
    image_url: null, location: null, category: 'ZZ TEST SUBMIT', capacity: opts.capacity,
  })
  created.services.push(service.id)
  for (let seat = 1; seat <= opts.capacity; seat++) created.seatKeys.push(`${encodeKey(resource.id)}__${seat}`)
  return { resource, service }
}

let roomA: { resource: BookingResource; service: BookingService }
let roomB: { resource: BookingResource; service: BookingService }

const SLUG_A = `zz-test-submit-room-${STAMP}`
const SLUG_B = `zz-test-submit-event-${STAMP}`

async function slotsFor(slug: string, from: string) {
  const { GET } = await import('../../app/api/booking/public/slots/route')
  const res = await GET(new Request(`http://t/api/booking/public/slots?slug=${slug}&from=${from}&days=1`))
  const body = await res.json()
  return { status: res.status, body }
}

async function book(slug: string, d: string, min: number, email: string, name: string) {
  const { POST } = await import('../../app/api/booking/public/book/route')
  const res = await POST(json('http://t/api/booking/public/book', {
    slug, day: d, min, name, email, phone: '+61400000000',
    notes: 'ZZ TEST SUBMIT — automated harness', policy_agreed: true, company: '',
  }))
  return { status: res.status, body: await res.json() }
}

async function bookingByRef(ref: string) {
  const rows = await table<Booking>('bookings').list({ fresh: true, where: b => b.public_ref === ref, limit: 1 })
  return rows[0] ?? null
}

function trackBooking(id: string) {
  if (!created.bookings.includes(id)) { created.bookings.push(id); notifyPrefixes.push(id) }
}

/* ══ 3. PUBLIC BOOKING ═══════════════════════════════════════════════════ */

describe('3 · public booking: services → slots → BOOK → reschedule → cancel', () => {
  const D = day(10)
  let firstMin = 0
  let secondMin = 0
  let ref = ''

  it('sets up a ZZ TEST SUBMIT room and a free 60-minute service', async () => {
    roomA = await makeRoom(`ZZ TEST SUBMIT room ${STAMP}`, {
      slug: SLUG_A, duration: 60, capacity: 1, name: `ZZ TEST SUBMIT session ${STAMP}`,
    })
    console.log(`[3] resource=${roomA.resource.id} service=${roomA.service.id} slug=${SLUG_A}`)
  })

  it('the public services route lists it', async () => {
    const { GET } = await import('../../app/api/booking/public/services/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    const mine = body.services.find((s: any) => s.slug === SLUG_A)
    console.log('[3] services →', JSON.stringify(mine))
    expect(mine).toBeTruthy()
    expect(mine.price_cents).toBe(0)
    expect(mine.duration_min).toBe(60)
  })

  it('the public slots route offers times', async () => {
    const { status, body } = await slotsFor(SLUG_A, D)
    expect(status).toBe(200)
    const today = body.availability.find((a: any) => a.day === D)
    console.log(`[3] slots on ${D}: ${today?.slots.length} → ${today?.slots.slice(0, 4).map((s: any) => s.label).join(', ')}`)
    expect(today?.slots.length).toBeGreaterThan(2)
    firstMin = today.slots[0].min
    secondMin = today.slots[2].min
  })

  it('BOOKS a slot', async () => {
    const before = await liveMarker('production')
    const { status, body } = await book(SLUG_A, D, firstMin, 'booker@mdmedia-test.invalid', 'ZZ TEST SUBMIT booker')
    console.log('[3] BOOK →', status, JSON.stringify(body))
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.requires_payment).toBe(false)
    expect(body.ref).toMatch(/^[0-9a-f]{18}$/)
    ref = body.ref

    const row = await bookingByRef(ref)
    expect(row).toBeTruthy()
    trackBooking(row!.id)
    console.log(`[3] booking row: id=${row!.id} status=${row!.status} seat=${row!.seat_no} ${row!.start_at}→${row!.end_at}`)
    expect(row!.status).toBe('confirmed')
    expect(row!.customer_email).toBe('booker@mdmedia-test.invalid')
    expect(row!.amount_cents).toBe(0)

    const after = await until(() => liveMarker('production'), m => markerTs(m) > markerTs(before))
    console.log(`[3] /mdm/live/production ${markerTs(before)} → ${markerTs(after)} ${JSON.stringify(after)}`)
    expect(markerTs(after)).toBeGreaterThan(markerTs(before))
    expect(after?.item_id).toBe(`booking:${row!.id}`)
    expect(after?.status).toBe('created')
  })

  it('the manage route reads it back', async () => {
    const { GET } = await import('../../app/api/booking/public/manage/route')
    const res = await GET(new Request(`http://t/api/booking/public/manage?ref=${ref}`))
    const body = await res.json()
    expect(res.status).toBe(200)
    console.log('[3] manage GET →', JSON.stringify(body.booking), 'policy:', body.policy.canReschedule, body.policy.canCancel)
    expect(body.booking.status).toBe('confirmed')
    expect(body.policy.canReschedule).toBe(true)
  })

  it('RESCHEDULES to another slot', async () => {
    const { POST } = await import('../../app/api/booking/public/manage/route')
    const was = (await bookingByRef(ref))!.start_at
    const before = await liveMarker('production')
    const res = await POST(json('http://t', { ref, action: 'move', day: D, min: secondMin }))
    const body = await res.json()
    console.log('[3] RESCHEDULE →', res.status, JSON.stringify(body))
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    const row = await bookingByRef(ref)
    console.log(`[3] moved ${was} → ${row!.start_at} (end ${row!.end_at})`)
    expect(row!.start_at).not.toBe(was)
    expect(row!.start_at).toBe(body.start_at)
    expect(new Date(row!.end_at).getTime() - new Date(row!.start_at).getTime()).toBe(60 * 60_000)
    expect(row!.status).toBe('confirmed')

    const after = await until(() => liveMarker('production'), m => markerTs(m) > markerTs(before))
    console.log(`[3] /mdm/live/production ${markerTs(before)} → ${markerTs(after)} ${JSON.stringify(after)}`)
    expect(markerTs(after)).toBeGreaterThan(markerTs(before))
    expect(after?.status).toBe('moved')
  })

  it('CANCELS it', async () => {
    const { POST } = await import('../../app/api/booking/public/manage/route')
    const before = await liveMarker('production')
    const res = await POST(json('http://t', { ref, action: 'cancel' }))
    const body = await res.json()
    console.log('[3] CANCEL →', res.status, JSON.stringify(body))
    expect(res.status).toBe(200)
    expect(body.status).toBe('cancelled')

    const row = await bookingByRef(ref)
    expect(row!.status).toBe('cancelled')

    // a second cancel is refused, not silently repeated
    const again = await POST(json('http://t', { ref, action: 'cancel' }))
    console.log('[3] double cancel →', again.status, JSON.stringify(await again.json()))
    expect(again.status).toBe(409)

    const after = await until(() => liveMarker('production'), m => markerTs(m) > markerTs(before))
    console.log(`[3] /mdm/live/production ${markerTs(before)} → ${markerTs(after)} ${JSON.stringify(after)}`)
    expect(markerTs(after)).toBeGreaterThan(markerTs(before))
    expect(after?.status).toBe('cancelled')
  })

  it('emailed only .invalid addresses (the real watch list was refused)', async () => {
    const rows = await notificationsFor(created.bookings[0])
    const bad = rows.filter(r => !r.recipient_email.endsWith('.invalid') && r.status === 'sent' && r.channel === 'email')
    console.log('[3] notification_log:', rows.map(r => `${r.recipient_email} ${r.channel}/${r.status}`).join(' | '))
    expect(bad.map(r => r.recipient_email)).toEqual([])
  })
})

/* ══ 4. EVENTS / SEATS ═══════════════════════════════════════════════════ */

describe('4 · events: three seats, a fourth refused, a cancellation frees one', () => {
  const D = day(11)
  let min = 0
  const refs: string[] = []

  it('sets up a ZZ TEST SUBMIT event room with capacity 3', async () => {
    roomB = await makeRoom(`ZZ TEST SUBMIT event room ${STAMP}`, {
      slug: SLUG_B, duration: 60, capacity: 3, name: `ZZ TEST SUBMIT event ${STAMP}`,
    })
    const { body } = await slotsFor(SLUG_B, D)
    min = body.availability.find((a: any) => a.day === D).slots[0].min
    console.log(`[4] resource=${roomB.resource.id} service=${roomB.service.id} slot min=${min}`)
  })

  it('three concurrent bookings take seats 1, 2 and 3', async () => {
    const settled = await Promise.allSettled([1, 2, 3].map(n =>
      book(SLUG_B, D, min, `seat${n}-${STAMP}@mdmedia-test.invalid`, `ZZ TEST SUBMIT seat ${n}`)))
    const ok = settled.filter(s => s.status === 'fulfilled') as PromiseFulfilledResult<any>[]
    console.log('[4] three concurrent →', ok.map(r => `${r.value.status} ${JSON.stringify(r.value.body)}`).join(' | '))
    expect(ok.length).toBe(3)
    for (const r of ok) expect(r.value.status).toBe(200)

    const rows: Booking[] = []
    for (const r of ok) {
      refs.push(r.value.body.ref)
      const row = await bookingByRef(r.value.body.ref)
      expect(row).toBeTruthy()
      trackBooking(row!.id)
      rows.push(row!)
    }
    const seats = rows.map(r => r.seat_no).sort()
    console.log('[4] seats taken:', JSON.stringify(seats))
    expect(seats).toEqual([1, 2, 3])
    for (const r of rows) expect(r.status).toBe('confirmed')
  })

  it('a fourth is refused and writes no row', async () => {
    const countBefore = await table<Booking>('bookings')
      .count({ where: b => b.resource_id === roomB.resource.id })
    const { status, body } = await book(SLUG_B, D, min, `seat4-${STAMP}@mdmedia-test.invalid`, 'ZZ TEST SUBMIT seat 4')
    console.log('[4] fourth →', status, JSON.stringify(body))
    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/no longer available|just filled up/i)
    const countAfter = await table<Booking>('bookings')
      .count({ fresh: true, where: b => b.resource_id === roomB.resource.id })
    console.log(`[4] rows on the event room: ${countBefore} → ${countAfter}`)
    expect(countAfter).toBe(countBefore)
  })

  it('cancelling one frees its seat for a fifth booker', async () => {
    const { POST } = await import('../../app/api/booking/public/manage/route')
    const freedRow = await bookingByRef(refs[0])
    const freedSeat = freedRow!.seat_no
    const res = await POST(json('http://t', { ref: refs[0], action: 'cancel' }))
    console.log('[4] cancel seat', freedSeat, '→', res.status, JSON.stringify(await res.json()))
    expect(res.status).toBe(200)

    const fifth = await book(SLUG_B, D, min, `seat5-${STAMP}@mdmedia-test.invalid`, 'ZZ TEST SUBMIT seat 5')
    console.log('[4] fifth →', fifth.status, JSON.stringify(fifth.body))
    expect(fifth.status).toBe(200)
    const row = await bookingByRef(fifth.body.ref)
    trackBooking(row!.id)
    console.log(`[4] fifth took seat ${row!.seat_no} (freed seat was ${freedSeat})`)
    expect(row!.seat_no).toBe(freedSeat)
    expect(row!.status).toBe('confirmed')
  })
})

/* ══ 5. ADMIN BOOKING ════════════════════════════════════════════════════ */

describe('5 · admin: create → reschedule → cancel on the ZZ TEST SUBMIT room', () => {
  const D = day(12)
  let bookingId = ''
  const at = (hour: number) => `${D}T${String(hour).padStart(2, '0')}:00:00.000Z`

  it('creates a booking on the test room', async () => {
    // the admin route has no create action (see the report) — the dashboard
    // creates through the same shared lib the public route uses
    const b = await insertBooking({
      resource_id: roomA.resource.id,
      service_id: roomA.service.id,
      start_at: at(2), end_at: at(3),
      customer_name: 'ZZ TEST SUBMIT admin customer',
      customer_email: 'admin-booking@mdmedia-test.invalid',
      customer_phone: '+61400000000',
      notes: 'ZZ TEST SUBMIT — admin journey',
      status: 'confirmed', payment_status: 'unpaid', amount_cents: 0, seat_no: 1,
      public_ref: null,
    })
    bookingId = b.id
    trackBooking(bookingId)
    console.log(`[5] created ${bookingId} ${b.start_at}→${b.end_at} seat ${b.seat_no}`)
    expect(b.status).toBe('confirmed')
  })

  it('the admin GET sees it', async () => {
    const { GET } = await import('../../app/api/booking/admin/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    const mine = body.bookings.find((b: any) => b.id === bookingId)
    console.log('[5] admin GET → found:', !!mine, mine ? `${mine.status} ${mine.start_at}` : '')
    expect(mine).toBeTruthy()
  })

  it('RESCHEDULES through the admin route (the seatIsFree path)', async () => {
    const { POST } = await import('../../app/api/booking/admin/route')
    const res = await POST(json('http://t/api/booking/admin', {
      action: 'reschedule_booking', id: bookingId, start_at: at(5),
    }))
    const body = await res.json()
    console.log('[5] admin reschedule →', res.status, JSON.stringify(body.booking ?? body))
    expect(res.status).toBe(200)
    expect(body.booking.start_at).toBe(at(5))

    const row = await table<Booking>('bookings').get(bookingId, { fresh: true })
    console.log(`[5] row now ${row!.start_at}→${row!.end_at}`)
    expect(row!.start_at).toBe(at(5))
    expect(new Date(row!.end_at).getTime() - new Date(row!.start_at).getTime()).toBe(60 * 60_000)
  })

  it('refuses a reschedule onto a taken seat', async () => {
    const { POST } = await import('../../app/api/booking/admin/route')
    const blocker = await insertBooking({
      resource_id: roomA.resource.id, service_id: roomA.service.id,
      start_at: at(8), end_at: at(9),
      customer_name: 'ZZ TEST SUBMIT blocker', customer_email: 'blocker@mdmedia-test.invalid',
      customer_phone: null, notes: null, status: 'confirmed', payment_status: 'unpaid',
      amount_cents: 0, seat_no: 1, public_ref: null,
    })
    trackBooking(blocker.id)
    const res = await POST(json('http://t/api/booking/admin', {
      action: 'reschedule_booking', id: bookingId, start_at: at(8),
    }))
    const body = await res.json()
    console.log('[5] clash reschedule →', res.status, JSON.stringify(body))
    expect(res.status).toBe(409)
    expect(String(body.error)).toMatch(/already taken/i)
    const row = await table<Booking>('bookings').get(bookingId, { fresh: true })
    expect(row!.start_at).toBe(at(5))        // unmoved
  })

  it('CANCELS through the admin route', async () => {
    const { POST } = await import('../../app/api/booking/admin/route')
    const res = await POST(json('http://t/api/booking/admin', { action: 'cancel_booking', id: bookingId }))
    const body = await res.json()
    console.log('[5] admin cancel →', res.status, body.booking?.status)
    expect(res.status).toBe(200)
    expect(body.booking.status).toBe('cancelled')
    const row = await table<Booking>('bookings').get(bookingId, { fresh: true })
    expect(row!.status).toBe('cancelled')

    const again = await POST(json('http://t/api/booking/admin', { action: 'cancel_booking', id: bookingId }))
    console.log('[5] double cancel →', again.status)
    expect(again.status).toBe(409)
  })
})

/* ── teardown ──────────────────────────────────────────────────────────── */

afterAll(async () => {
  const swallow = (pr: Promise<unknown>) => pr.catch(() => {})

  for (const id of created.bookings) await swallow(table('bookings').remove(id))
  for (const key of created.seatKeys) await swallow(table('booking_seats').remove(key))
  for (const id of created.availability) await swallow(table('booking_availability').remove(id))
  for (const id of created.services) await swallow(table('booking_services').remove(id))
  for (const id of created.resources) await swallow(table('booking_resources').remove(id))
  for (const id of created.intakeForms) await swallow(table('intake_forms').remove(id))
  for (const id of created.monthlyForms) await swallow(table('monthly_updates').remove(id))
  for (const id of created.pageAccess) await swallow(table('user_page_access').remove(id))

  // every notification row this run produced, including the bell-only rows the
  // hard-coded booking watch list creates for real team members
  let notifRemoved = 0
  for (const prefix of notifyPrefixes) {
    notifRemoved += await table<NotificationLog>('notification_log')
      .removeWhere(r => typeof r.entity_id === 'string' && r.entity_id.startsWith(prefix))
      .catch(() => 0)
  }

  console.log('[teardown] created ids:', JSON.stringify(created, null, 0))
  console.log('[teardown] notification_log rows removed:', notifRemoved)

  // ── read back: nothing this file made may survive ──
  const [leftBookings, leftServices, leftResources, leftAvail, leftIntake, leftMonthly, leftNotif] = await Promise.all([
    table<Booking>('bookings').list({ fresh: true, where: b => created.bookings.includes(b.id) }),
    table<BookingService>('booking_services').list({ fresh: true, where: s => (s.category ?? '') === 'ZZ TEST SUBMIT' || s.name.startsWith('ZZ TEST SUBMIT') }),
    table<BookingResource>('booking_resources').list({ fresh: true, where: r => r.label.startsWith('ZZ TEST SUBMIT') }),
    table<BookingAvailability>('booking_availability').list({ fresh: true, where: a => created.resources.includes(a.resource_id) }),
    table<IntakeForm>('intake_forms').list({ fresh: true, where: f => created.intakeForms.includes(f.id) }),
    table<MonthlyUpdate>('monthly_updates').list({ fresh: true, where: f => created.monthlyForms.includes(f.id) }),
    table<NotificationLog>('notification_log').list({ fresh: true, where: r => { const e = r.entity_id; return typeof e === 'string' && notifyPrefixes.some(pre => e.startsWith(pre)) } }),
  ])
  const leftSeats = await table<{ id: string }>('booking_seats')
    .list({ fresh: true, where: s => created.seatKeys.includes(s.id) })

  console.log('[teardown] read-back leftovers —',
    'bookings:', leftBookings.length, 'services:', leftServices.length,
    'resources:', leftResources.length, 'availability:', leftAvail.length,
    'seats:', leftSeats.length, 'intake:', leftIntake.length,
    'monthly:', leftMonthly.length, 'notifications:', leftNotif.length)

  // ── the ZZ TEST client is exactly as we found it ──
  const clientAfter = await table<Client>('clients').get(TEST_CLIENT_ID, { fresh: true })
  const brandAfter = await table<ClientBrand>('client_brand').get(TEST_CLIENT_ID, { fresh: true }).catch(() => null)
  const contactsAfter = await table<ClientContact>('client_contacts')
    .list({ fresh: true, where: c => c.client_id === TEST_CLIENT_ID })
  const clientDiff: string[] = []
  for (const k of new Set([...Object.keys(clientBefore ?? {}), ...Object.keys(clientAfter ?? {})])) {
    const b = JSON.stringify((clientBefore as any)?.[k]); const a = JSON.stringify((clientAfter as any)?.[k])
    if (b !== a) clientDiff.push(`${k}: ${b} → ${a}`)
  }
  console.log('[teardown] client diff:', clientDiff.length ? clientDiff.join(' ; ') : '(none)')
  console.log('[teardown] client_brand:', brandBefore ? 'existed' : 'absent', '→', brandAfter ? 'present' : 'absent')
  console.log('[teardown] contacts:', contactsAfter.length, 'was', contactIdsBefore.size)
  console.log('[findings]', findings.length ? findings.join('\n  ') : '(none recorded in-run)')

  expect(leftBookings.map(b => b.id)).toEqual([])
  expect(leftServices.map(s => s.id)).toEqual([])
  expect(leftResources.map(r => r.id)).toEqual([])
  expect(leftAvail.map(a => a.id)).toEqual([])
  expect(leftSeats.map(s => s.id)).toEqual([])
  expect(leftIntake.map(f => f.id)).toEqual([])
  expect(leftMonthly.map(f => f.id)).toEqual([])
  expect(leftNotif.map(r => r.id)).toEqual([])
  expect(clientDiff).toEqual([])
  expect(contactsAfter.length).toBe(contactIdsBefore.size)
  expect(!!brandAfter).toBe(!!brandBefore)
})
