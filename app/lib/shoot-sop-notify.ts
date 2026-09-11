import 'server-only'
import { table } from '@/lib/db'
import type { Batch, TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { escapeHtml, notify, renderEmail } from './mailer'
import {
  LATE_WORDS, acksOf, daysUntilShoot, lateNudgeTargets, peopleOnShoot, type HandoverPlan,
} from './shoot-sop-core'

/**
 * WHO IS TOLD WHAT, ALONG THE SHOOT BRIEF SOP — the server half.
 *
 * Three moments the playbook names: the brief goes out to the team (every
 * person on it reads and acknowledges), the footage lands with the editor
 * (with priorities, a deadline and the cards that are now theirs), and a
 * brief that is still being written inside the 7-day line (the AM and Ops
 * are told, once). Every send goes through `notify`, whose dedupe key means
 * a retry or a second press can never mail twice.
 */

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

type Person = { id: string; email: string; name: string }

const melbourneToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

const shootUrl = (id: string) => `${DASHBOARD_URL}/dashboard/production/shoots/${id}`

function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

async function activePeople(ids: readonly string[]): Promise<Person[]> {
  if (ids.length === 0) return []
  const rows = await table<TeamUserRow>('team_users').list({ where: u => ids.includes(u.id) && u.active_status === true })
  return rows.map(u => ({ id: u.id, email: u.email, name: u.name || u.email }))
}

/** The account managers on the client, the shoot's owner, and Ops. */
async function managersAndOps(batch: Pick<Batch, 'client_id' | 'owner_id'>): Promise<Person[]> {
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: batch.client_id } })
  const ids = new Set<string>(links.map(l => l.team_user_id))
  if (batch.owner_id) ids.add(batch.owner_id)
  const rows = await table<TeamUserRow>('team_users').list({
    where: u => u.active_status === true && (
      (ids.has(u.id) && ['account_manager', 'super_admin'].includes(u.role)) || u.ops_contact === true
    ),
  })
  return rows.map(u => ({ id: u.id, email: u.email, name: u.name || u.email }))
}

/** The brief went out: everyone on the shoot is asked to read and acknowledge it. */
export async function notifyBriefShared(actor: TeamUser, batch: Batch): Promise<number> {
  const people = await activePeople(peopleOnShoot(batch))
  const when = longDate(batch.shoot_date)
  let sent = 0
  for (const p of people) {
    if (p.id === actor.id) continue
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
        '<p>Read it, then press <strong>I’ve read the plan</strong> on the shoot page. The shoot is not confirmed until everyone on it has.</p>',
        'Open the shoot plan', shootUrl(batch.id),
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
      (batch.editor_priorities ? `<p><strong>Priorities:</strong> ${escapeHtml(batch.editor_priorities)}</p>` : '') +
      '<p>Open the shoot and press <strong>I’ve read the plan</strong> to confirm you have the priorities and the deadline.</p>',
      'Open the shoot', shootUrl(batch.id),
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
        '<p>Everyone knows their role; the plan is the plan — no improvising on set.</p>',
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
    where: r => !!r.shoot_date && r.status !== 'wrapped' && !r.late_nudged_at,
    limit: 500,
  })
  const late = lateNudgeTargets(candidates, today)
  let told = 0
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
  return { late: late.length, told }
}

/** how many on the shoot have acknowledged, by name — for the log line */
export function ackSummary(batch: Batch, names: Map<string, string>): string {
  const acked = new Set(acksOf(batch).map(a => a.user_id))
  return peopleOnShoot(batch).map(id => `${names.get(id) ?? 'Someone'}${acked.has(id) ? ' ✓' : ''}`).join(', ')
}
