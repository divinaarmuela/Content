import 'server-only'
import { table } from '@/lib/db'
import type { Batch, ContentItem, TeamUser, TeamUserClient, WorkflowActivity } from '@/lib/db-types'
import { notify, renderEmail, escapeHtml } from './mailer'
import { itemPath } from './workflow-core'
import {
  ackNudgeDue, assignedAtOf, blockerNeed, blockerNudgeDue, type BlockerNeed,
} from './editor-sop-core'
import { todayKey } from './work-calendar-core'

/**
 * THE VIDEO EDITORS SOP, THE PARTS THAT SEND EMAIL — §6 and §7.
 *
 * §7 names people: Martin, the account manager, Divina, Yusuf, Abby. None of
 * those names live here. "Martin" is whoever wears the editors' lead flag
 * (`team_users.editors_lead`), Abby is the Ops contact, leadership is the
 * super admins, the videographer is the shoot's crew. When nobody wears a
 * flag the client's account managers stand in, so a blocked editor is never
 * shouting into an empty room.
 */

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

type Person = { id: string; email: string; name: string }
type TeamRow = TeamUser & { editors_lead?: boolean | null; ops_contact?: boolean | null }

const person = (u: TeamRow): Person => ({ id: u.id, email: u.email, name: u.name || u.email })

async function activeTeam(): Promise<TeamRow[]> {
  return table<TeamRow>('team_users').list({ where: u => u.active_status === true && u.role !== 'client' })
}

async function clientManagerIds(clientId: string): Promise<Set<string>> {
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } })
  return new Set(links.map(l => l.team_user_id))
}

/** The SOP's table turned into people, for one card and one need. */
export async function peopleForNeed(item: Pick<ContentItem, 'client_id' | 'batch_id' | 'owner_id'>, need: BlockerNeed): Promise<Person[]> {
  const row = blockerNeed(need)
  if (!row) return []
  const [team, managerIds, shoot] = await Promise.all([
    activeTeam(),
    clientManagerIds(item.client_id),
    item.batch_id ? table<Batch>('batches').get(item.batch_id) : Promise.resolve(null),
  ])
  const out = new Map<string, Person>()
  const add = (u: TeamRow | undefined) => { if (u && u.id !== item.owner_id) out.set(u.id, person(u)) }
  const leads = team.filter(u => u.editors_lead === true)
  const managers = team.filter(u => managerIds.has(u.id) && ['account_manager', 'super_admin'].includes(u.role))
  for (const ask of row.ask) {
    if (ask === 'crew') {
      const crew = new Set<string>([
        ...(Array.isArray(shoot?.crew_ids) ? (shoot!.crew_ids as unknown[]).map(String) : []),
        ...(shoot?.owner_id ? [String(shoot.owner_id)] : []),
      ])
      team.filter(u => crew.has(u.id)).forEach(add)
    }
    if (ask === 'lead') leads.forEach(add)
    if (ask === 'account_manager') managers.forEach(add)
    if (ask === 'leadership') team.filter(u => u.role === 'super_admin').forEach(add)
    if (ask === 'ops') team.filter(u => u.ops_contact === true).forEach(add)
  }
  // nobody wears the flag: the client's managers stand in, never silence
  if (out.size === 0) managers.forEach(add)
  return [...out.values()]
}

async function opsAndLeadership(): Promise<{ ops: Person[]; leadership: Person[] }> {
  const team = await activeTeam()
  return {
    ops: team.filter(u => u.ops_contact === true).map(person),
    leadership: team.filter(u => u.role === 'super_admin' || u.ops_contact === true || u.editors_lead === true).map(person),
  }
}

const cardUrl = (item: Pick<ContentItem, 'id'> & { adhoc_post?: unknown }) => `${DASHBOARD_URL}${itemPath(item)}`

/** "I'm blocked" pressed: the right people are told at once. */
export async function notifyBlocked(
  actor: { name: string; email: string; clerk_user_id?: string | null }, item: ContentItem, need: BlockerNeed, note: string,
): Promise<{ told: Person[] }> {
  const people = await peopleForNeed(item, need)
  const row = blockerNeed(need)!
  const subject = `Blocked: ${item.title} — ${row.label.toLowerCase()}`
  await Promise.all(people.map(p => notify({
    actorName: actor.name, actorEmail: actor.email, actorClerkId: actor.clerk_user_id,
    eventType: 'editor_blocked', entityType: 'content_item',
    entityId: `${item.id}#blocked#${p.id}#${Date.now()}`,
    recipientId: p.id, recipientEmail: p.email,
    subject,
    bodyHtml: renderEmail(
      subject,
      `<p><strong>${escapeHtml(actor.name || actor.email)}</strong> is blocked on <strong>${escapeHtml(item.title)}</strong> and needs <strong>${escapeHtml(row.label.toLowerCase())}</strong>.</p>`
      + `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(note)}</blockquote>`
      + '<p>The playbook: nothing stays blocked for more than 24 hours. Ops is copied at 12 hours, leadership at 24.</p>',
      'Open the card', cardUrl(item),
    ),
  })))
  return { told: people }
}

/**
 * The hourly sweep: the 12-hour follow-up with Ops copied, the 24-hour flag
 * to leadership, and the morning-after acknowledge nudge. Each fires once,
 * on its own stamp, claimed before the email goes.
 */
export async function runEditorSopNudges(now: Date = new Date()): Promise<{ twelve: number; twentyFour: number; ack: number }> {
  const nowMs = now.getTime()
  const out = { twelve: 0, twentyFour: 0, ack: 0 }
  const blocked = await table<ContentItem>('content_items').list({
    where: r => !!(r as { blocked_at?: unknown }).blocked_at && !['published', 'scheduled'].includes(String(r.status)),
    limit: 500,
  })
  const who = await opsAndLeadership()
  for (const item of blocked) {
    const due = blockerNudgeDue(item as never, nowMs)
    if (!due) continue
    const stamp = due === '12' ? 'blocked_nudged_12_at' : 'blocked_nudged_24_at'
    const claimed = await table<ContentItem>('content_items').claim(item.id, cur =>
      cur && !(cur as unknown as Record<string, unknown>)[stamp] && (cur as unknown as Record<string, unknown>).blocked_at ? { ...cur, [stamp]: now.toISOString() } : null)
    if (!claimed.claimed) continue
    const row = blockerNeed((item as { blocked_need?: string }).blocked_need)
    const asked = (item as { blocked_from_id?: string | null }).blocked_from_id ?? null
    const team = await activeTeam()
    const askedPerson = team.find(u => u.id === asked)
    const holder = team.find(u => u.id === item.owner_id)
    const since = (item as { blocked_at?: string }).blocked_at ?? ''
    const note = (item as { blocked_note?: string | null }).blocked_note ?? ''
    const recipients = due === '12'
      ? [...(askedPerson ? [person(askedPerson)] : []), ...who.ops]
      : who.leadership
    const subject = due === '12'
      ? `Still blocked after 12 hours: ${item.title}`
      : `Blocked for 24 hours: ${item.title}`
    const body = `<p><strong>${escapeHtml(item.title)}</strong> has been blocked since ${escapeHtml(since.slice(0, 16).replace('T', ' '))}.</p>`
      + `<p><strong>What is blocked:</strong> ${escapeHtml(row?.label ?? 'not said')}<br>`
      + `<strong>Who was asked:</strong> ${escapeHtml(askedPerson?.name || askedPerson?.email || row?.who || 'nobody named')}<br>`
      + `<strong>Who is waiting:</strong> ${escapeHtml(holder?.name || holder?.email || 'the editor')}<br>`
      + `<strong>What is needed:</strong> ${escapeHtml(note || 'not said')}</p>`
      + (due === '12'
        ? '<p>This is the 12-hour follow-up, with Ops copied, as the playbook asks.</p>'
        : '<p>The playbook: nothing stays blocked for more than 24 hours. This is the 24-hour flag to leadership.</p>')
    for (const p of [...new Map(recipients.map(r => [r.id, r])).values()]) {
      await notify({
        eventType: due === '12' ? 'editor_blocked_12h' : 'editor_blocked_24h', entityType: 'content_item',
        entityId: `${item.id}#blocked-${due}#${p.id}`,
        recipientId: p.id, recipientEmail: p.email, subject,
        bodyHtml: renderEmail(subject, body, 'Open the card', cardUrl(item)),
      })
    }
    if (due === '12') out.twelve++
    else out.twentyFour++
  }

  // §6: acknowledge the same day — the morning after, one nudge
  const today = todayKey()
  const unacked = await table<ContentItem>('content_items').list({
    where: r => !!r.owner_id && r.status === 'draft_uploaded' && !(r as { ack_nudged_at?: unknown }).ack_nudged_at,
    limit: 500,
  })
  if (unacked.length > 0) {
    const ids = new Set(unacked.map(i => i.id))
    const rows = await table<WorkflowActivity>('workflow_activity').list({
      where: a => a.entity_type === 'content_item' && ids.has(String(a.entity_id ?? '')),
      limit: 5000,
    })
    const team = await activeTeam()
    for (const item of unacked) {
      const mine = rows.filter(a => String(a.entity_id) === item.id)
      const acknowledged = mine.some(a => a.action === 'acknowledged' && a.actor_id === item.owner_id)
      const assignedAt = assignedAtOf(item, mine)
      if (!ackNudgeDue({ assignedAt, acknowledged, ack_nudged_at: (item as { ack_nudged_at?: string | null }).ack_nudged_at, todayKey: today })) continue
      const claimed = await table<ContentItem>('content_items').claim(item.id, cur =>
        cur && !(cur as { ack_nudged_at?: unknown }).ack_nudged_at ? { ...cur, ack_nudged_at: now.toISOString() } : null)
      if (!claimed.claimed) continue
      const editor = team.find(u => u.id === item.owner_id)
      if (!editor) continue
      const subject = `Please acknowledge: ${item.title}`
      await notify({
        eventType: 'editor_ack_nudge', entityType: 'content_item', entityId: `${item.id}#ack-nudge`,
        recipientId: editor.id, recipientEmail: editor.email, subject,
        bodyHtml: renderEmail(subject,
          `<p><strong>${escapeHtml(item.title)}</strong> was assigned to you and has not been acknowledged. The playbook asks for the same day: open the card and press Acknowledge so the team knows you are on it.</p>`,
          'Open the card', cardUrl(item)),
      })
      out.ack++
    }
  }
  return out
}
