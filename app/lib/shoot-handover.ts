import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, ContentItem, TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { ensureShootCard } from './plan-cards'
import { logActivity } from './workflow'
import { announceBatchChange, announceItemChange } from './production-live'
import { escapeHtml, notify, renderEmail } from './mailer'
import { footageDueTargets, footageFolderFill, handoverPlan, handoverReady, type HandoverPlan } from './shoot-sop-core'

/**
 * PRODUCTION → EDITOR, WITHOUT A PRESS.
 *
 * The owner, 11 Sep 2026: "from a shoot… it doesn't auto update?" So the
 * handover is no longer a drag. Go makes the cards and gives them to the
 * editor at once (they see their work from the day the shoot is confirmed,
 * marked "footage after the shoot"); naming the editor after go does the
 * same; and the morning after the shoot the footage is handed over by
 * itself and the editor told to start. "Footage is in" on the shoot page
 * stays for saying it early — it uses the same handover, and the same
 * dedupe key, so nobody is told twice.
 *
 * Every write is a claim: a card's empty owner, due date and brief are
 * filled once and never overwritten; a card somebody assigned meanwhile
 * keeps their choice.
 */

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const shootUrl = (id: string) => `${DASHBOARD_URL}/dashboard/production/shoots/${id}`

const melbourneToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

type Actor = Pick<TeamUser, 'id' | 'name' | 'email'> & Partial<TeamUser>

/** The app itself, when the nightly sweep acts: no team row, so the log
 *  carries no actor and the mail comes from the dashboard's own address. */
const SWEEP: Actor = { id: '', name: 'The dashboard', email: 'hello@mdmmarketing.com.au' }

/**
 * Give the shoot's card to the editor. The shoot's one card is claimed by
 * its fixed id (a shoot that already has a deliverable card stands down),
 * then every card on the shoot has its EMPTY owner, due date and brief
 * filled from the shoot — never overwritten.
 */
export async function handOverCards(actor: Actor | null, batch: Batch, detail = 'from the shoot'): Promise<{ total: number }> {
  try {
    await ensureShootCard((actor ?? SWEEP) as TeamUser, batch)
  } catch (e) {
    console.error('handover: plan cards', e)
  }
  const items = table<ContentItem>('content_items')
  const rows = await attachOne(
    await items.list({ by: { batch_id: batch.id }, limit: 200 }),
    'work_kind_id', 'work_kinds', ['slug'],
  )
  const plan = handoverPlan(batch, rows as unknown as Parameters<typeof handoverPlan>[1])
  for (const f of plan.fill) {
    const done = await items.claim(f.id, cur => {
      if (!cur) return null
      const next: Partial<ContentItem> = {}
      if (f.patch.owner_id && !cur.owner_id) { next.owner_id = f.patch.owner_id; next.assigned_by = actor?.id || null }
      if (f.patch.due_date && !cur.due_date) next.due_date = f.patch.due_date
      if (f.patch.brief && !String(cur.brief ?? '').trim()) next.brief = f.patch.brief
      return Object.keys(next).length > 0 ? { ...cur, ...next, updated_at: new Date().toISOString() } : null
    })
    if (done.claimed) {
      await logActivity({
        actor: actor?.id ? (actor as TeamUser) : null, clientId: batch.client_id,
        entityType: 'content_item', entityId: f.id,
        action: 'handed_from_shoot', detail: `${detail} ${batch.title}`,
        ...(f.patch.owner_id ? { newValue: f.patch.owner_id } : {}),
      })
      announceItemChange({ item_id: f.id, client_id: batch.client_id, status: done.row.status, kind: 'updated' })
    }
  }
  return { total: plan.total }
}

/**
 * The footage folder onto every card from the shoot that has none — "Files
 * to work from" for the editor. Each write is a claim that re-checks the
 * card still has no folder, so a folder somebody chose meanwhile stays.
 */
export async function fillFootageFolder(batch: Batch): Promise<number> {
  const items = table<ContentItem>('content_items')
  const rows = await attachOne(
    await items.list({ by: { batch_id: batch.id }, limit: 200 }),
    'work_kind_id', 'work_kinds', ['slug'],
  )
  let filled = 0
  for (const f of footageFolderFill(batch, rows as unknown as Parameters<typeof footageFolderFill>[1])) {
    const done = await items.claim(f.id, cur =>
      cur && !String(cur.raw_assets_url ?? '').trim()
        ? { ...cur, raw_assets_url: f.raw_assets_url, updated_at: new Date().toISOString() }
        : null)
    if (done.claimed) {
      filled++
      announceItemChange({ item_id: f.id, client_id: batch.client_id, status: done.row.status, kind: 'updated' })
    }
  }
  return filled
}

async function editorOf(batch: Pick<Batch, 'editor_id'>): Promise<{ id: string; email: string; name: string } | null> {
  if (!batch.editor_id) return null
  const [u] = await table<TeamUserRow>('team_users').list({ where: r => r.id === batch.editor_id && r.active_status === true, limit: 1 })
  return u ? { id: u.id, email: u.email, name: u.name || u.email } : null
}

/**
 * Go (or naming the editor after go): the editor is told their cards exist,
 * that the shoot is on such a day and the footage follows it. Keyed on the
 * shoot and the editor, so naming the same editor twice tells them once.
 */
export async function notifyEditorAtGo(actor: Actor, batch: Batch, plan: Pick<HandoverPlan, 'total'>): Promise<boolean> {
  const editor = await editorOf(batch)
  if (!editor || plan.total === 0) return false
  const when = longDate(batch.shoot_date)
  const due = longDate(batch.edit_deadline)
  const n = plan.total
  const r = await notify({
    actorName: actor.name, actorEmail: actor.email,
    eventType: 'shoot_editor_on', entityType: 'batch',
    entityId: `${batch.id}#editor#${editor.id}`,
    recipientId: editor.id, recipientEmail: editor.email,
    subject: `You’re on ${batch.title} — ${n === 1 ? 'your card is ready' : `${n} cards`}${when ? `, shoot on ${when}` : ''}${due ? `, due ${due}` : ''}`,
    bodyHtml: renderEmail(
      `You’re on ${escapeHtml(batch.title)}`,
      `<p>${escapeHtml(actor.name || actor.email)} confirmed the shoot${when ? ` for <strong>${when}</strong>` : ''}.</p>` +
      `<p>${n === 1 ? '<strong>Your card</strong> for this shoot is' : `<strong>${n} cards</strong> on the Editor page are`} on the Editor page — the footage follows the shoot` +
      (due ? `, and the edits are due <strong>${due}</strong>` : '') + '.</p>' +
      (batch.editor_priorities ? `<p><strong>Priorities:</strong> ${escapeHtml(batch.editor_priorities)}</p>` : '') +
      '<p>Read the plan now and press <strong>I’ve read the plan</strong>; you will be told the morning the footage is in.</p>',
      'Open the shoot plan', shootUrl(batch.id),
    ),
  })
  return r === 'sent'
}

/**
 * The footage is with the editor — said by a person on the shoot page or by
 * the sweep the morning after. One key per shoot, so the two can never
 * both tell the editor.
 */
export async function notifyFootageIn(actor: Actor, batch: Batch, plan: Pick<HandoverPlan, 'total'>, bySweep: boolean): Promise<boolean> {
  const editor = await editorOf(batch)
  if (!editor) return false
  const due = longDate(batch.edit_deadline)
  const n = plan.total
  const r = await notify({
    actorName: actor.name, actorEmail: actor.email,
    eventType: 'shoot_footage_in', entityType: 'batch',
    entityId: `${batch.id}#footage`,
    recipientId: editor.id, recipientEmail: editor.email,
    subject: bySweep
      ? `Footage should be in: ${batch.title} — start the edit${due ? `, due ${due}` : ''}`
      : `Footage is in: ${batch.title} — ${n === 1 ? 'your card is ready' : `${n} cards yours`}${due ? `, due ${due}` : ''}`,
    bodyHtml: renderEmail(
      bySweep ? `${escapeHtml(batch.title)} was shot — the footage should be in` : `Footage is in — ${n === 1 ? 'your card is ready' : `${n} cards are yours`}`,
      (bySweep
        ? `<p>The shoot was ${longDate(batch.shoot_date) ?? 'yesterday'}. The footage should be with you now — if it is not, ask the account manager.</p>`
        : `<p>${escapeHtml(actor.name || actor.email)} handed over the footage from <strong>${escapeHtml(batch.title)}</strong>.</p>`) +
      `<p>${n === 1 ? '<strong>Your card</strong> for this shoot is on the Editor page' : `<strong>${n} cards</strong> on the Editor page are yours`}` +
      (due ? `, due <strong>${due}</strong>` : '') + '.</p>' +
      (batch.footage_url ? `<p><strong>Footage folder:</strong> <a href="${escapeHtml(batch.footage_url)}">${escapeHtml(batch.footage_url)}</a></p>` : '') +
      (batch.editor_priorities ? `<p><strong>Priorities:</strong> ${escapeHtml(batch.editor_priorities)}</p>` : ''),
      'Open the shoot', shootUrl(batch.id),
    ),
  })
  return r === 'sent'
}

/** The AM is asked, once, to name an editor for a shoot that was shot with none. */
async function notifyNameTheEditor(batch: Batch): Promise<number> {
  const ids = new Set<string>()
  if (batch.owner_id) ids.add(batch.owner_id)
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: batch.client_id } })
  for (const l of links) ids.add(l.team_user_id)
  const people = await table<TeamUserRow>('team_users').list({
    where: u => u.active_status === true && ids.has(u.id) && ['account_manager', 'super_admin'].includes(u.role),
  })
  let sent = 0
  for (const p of people) {
    const r = await notify({
      eventType: 'shoot_footage_in', entityType: 'batch',
      entityId: `${batch.id}#no-editor`,
      recipientId: p.id, recipientEmail: p.email,
      subject: `Name the editor: ${batch.title} was shot and nobody has the footage`,
      bodyHtml: renderEmail(
        `${escapeHtml(batch.title)} — who edits it?`,
        `<p>The shoot was ${longDate(batch.shoot_date) ?? 'yesterday'} and no editor is named on it, so the footage has nobody to go to.</p>` +
        '<p>Open the shoot and pick the editor under “Who is on this shoot”. The card is handed to them the moment you do.</p>',
        'Open the shoot plan', shootUrl(batch.id),
      ),
    })
    if (r === 'sent') sent++
  }
  return sent
}

/**
 * The morning after a shoot: hand the footage over by itself. The stamp is
 * claimed first, so two runs cannot hand over or tell twice; a shoot that a
 * person already handed over (footage_handed_at) is skipped by the rule.
 */
export async function runFootageDueSweep(): Promise<{ handed: number; askedForEditor: number }> {
  const today = melbourneToday()
  const candidates = await table<Batch>('batches').list({
    where: r => !!r.shoot_date && !r.footage_handed_at && !r.footage_due_nudged_at && r.status !== 'wrapped',
    limit: 500,
  })
  const { hand, askEditor } = footageDueTargets(candidates, today)
  let handed = 0
  let askedForEditor = 0
  const now = new Date().toISOString()
  for (const b of hand) {
    const stamped = await table<Batch>('batches').claim(b.id, cur =>
      cur && !cur.footage_due_nudged_at && !cur.footage_handed_at
        ? { ...cur, footage_due_nudged_at: now, footage_handed_at: now, footage_handed_by: null }
        : null)
    if (!stamped.claimed) continue
    const updated = stamped.row
    await logActivity({
      actor: null, clientId: updated.client_id,
      entityType: 'batch', entityId: updated.id,
      action: 'sop_stage', oldValue: 'shoot_day', newValue: 'footage_handed', detail: 'Footage handed to the editor — the morning after the shoot',
    })
    const plan = await handOverCards(null, updated, 'footage from')
    await fillFootageFolder(updated).catch(e => console.error('footage folder fill:', e))
    await notifyFootageIn(SWEEP, updated, plan, true).catch(e => console.error('footage due notify:', e))
    announceBatchChange({ batch_id: updated.id, client_id: updated.client_id, status: updated.status ?? 'brief', kind: 'updated' })
    handed++
  }
  for (const b of askEditor) {
    const stamped = await table<Batch>('batches').claim(b.id, cur =>
      cur && !cur.footage_due_nudged_at ? { ...cur, footage_due_nudged_at: now } : null)
    if (!stamped.claimed) continue
    askedForEditor += await notifyNameTheEditor(stamped.row)
  }
  return { handed, askedForEditor }
}

/** the cards are the editor's from go — used by the go path and by naming the editor later */
export async function handOverAtGo(actor: TeamUser, batch: Batch): Promise<{ total: number }> {
  const plan = await handOverCards(actor, batch, 'from the shoot')
  if (handoverReady(batch)) {
    await notifyEditorAtGo(actor, batch, plan).catch(e => console.error('editor at go notify:', e))
  }
  return plan
}
