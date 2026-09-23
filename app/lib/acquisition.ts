import 'server-only'
import { table } from '@/lib/db'
import { getScanSettings } from './scan-settings'
import type { Prospect as ProspectRow, ProspectEvent, TeamUser, Todo } from '@/lib/db-types'
import { ACQ_EVENT_KINDS, acqStageByKey, followUpTasks, prospectForSender, type AcqEventKind, type Prospect, replyPoints } from './acquisition-core'
import { escapeHtml, notify, renderEmail } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { takeClaimLock } from './claim-lock'
import { clickDetail, clickPoints, TRACKED_WORDS, type TrackedKind } from './tracked-link-core'

/**
 * THE ACQUISITION SYSTEM — the server half (acquisition-core.ts has the rules
 * and the blueprint's words). Three jobs: write the timeline, tell the NEXT
 * person their turn has come, and make or pause the follow-up reminders. The
 * system only prompts — every prospect-facing message is a person's to write.
 */

type Actor = { id: string; name?: string | null; email?: string | null; clerk_user_id?: string | null }

export function prospectPath(id: string): string {
  return `/dashboard/leads/acquisition/${encodeURIComponent(id)}`
}

/** one line on the prospect's timeline; the points come from the kind unless given */
export async function logAcqEvent(input: {
  prospectId: string; kind: AcqEventKind; by?: string | null; detail?: string | null
  source?: 'person' | 'system' | 'scanner' | 'agent'; points?: number; confirmed?: boolean; at?: string
  /** the agent's: the message it read, and how sure it was (acq-agent-core.ts) */
  evidenceId?: string | null; confidence?: number | null
}): Promise<ProspectEvent> {
  return table<ProspectEvent>('prospect_events').insert({
    prospect_id: input.prospectId,
    kind: input.kind,
    at: input.at ?? new Date().toISOString(),
    by: input.by ?? null,
    source: input.source ?? 'person',
    detail: input.detail ? String(input.detail).slice(0, 2000) : null,
    points: input.points ?? ACQ_EVENT_KINDS[input.kind].points,
    confirmed: input.confirmed ?? true,
    evidence_id: input.evidenceId ?? null,
    confidence: input.confidence ?? null,
  } as never)
}

/**
 * THE PEOPLE THE BLUEPRINT NAMES (§4): Manal researches, Divina and Martin make
 * the audit, Joy reaches out. Found by first name among the active team, the
 * same way the 17 Sep pipeline names its seats; nobody found = nobody told,
 * never a guess.
 */
export async function peopleNamed(firstNames: readonly string[]): Promise<TeamUser[]> {
  const team = await table<TeamUser>('team_users').list({ where: u => u.active_status !== false && u.role !== 'client' })
  const wanted = firstNames.map(n => n.toLowerCase())
  return team.filter(u => wanted.includes(String(u.name ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''))
}

export async function tellPeople(people: readonly TeamUser[], actor: Actor, p: Pick<Prospect, 'id' | 'business'>, input: {
  event: string; subject: string; html: string; button: string
}): Promise<void> {
  // PAUSED FOR A TEST (the owner, 23 Sep 2026): the switch in Settings → Inbox scanner stops every acquisition email
  if ((await getScanSettings().catch(() => null))?.acq_notifications_paused) { console.log(`[acquisition] emails paused — not telling ${people.length} about ${input.event} on ${p.business}`); return }
  await Promise.all(people.filter(u => u.id !== actor.id && !!u.email).map(u => notify({
    actorName: actor.name ?? null, actorEmail: actor.email ?? null, actorClerkId: actor.clerk_user_id ?? null,
    eventType: input.event, entityType: 'prospect', entityId: `${p.id}#${input.event}#${u.id}`,
    recipientId: u.id, recipientEmail: u.email,
    subject: input.subject,
    bodyHtml: renderEmail(input.subject, input.html, input.button, `${DASHBOARD_URL}${prospectPath(p.id)}`),
  }).catch(e => console.error('[acquisition] could not tell', u.email, e))))
}

/** a reminder on somebody's To-dos, tied to the prospect */
async function makeTask(ownerId: string | null, byId: string, p: Pick<Prospect, 'id'>, t: { title: string; note: string; due_date: string | null }): Promise<void> {
  const now = new Date().toISOString()
  await table<Todo>('todos').insert({
    title: t.title.slice(0, 200), note: t.note.slice(0, 2000), status: 'open', due_date: t.due_date,
    owner_id: ownerId, created_by: byId, client_id: null, prospect_id: p.id, files: [], created_at: now, updated_at: now,
  } as never)
}

/** RESEARCH DONE → the content people are told, and one of them gets the task (§12) */
export async function onReadyForContent(actor: Actor, p: ProspectRow): Promise<void> {
  const people = await peopleNamed(['Divina', 'Martin'])
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  if (people[0]) await makeTask(people[0].id, actor.id, p, { title: `Audit content — ${p.business}`, note: `${p.audit_angle ? `Angle: ${p.audit_angle}. ` : ''}A short public audit post and/or a private Loom. Mark it ready on the prospect and Joy is told.`, due_date: due })
  await tellPeople(people, actor, p, {
    event: 'acq_ready_for_content', subject: `New target ready for an audit: ${p.business}`, button: 'Open the target',
    html: `<p><strong>${escapeHtml(p.business)}</strong> is researched and ready for audit content.</p>${p.audit_angle ? `<p>Angle: ${escapeHtml(String(p.audit_angle))}</p>` : ''}<p><strong>What happens next:</strong> make the public audit post and/or the private Loom, add their links to the target, and press “Content ready”.</p>`,
  })
}

/** CONTENT READY → Joy is told and gets the outreach task (§12) */
export async function onContentReady(actor: Actor, p: ProspectRow): Promise<void> {
  const people = await peopleNamed(['Joy'])
  const owner = people[0]?.id ?? (p as { owner_id?: string | null }).owner_id ?? null
  await makeTask(owner, actor.id, p, { title: `Send the outreach — ${p.business}`, note: 'The audit is ready: its links are on the prospect. Send the DM or email with the asset and the booking link, then mark outreach sent. You write it; this is only the reminder.', due_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) })
  await tellPeople(people, actor, p, {
    event: 'acq_content_ready', subject: `Audit ready to send: ${p.business}`, button: 'Open the prospect',
    html: `<p>The audit content for <strong>${escapeHtml(p.business)}</strong> is ready.</p><p><strong>What happens next:</strong> send the DM or email with the asset and the booking link, then mark outreach sent. The follow-up reminders start from that moment.</p>`,
  })
}

/** whose job the next thing is: the prospect's owner, else the named person, else whoever pressed */
async function ownerOr(p: ProspectRow, firstName: string | null, actor: Actor): Promise<string> {
  const own = (p as { owner_id?: string | null }).owner_id
  if (own) return own
  const named = firstName ? (await peopleNamed([firstName]))[0] : null
  return named?.id ?? actor.id
}
const dayOf = (iso: string | number) => new Date(iso).toISOString().slice(0, 10)

/**
 * A CALL IS BOOKED (§12: "Update stage to Qualified / Call Booked. Create call
 * reminder workflow and internal prep task"). One place, for a person's press,
 * the app's own booking page and later any scanner: the line on the timeline
 * (the blueprint's +30), the call's time, the stage — anything before
 * Qualified moves there inside a claim, nothing is ever moved back — the
 * no-response reminders stopped, a prep task for the day before and a
 * reminder for the day itself.
 */
export async function recordCallBooked(actor: Actor, p: ProspectRow, when: string | null, detail: string | null, opts: { by?: string | null; source?: 'person' | 'scanner' | 'agent'; evidenceId?: string | null; confidence?: number | null } = {}): Promise<ProspectEvent> {
  const now = new Date().toISOString()
  const event = await logAcqEvent({ prospectId: p.id, kind: 'call_booked', by: opts.by ?? null, source: opts.source ?? 'person', detail, evidenceId: opts.evidenceId, confidence: opts.confidence })
  const prospects = table<ProspectRow>('prospects')
  let movedFrom: string | null = null
  await prospects.claim(p.id, ((cur: ProspectRow | null): unknown => {
    const row = cur as (ProspectRow & Prospect) | null
    if (!row) return null
    const early = acqStageByKey(row.stage).n < acqStageByKey('qualified').n
    movedFrom = early ? acqStageByKey(row.stage).label : null
    return { ...row, call_at: when ?? row.call_at ?? null, replied_at: row.replied_at ?? now, ...(early ? { stage: 'qualified', stage_entered_at: now } : {}), updated_at: now }
  }) as (c: ProspectRow | null) => ProspectRow | null)
  if (movedFrom) await logAcqEvent({ prospectId: p.id, kind: 'stage', by: opts.by ?? null, source: 'system', detail: 'Moved to Qualified / Call booked — they booked the discovery call' })
  try {
    await onReply(actor, p, detail)
    const owner = await ownerOr(p, 'Joy', actor)
    const callDay = when && !Number.isNaN(Date.parse(when)) ? dayOf(when) : null
    await makeTask(owner, actor.id, p, { title: `Prepare for the discovery call — ${p.business}`, note: 'Read the audit and what they have said so far. Know the business issue, the service they are likely to want and the questions that qualify them.', due_date: callDay ? dayOf(Date.parse(callDay) - 86_400_000) : dayOf(Date.now()) })
    if (callDay) await makeTask(owner, actor.id, p, { title: `Discovery call today — ${p.business}`, note: `The call is booked for ${when}. When it is done, move the prospect to Discovery held and write what was said.`, due_date: callDay })
  } catch (e) { console.error('[acquisition] the booked call’s prompts failed:', e) }
  return event
}

/** THE CALL HAPPENED → "Request call summary. Prompt owner to select outcome: proposal, nurture, not fit or closed lost" (§12) */
export async function onDiscoveryHeld(actor: Actor, p: ProspectRow): Promise<void> {
  await makeTask(await ownerOr(p, null, actor), actor.id, p, { title: `Call summary and outcome — ${p.business}`, note: 'Write the call notes on the prospect (service fit, budget fit, next step), then choose the outcome: send a proposal, keep nurturing (Not now), not a fit or closed lost (Dormant).', due_date: dayOf(Date.now() + 86_400_000) })
}

/** PROPOSAL SENT → "Create proposal follow-up task. Track proposal link and due date" (§12) */
export async function onProposalSent(actor: Actor, p: ProspectRow): Promise<void> {
  await makeTask(await ownerOr(p, null, actor), actor.id, p, { title: `Follow up the proposal — ${p.business}`, note: `${(p as { proposal_url?: string | null }).proposal_url ? `The proposal: ${(p as { proposal_url?: string | null }).proposal_url}. ` : ''}Check they have read it and answer what they ask. You write it; this is only the reminder.`, due_date: dayOf(Date.now() + 3 * 86_400_000) })
}

/** DEPOSIT INVOICE SENT → "Track payment status" (§12): a person checks until the scanner can */
export async function onDepositSent(actor: Actor, p: ProspectRow): Promise<void> {
  await makeTask(await ownerOr(p, null, actor), actor.id, p, { title: `Has the deposit been paid? — ${p.business}`, note: `${(p as { invoice_ref?: string | null }).invoice_ref ? `Invoice ${(p as { invoice_ref?: string | null }).invoice_ref}. ` : ''}When the payment is confirmed, move the prospect to Deposit paid.`, due_date: dayOf(Date.now() + 7 * 86_400_000) })
}

/** CONTRACT SIGNED → HANDOFF: "Create delivery onboarding task and link to delivery dashboard" (§12) */
export async function onHandoff(actor: Actor, p: ProspectRow, clientId: string | null): Promise<void> {
  const owner = await ownerOr(p, null, actor)
  await makeTask(owner, actor.id, p, { title: `Onboard the new client — ${p.business}`, note: `${clientId ? `The client: ${DASHBOARD_URL}/dashboard/clients/${clientId}. ` : ''}Name the account manager, send the intake form, set the service package and plan the first shoot brief.`, due_date: dayOf(Date.now() + 2 * 86_400_000) })
  const managers = await table<TeamUser>('team_users').list({ where: u => u.active_status !== false && u.role === 'super_admin' })
  await tellPeople(managers, actor, p, {
    event: 'acq_handoff', subject: `New client signed: ${p.business}`, button: 'Open the prospect',
    html: `<p><strong>${escapeHtml(p.business)}</strong> signed and is now a client in the dashboard.</p><p><strong>What happens next:</strong> name the account manager, send the intake form and plan the first shoot brief.</p>`,
  })
}

/** OUTREACH SENT → the Day 1, 3, 5, 7, 14 and 21 reminders (§8, §12) */
export async function onOutreachSent(actor: Actor, p: ProspectRow): Promise<void> {
  const row = p as ProspectRow & { outreach_at?: string | null; owner_id?: string | null; outreach_by?: string | null }
  const owner = row.owner_id ?? row.outreach_by ?? actor.id
  for (const t of followUpTasks(p.business, String(row.outreach_at ?? new Date().toISOString()))) {
    await makeTask(owner, actor.id, p, { title: t.title, note: t.note, due_date: t.due_date })
  }
}

/**
 * A PROSPECT BOOKED A CALL (the owner, 21 Sep 2026: "identify if a call is
 * booked"). The surest source is the app's own booking page: a booking whose
 * customer email is a prospect's is that prospect's discovery call — no
 * reading of subject lines, no guess. It goes on the timeline as the
 * blueprint's +30 and everything §12 asks of a booked call (recordCallBooked):
 * the stage moves to Qualified / Call booked, the reminders stop, the prep
 * task and the call-day reminder are made.
 * One booking is one line — locked on the booking's id. Never throws: a
 * booking must not fail because the acquisition board could not be told.
 */
export async function onBookingMade(booking: { id: string; customer_email?: string | null; customer_name?: string | null; start_at?: string | null }): Promise<void> {
  try {
    const email = String(booking.customer_email ?? '').trim()
    if (!email) return
    const prospects = table<ProspectRow>('prospects')
    const known = prospectForSender(await prospects.list(), email)
    if (!known) return
    const p = known.prospect
    const lock = await takeClaimLock(`acq_booking__${booking.id}`, p.id)
    if (!lock.ok) return
    const when = booking.start_at ?? null
    await recordCallBooked({ id: 'scanner', name: 'Booking page' }, p,
      when, `Booked through the booking page by ${booking.customer_name || email}${when ? ` for ${when}` : ''}${known.by === 'domain' ? ' (matched on the business’s domain)' : ''}`,
      { source: 'scanner' })
  } catch (e) {
    console.error('[acquisition] a booking could not be put on the prospect:', e)
  }
}

/**
 * A REPLY, RECORDED — by a person's button or by the inbox scanner, the same
 * way: the line on the timeline, the reply stamped once, an outreach-stage
 * target moved into New lead / Engaged inside a claim (two reporters of one
 * reply move it once), and the no-response reminders paused.
 */
export async function recordReply(actor: Actor, p: ProspectRow, detail: string | null, opts: { by?: string | null; source?: 'person' | 'scanner' | 'agent'; points?: number; at?: string; evidenceId?: string | null; confidence?: number | null } = {}): Promise<ProspectEvent> {
  const now = new Date().toISOString()
  // ONE REPLY, ONE SCORE: a further reply after the first is recorded with its words but scores nothing
  const points = opts.points ?? replyPoints(p as never)
  const words = detail ?? (points === 0 ? 'A further reply — the first one already scored' : null)
  const event = await logAcqEvent({ prospectId: p.id, kind: 'reply', by: opts.by ?? null, source: opts.source ?? 'person', detail: words, points, at: opts.at, evidenceId: opts.evidenceId, confidence: opts.confidence })
  const prospects = table<ProspectRow>('prospects')
  const wasAtOutreach = acqStageByKey((p as ProspectRow & Prospect).stage).key === 'outreach'
  const moved = await prospects.claim(p.id, ((cur: ProspectRow | null): unknown => {
    const row = cur as (ProspectRow & Prospect) | null
    if (!row) return null
    const atOutreach = acqStageByKey(row.stage).key === 'outreach'
    return { ...row, replied_at: row.replied_at ?? opts.at ?? now, ...(atOutreach ? { stage: 'engaged', stage_entered_at: now } : {}), updated_at: now }
  }) as (c: ProspectRow | null) => ProspectRow | null)
  if (moved.claimed && wasAtOutreach) {
    await logAcqEvent({ prospectId: p.id, kind: 'stage', by: opts.by ?? null, source: 'system', detail: 'Moved to New lead / Engaged — they replied' })
  }
  try { await onReply(actor, p, detail) } catch (e) { console.error('[acquisition] pausing the follow-ups failed:', e) }
  return event
}

/**
 * A TRACKED LINK CLICKED (the blueprint, §8): the click goes on the timeline — the first one with the
 * Loom's +15, a later one as a note — and a target still at Outreach becomes a lead, in New lead /
 * Engaged, with its owner told. The no-response reminders keep going: a click is interest, not a reply.
 */
export async function recordLinkClick(p: ProspectRow, kind: TrackedKind): Promise<ProspectEvent> {
  const now = new Date().toISOString()
  const prior = await table<ProspectEvent>('prospect_events').list({ where: e => e.prospect_id === p.id && e.kind === 'link_click' })
  const event = await logAcqEvent({ prospectId: p.id, kind: 'link_click', source: 'system', detail: clickDetail(kind, prior.length), points: clickPoints(prior.length) })
  const prospects = table<ProspectRow>('prospects')
  const wasAtOutreach = acqStageByKey((p as ProspectRow & Prospect).stage).key === 'outreach'
  const moved = await prospects.claim(p.id, ((cur: ProspectRow | null): unknown => {
    const row = cur as (ProspectRow & Prospect) | null
    if (!row) return null
    const atOutreach = acqStageByKey(row.stage).key === 'outreach'
    return { ...row, ...(atOutreach ? { stage: 'engaged', stage_entered_at: now } : {}), updated_at: now }
  }) as (c: ProspectRow | null) => ProspectRow | null)
  if (moved.claimed && wasAtOutreach) {
    await logAcqEvent({ prospectId: p.id, kind: 'stage', source: 'system', detail: 'Moved to New lead / Engaged — they opened the link' })
    const ownerId = (p as { owner_id?: string | null }).owner_id
    const owner = ownerId ? await table<TeamUser>('team_users').get(ownerId) : null
    if (owner) {
      const what = TRACKED_WORDS[kind].label.toLowerCase()
      await tellPeople([owner], { id: 'system', name: 'The tracked link' }, p, {
        event: 'acq_click', subject: `${p.business} opened the ${what} link`, button: 'Open the prospect',
        html: `<p><strong>${escapeHtml(p.business)}</strong> opened the ${escapeHtml(what)} link you sent. It is now a lead, in New lead / Engaged. The follow-up reminders keep going until they reply.</p>`,
      })
    }
  }
  return event
}

/** A REPLY → the no-response reminders stop (§12: "pause no-response follow-up tasks"), and the owner is told */
export async function onReply(actor: Actor, p: ProspectRow, said: string | null): Promise<void> {
  const todos = table<Todo>('todos')
  const open = await todos.list({ where: t => (t as { prospect_id?: string | null }).prospect_id === p.id && t.status === 'open' && /^Day \d+ · /.test(String(t.title ?? '')) })
  const now = new Date().toISOString()
  await Promise.all(open.map(t => todos.update(t.id, { status: 'done', done_at: now, done_by: null, note: `Paused — they replied. ${t.note ?? ''}`.slice(0, 2000), updated_at: now } as never)))
  const ownerId = (p as { owner_id?: string | null }).owner_id
  const owner = ownerId ? await table<TeamUser>('team_users').get(ownerId) : null
  if (owner) {
    await tellPeople([owner], actor, p, {
      event: 'acq_reply', subject: `${p.business} replied`, button: 'Open the prospect',
      html: `<p><strong>${escapeHtml(p.business)}</strong> replied${said ? `:</p><blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(said.slice(0, 500))}</blockquote><p>` : '. '}The follow-up reminders are paused. It is now a lead, in New lead / Engaged.</p>`,
    })
  }
}
