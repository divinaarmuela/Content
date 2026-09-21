import 'server-only'
import { table } from '@/lib/db'
import type { Prospect as ProspectRow, ProspectEvent, TeamUser, Todo } from '@/lib/db-types'
import { ACQ_EVENT_KINDS, acqStageByKey, followUpTasks, prospectForSender, type AcqEventKind, type Prospect } from './acquisition-core'
import { escapeHtml, notify, renderEmail } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { takeClaimLock } from './claim-lock'

/**
 * THE ACQUISITION SYSTEM — the server half (acquisition-core.ts has the rules
 * and the blueprint's words). Three jobs: write the timeline, tell the NEXT
 * person their turn has come, and make or pause the follow-up reminders. The
 * system only prompts — every prospect-facing message is a person's to write.
 */

type Actor = { id: string; name?: string | null; email?: string | null; clerk_user_id?: string | null }

export function prospectPath(id: string): string {
  return `/dashboard/leads/acquisition?prospect=${encodeURIComponent(id)}`
}

/** one line on the prospect's timeline; the points come from the kind unless given */
export async function logAcqEvent(input: {
  prospectId: string; kind: AcqEventKind; by?: string | null; detail?: string | null
  source?: 'person' | 'system' | 'scanner'; points?: number; confirmed?: boolean; at?: string
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
 * blueprint's +30, the call's time is kept if none was, the no-response
 * reminders stop (a booking IS a response), and the owner is told. The stage
 * is left for a person: the scanner never moves a prospect past Engaged.
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
    await logAcqEvent({
      prospectId: p.id, kind: 'call_booked', source: 'scanner',
      detail: `Booked through the booking page by ${booking.customer_name || email}${when ? ` for ${when}` : ''}${known.by === 'domain' ? ' (matched on the business’s domain)' : ''}`,
    })
    const now = new Date().toISOString()
    await prospects.claim(p.id, ((cur: ProspectRow | null): unknown => {
      const row = cur as (ProspectRow & Prospect) | null
      if (!row) return null
      return { ...row, call_at: row.call_at ?? when, replied_at: row.replied_at ?? now, updated_at: now }
    }) as (c: ProspectRow | null) => ProspectRow | null)
    await onReply({ id: 'scanner', name: 'Booking page' }, p, `They booked a call${when ? ` for ${when}` : ''}.`)
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
export async function recordReply(actor: Actor, p: ProspectRow, detail: string | null, opts: { by?: string | null; source?: 'person' | 'scanner'; points?: number; at?: string } = {}): Promise<ProspectEvent> {
  const now = new Date().toISOString()
  const event = await logAcqEvent({ prospectId: p.id, kind: 'reply', by: opts.by ?? null, source: opts.source ?? 'person', detail, points: opts.points, at: opts.at })
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
