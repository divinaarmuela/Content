import 'server-only'
import { table } from '@/lib/db'
import type { Batch, Client, TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { escapeHtml, notify, renderEmail } from './mailer'
import {
  LATE_WORDS, acksOf, daysUntilShoot, lateNudgeTargets, peopleOnShoot, type HandoverPlan, lateShareNudgeTargets, shareLeadDays,
  planAsText, type ClientDecision,
} from './shoot-sop-core'
import { shootCardId } from './deliverable-group-core'
import { ackLink, ackSecret } from './shoot-ack-token'

/**
 * WHO IS TOLD WHAT, ALONG THE SHOOT BRIEF SOP — the server half.
 *
 * Every action on the shoot page that names a person emails them (the
 * owner, 13 Sep 2026: "sending for a review currently doesn't trigger
 * notification"): the account manager named on a new shoot; the editor and
 * the crew when the plan is shared; the client when the plan is shared with
 * them; the managers when the client answers; everyone on the shoot for the
 * reminder; the editor at go and when the footage is in (shoot-handover);
 * Ops and the managers when a plan is late or taken ahead late. Every send
 * goes through `notify`, whose dedupe key means a retry or a second press
 * can never mail twice.
 *
 * NOBODY IS SENT TO THE SHOOT PAGE BUT ITS MANAGERS. The editor's link opens
 * their card on the Editor page; a crew member's link is a one-press
 * "I've read the plan" that needs no page at all; the plan itself travels
 * in the email as text.
 */

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

type Person = { id: string; email: string; name: string; role: string }

const melbourneToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

const shootUrl = (id: string) => `${DASHBOARD_URL}/dashboard/production/shoots/${id}`
/** the editor's card for the shoot, opened on the Editor page */
export const editorCardUrl = (batchId: string) => `${DASHBOARD_URL}/dashboard/editor?card=${shootCardId(batchId)}`

function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

async function activePeople(ids: readonly string[]): Promise<Person[]> {
  if (ids.length === 0) return []
  const rows = await table<TeamUserRow>('team_users').list({ where: u => ids.includes(u.id) && u.active_status === true })
  return rows.map(u => ({ id: u.id, email: u.email, name: u.name || u.email, role: u.role }))
}

/** The account managers on the client, the shoot's owner and creator, and Ops. */
async function managersAndOps(batch: Pick<Batch, 'client_id' | 'owner_id' | 'created_by'>): Promise<Person[]> {
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: batch.client_id } })
  const ids = new Set<string>(links.map(l => l.team_user_id))
  if (batch.owner_id) ids.add(batch.owner_id)
  if (batch.created_by) ids.add(batch.created_by)
  const rows = await table<TeamUserRow>('team_users').list({
    where: u => u.active_status === true && (
      (ids.has(u.id) && ['account_manager', 'super_admin', 'general'].includes(u.role)) || u.ops_contact === true
    ),
  })
  return rows.map(u => ({ id: u.id, email: u.email, name: u.name || u.email, role: u.role }))
}

/** The nine parts as an email block, so nobody needs the page to read the plan. */
export function planHtml(batch: Batch): string {
  return '<table style="border-collapse:collapse;margin:12px 0">' + planAsText(batch).map(p =>
    `<tr><td style="padding:4px 12px 4px 0;vertical-align:top;font-weight:600;white-space:nowrap">${escapeHtml(p.label)}</td><td style="padding:4px 0;white-space:pre-line">${escapeHtml(p.value)}</td></tr>`,
  ).join('') + '</table>'
}

/** Somebody else named this person the account manager on a new shoot. */
export async function notifyShootOwner(actor: TeamUser, batch: Batch): Promise<boolean> {
  if (!batch.owner_id || batch.owner_id === actor.id) return false
  const [owner] = await activePeople([batch.owner_id])
  if (!owner) return false
  const when = longDate(batch.shoot_date)
  const r = await notify({
    actorName: actor.name, actorEmail: actor.email,
    eventType: 'shoot_owner_named', entityType: 'batch',
    entityId: `${batch.id}#owner#${owner.id}`,
    recipientId: owner.id, recipientEmail: owner.email,
    subject: `You’re the account manager on ${batch.title}`,
    bodyHtml: renderEmail(
      `${escapeHtml(batch.title)} is yours to plan`,
      `<p>${escapeHtml(actor.name || actor.email)} made a shoot${when ? ` for <strong>${when}</strong>` : ''} and named you the account manager on it.</p>` +
      (batch.description ? `<p><strong>What it is for:</strong> ${escapeHtml(batch.description)}</p>` : '') +
      '<p>Fill in the nine parts of the plan, name the editor and the crew, and share it with the team seven days before the shoot.</p>',
      'Open the shoot plan', shootUrl(batch.id),
    ),
  })
  return r === 'sent'
}

/**
 * The plan went out: everyone on the shoot is asked to read and acknowledge
 * it. The editor's button is on their card; a crew member's is the link in
 * this email. The plan itself is in the email.
 */
export async function notifyBriefShared(actor: TeamUser, batch: Batch): Promise<number> {
  const people = await activePeople(peopleOnShoot(batch))
  const when = longDate(batch.shoot_date)
  // no secret to sign with (a bare environment): the crew still get the
  // plan, and are asked to tell the account manager they have read it
  let secret: string | null = null
  try { secret = ackSecret() } catch (e) { console.error('acknowledge link:', e instanceof Error ? e.message : e) }
  let sent = 0
  for (const p of people) {
    if (p.id === actor.id) continue
    const isEditor = p.id === batch.editor_id
    const link = isEditor ? editorCardUrl(batch.id) : secret ? ackLink(DASHBOARD_URL, batch.id, p.id, secret) : null
    const r = await notify({
      actorName: actor.name, actorEmail: actor.email,
      eventType: 'shoot_brief_shared', entityType: 'batch',
      entityId: `${batch.id}#shared#${batch.brief_shared_at ?? ''}`,
      recipientId: p.id, recipientEmail: p.email,
      subject: `Read the plan: ${batch.title}`,
      bodyHtml: renderEmail(
        `The plan for ${escapeHtml(batch.title)} is out`,
        `<p>${escapeHtml(actor.name || actor.email)} shared the shoot plan for <strong>${escapeHtml(batch.title)}</strong>` +
        (when ? `, shooting ${when}` : '') + '.</p>' +
        planHtml(batch) +
        (isEditor
          ? '<p>Read it, then press <strong>I’ve read the plan</strong> on your card. The shoot is not confirmed until everyone on it has.</p>'
          : link
            ? '<p>Read it, then press the button below — that is all. The shoot is not confirmed until everyone on it has.</p>'
            : `<p>Read it, then tell ${escapeHtml(actor.name || actor.email)} you have. The shoot is not confirmed until everyone on it has.</p>`),
        link ? (isEditor ? 'Open your card' : 'I’ve read the plan') : undefined,
        link ?? undefined,
      ),
    })
    if (r === 'sent') sent++
  }
  return sent
}

/** The footage is with the editor: the cards are theirs, due on the deadline. */
export async function notifyFootageHanded(actor: TeamUser, batch: Batch, plan: Pick<HandoverPlan, 'total'>): Promise<boolean> {
  if (!batch.editor_id) return false
  const [editor] = await activePeople([batch.editor_id])
  if (!editor) return false
  const due = longDate(batch.edit_deadline)
  const n = plan.total
  const r = await notify({
    actorName: actor.name, actorEmail: actor.email,
    eventType: 'shoot_footage_in', entityType: 'batch',
    entityId: `${batch.id}#footage#${batch.footage_handed_at ?? ''}`,
    recipientId: editor.id, recipientEmail: editor.email,
    subject: `Footage is in: ${batch.title} — ${n} card${n === 1 ? '' : 's'} yours${due ? `, due ${due}` : ''}`,
    bodyHtml: renderEmail(
      `Footage is in — ${n} card${n === 1 ? ' is' : 's are'} yours`,
      `<p>${escapeHtml(actor.name || actor.email)} handed over the footage from <strong>${escapeHtml(batch.title)}</strong>.</p>` +
      `<p><strong>${n} card${n === 1 ? '' : 's'}</strong> on the Editor page ${n === 1 ? 'is' : 'are'} now yours` +
      (due ? `, due <strong>${due}</strong>` : '') + '.</p>' +
      (batch.editor_priorities ? `<p><strong>Priorities:</strong> ${escapeHtml(batch.editor_priorities)}</p>` : ''),
      'Open your card', editorCardUrl(batch.id),
    ),
  })
  return r === 'sent'
}

/**
 * The day-before reminder (§3.3, "Operations"): everyone on the shoot and
 * the account manager get the call time, the location and their day back
 * in one message. Pressing it twice sends nothing twice.
 */
export async function notifyShootReminder(actor: TeamUser, batch: Batch): Promise<number> {
  const ids = [...peopleOnShoot(batch), ...(batch.owner_id ? [batch.owner_id] : [])]
  const people = await activePeople([...new Set(ids)])
  const when = longDate(batch.shoot_date)
  let sent = 0
  for (const p of people) {
    if (p.id === actor.id) continue
    const isEditor = p.id === batch.editor_id
    const manages = p.id === batch.owner_id
    const r = await notify({
      actorName: actor.name, actorEmail: actor.email,
      eventType: 'shoot_reminder', entityType: 'batch',
      entityId: `${batch.id}#reminder#${batch.reminder_sent_at ?? ''}`,
      recipientId: p.id, recipientEmail: p.email,
      subject: `Shoot reminder: ${batch.title}${when ? ` — ${when}` : ''}`,
      bodyHtml: renderEmail(
        `${escapeHtml(batch.title)}${when ? ` — ${when}` : ''}`,
        `<p><strong>Call time:</strong> ${escapeHtml(batch.call_time ?? 'see the plan')}<br/>` +
        `<strong>Location:</strong> ${escapeHtml(batch.location ?? 'see the plan')}</p>` +
        (batch.talent ? `<p><strong>On camera:</strong> ${escapeHtml(batch.talent)}</p>` : '') +
        (batch.props_wardrobe ? `<p><strong>Props and wardrobe:</strong> ${escapeHtml(batch.props_wardrobe)}</p>` : '') +
        '<p>Everyone knows their role; the plan is the plan — no improvising on set.</p>' +
        planHtml(batch),
        manages ? 'Open the shoot plan' : isEditor ? 'Open your card' : undefined,
        manages ? shootUrl(batch.id) : isEditor ? editorCardUrl(batch.id) : undefined,
      ),
    })
    if (r === 'sent') sent++
  }
  return sent
}

/**
 * "Share the plan with the client": the plan is on their portal, and they
 * are emailed a link to it with the plan in the message. Keyed on the share
 * stamp, so sharing again after changes tells them again — once.
 */
export async function notifyPlanSharedWithClient(actor: TeamUser, batch: Batch, client: Pick<Client, 'id' | 'name' | 'email' | 'share_token'>): Promise<boolean> {
  const to = String(client.email ?? '').trim()
  if (!to) return false
  const when = longDate(batch.shoot_date)
  const portal = client.share_token ? `${DASHBOARD_URL}/portal/${client.share_token}` : null
  const r = await notify({
    actorName: actor.name, actorEmail: actor.email,
    eventType: 'shoot_plan_to_client', entityType: 'batch',
    entityId: `${batch.id}#client#${batch.client_shared_at ?? ''}`,
    recipientEmail: to, toClient: true,
    subject: `Your shoot plan: ${batch.title}${when ? ` — ${when}` : ''}`,
    bodyHtml: renderEmail(
      `The plan for ${escapeHtml(batch.title)}`,
      `<p>Hi ${escapeHtml(client.name)},</p>` +
      `<p>${escapeHtml(actor.name || actor.email)} has put together the plan for your shoot${when ? ` on <strong>${when}</strong>` : ''}. It is below and on your portal, where you can approve it or ask for a change.</p>` +
      planHtml(batch),
      portal ? 'Open your portal' : undefined, portal ?? undefined,
    ),
  })
  return r === 'sent'
}

/** The client answered on the portal: the managers on the shoot are told. */
export async function notifyClientPlanDecision(batch: Batch, decision: ClientDecision, note: string | null, clientName: string): Promise<number> {
  const people = await managersAndOps(batch)
  let sent = 0
  const said = decision === 'approved' ? 'approved the plan' : 'asked for changes to the plan'
  for (const p of people) {
    if (p.role === 'general' && p.id !== batch.owner_id && p.id !== batch.created_by) continue
    const r = await notify({
      actorName: clientName, actorEmail: 'portal+client@mdmmarketing.com.au',
      eventType: 'shoot_plan_client_answer', entityType: 'batch',
      entityId: `${batch.id}#answer#${batch.client_decided_at ?? ''}`,
      recipientId: p.id, recipientEmail: p.email,
      subject: `${clientName} ${said}: ${batch.title}`,
      bodyHtml: renderEmail(
        `${escapeHtml(clientName)} ${said}`,
        `<p><strong>${escapeHtml(batch.title)}</strong> — ${escapeHtml(clientName)} ${said} on their portal.</p>` +
        (note ? `<p><strong>Their note:</strong> ${escapeHtml(note)}</p>` : '') +
        (decision === 'approved' ? '<p>Nothing to send back. Carry on with the shoot.</p>' : '<p>Change the plan, then press “Share the plan with the client” again.</p>'),
        'Open the shoot plan', shootUrl(batch.id),
      ),
    })
    if (r === 'sent') sent++
  }
  return sent
}

/**
 * The 7-day rule, checked every morning: a shoot inside seven days whose
 * brief is still being written is late. The AM and Ops are told once per
 * shoot — the stamp is claimed before the mail goes, so two runs or a
 * retry cannot tell them twice.
 */
export async function runBriefLateNudge(): Promise<{ late: number; told: number }> {
  const today = melbourneToday()
  const candidates = await table<Batch>('batches').list({
    where: r => !!r.shoot_date && r.status !== 'wrapped' && (!r.late_nudged_at || !r.late_share_nudged_at),
    limit: 500,
  })
  const late = lateNudgeTargets(candidates.filter(r => !r.late_nudged_at), today)
  let told = 0
  // A PLAN SHARED LATE is late too (11 Sep 2026): shared with three days to
  // go is not the 7-day rule kept. Told once per shoot, on its own stamp.
  const sharedLateOnes = lateShareNudgeTargets(candidates)
  for (const b of sharedLateOnes) {
    const stamped = await table<Batch>('batches').claim(b.id, cur =>
      cur && !cur.late_share_nudged_at ? { ...cur, late_share_nudged_at: new Date().toISOString() } : null)
    if (!stamped.claimed) continue
    const lead = shareLeadDays(b) ?? 0
    const people = await managersAndOps(b)
    for (const p of people) {
      const r = await notify({
        eventType: 'shoot_brief_late', entityType: 'batch',
        entityId: `${b.id}#shared-late`,
        recipientId: p.id, recipientEmail: p.email,
        subject: `⚠️ Plan shared late: ${b.title}`,
        bodyHtml: renderEmail(
          `${escapeHtml(b.title)} — the plan was shared late`,
          `<p>The plan went to the team <strong>${lead} day${lead === 1 ? '' : 's'}</strong> before the shoot. The playbook needs 7.</p>` +
          '<p>An account manager cannot confirm it as go now. A super admin can go ahead with a reason, or the shoot date moves.</p>',
          'Open the shoot plan', shootUrl(b.id),
        ),
      })
      if (r === 'sent') told++
    }
  }
  for (const b of late) {
    const stamped = await table<Batch>('batches').claim(b.id, cur =>
      cur && !cur.late_nudged_at ? { ...cur, late_nudged_at: new Date().toISOString() } : null)
    if (!stamped.claimed) continue
    const days = daysUntilShoot(b, today) ?? 0
    const people = await managersAndOps(b)
    for (const p of people) {
      const r = await notify({
        eventType: 'shoot_brief_late', entityType: 'batch',
        entityId: `${b.id}#late`,
        recipientId: p.id, recipientEmail: p.email,
        subject: `⚠️ ${LATE_WORDS}: ${b.title}`,
        bodyHtml: renderEmail(
          `${escapeHtml(b.title)} — the plan is late`,
          `<p>The shoot is ${days <= 0 ? 'today or gone' : `in ${days} day${days === 1 ? '' : 's'}`} and the plan is still being written.</p>` +
          '<p>The playbook: the plan is locked and shared at least 7 days before the shoot. No plan, no shoot.</p>' +
          '<p>Finish the nine parts and share it with the team, or move the shoot date.</p>',
          'Open the shoot plan', shootUrl(b.id),
        ),
      })
      if (r === 'sent') told++
    }
  }
  return { late: late.length + sharedLateOnes.length, told }
}

/**
 * A super admin went ahead with a plan shared late. Ops (and the client's
 * managers) are told once, with the reason — the record the playbook asks
 * for when a rule is bent ("if it isn't in writing, it doesn't exist").
 */
export async function notifyGoOverride(actor: TeamUser, batch: Batch): Promise<number> {
  const reason = String(batch.go_override_reason ?? '').trim()
  if (!reason) return 0
  const people = await managersAndOps(batch)
  const lead = shareLeadDays(batch) ?? 0
  let sent = 0
  for (const p of people) {
    if (p.id === actor.id) continue
    const r = await notify({
      actorName: actor.name, actorEmail: actor.email,
      eventType: 'shoot_go_override', entityType: 'batch',
      entityId: `${batch.id}#override`,
      recipientId: p.id, recipientEmail: p.email,
      subject: `Went ahead late: ${batch.title}`,
      bodyHtml: renderEmail(
        `${escapeHtml(batch.title)} — confirmed as go, late`,
        `<p>${escapeHtml(actor.name || actor.email)} confirmed the shoot with the plan shared <strong>${lead} day${lead === 1 ? '' : 's'}</strong> before it (the playbook needs 7).</p>` +
        `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>`,
        'Open the shoot plan', shootUrl(batch.id),
      ),
    })
    if (r === 'sent') sent++
  }
  return sent
}

/** how many on the shoot have acknowledged, by name — for the log line */
export function ackSummary(batch: Batch, names: Map<string, string>): string {
  const acked = new Set(acksOf(batch).map(a => a.user_id))
  return peopleOnShoot(batch).map(id => `${names.get(id) ?? 'Someone'}${acked.has(id) ? ' ✓' : ''}`).join(', ')
}
