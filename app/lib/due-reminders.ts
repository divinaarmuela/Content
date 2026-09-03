import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { ContentItem, TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import { notify, renderEmail } from './mailer'
import { STATUS_LABELS, type ItemStatus } from './workflow-core'
import { itemStatusLabel } from './brief-task-core'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

type DueItem = {
  id: string
  title: string
  status: string
  due_date: string
  client_id: string
  owner_id: string | null
  clients: { name: string } | null
  work_kinds: { slug: string } | null
}
type Person = { id: string; email: string; name: string }

const melbourneToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

function label(due: string, today: string): string {
  if (due < today) return 'OVERDUE'
  if (due === today) return 'due today'
  return 'due tomorrow'
}

/**
 * One pass over everything with a due date that is tomorrow or earlier and
 * still unfinished. Called by the weekday-morning cron; the notify() dedupe
 * key carries today's date, so re-runs and retries cannot double-send and an
 * overdue item nags exactly once per day.
 */
export async function runDueReminders(): Promise<{ items: number; emails: number }> {
  const today = melbourneToday()
  const tomorrow = new Date(Date.now() + 86_400_000)
    .toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

  const dueRows = await table<ContentItem>('content_items').list({
    where: r => r.due_date != null && r.due_date <= tomorrow
      && !['scheduled', 'published'].includes(r.status),
    limit: 500,
  })
  const withKinds = await attachOne(
    await attachOne(dueRows, 'client_id', 'clients', ['name']),
    'work_kind_id', 'work_kinds', ['slug'],
  )
  const items = withKinds as unknown as DueItem[]
  if (items.length === 0) return { items: 0, emails: 0 }

  // resolve recipients in bulk: schedulers once, managers per client, owners per id
  const schedulers = (await table<TeamUserRow>('team_users')
    .list({ where: u => u.role === 'scheduler' && u.active_status })) as unknown as Person[]

  const clientIds = [...new Set(items.map(i => i.client_id))]
  const mgrLinks = await table<TeamUserClient>('team_user_clients')
    .list({ where: r => clientIds.includes(r.client_id) })
  const mgrRows = await attachOne(mgrLinks, 'team_user_id', 'team_users',
    ['id', 'email', 'name', 'role', 'active_status'])
  const managersByClient = new Map<string, Person[]>()
  for (const row of mgrRows) {
    const u = row.team_users as unknown as (Person & { role: string; active_status: boolean }) | null
    if (!u?.active_status || !['account_manager', 'super_admin'].includes(u.role)) continue
    const list = managersByClient.get(row.client_id) ?? []
    list.push(u)
    managersByClient.set(row.client_id, list)
  }

  const ownerIds = [...new Set(items.map(i => i.owner_id).filter(Boolean))] as string[]
  const ownerRows = ownerIds.length
    ? await table<TeamUserRow>('team_users')
        .list({ where: u => ownerIds.includes(u.id) && u.active_status })
    : []
  const owners = new Map((ownerRows as unknown as Person[]).map(o => [o.id, o]))

  let emails = 0
  for (const item of items) {
    const tag = label(item.due_date, today)
    // the stage in the words the dashboard uses — a shoot brief has its own
    // vocabulary, so the kind decides. Never the raw database status.
    const stage = itemStatusLabel(
      item.work_kinds?.slug, item.status as ItemStatus, STATUS_LABELS[item.status as ItemStatus],
    )
    const recipients = new Map<string, Person>()
    if (item.status === 'approved_for_scheduling') {
      // honour the handoff: an item assigned to specific schedulers reminds
      // only them, matching whose queue it actually appears in
      const raw = (item as unknown as { scheduler_ids?: unknown }).scheduler_ids
      const assigned = Array.isArray(raw) ? (raw as string[]) : []
      const pool = assigned.length > 0 ? schedulers.filter(s => assigned.includes(s.id)) : schedulers
      for (const s of (pool.length > 0 ? pool : schedulers)) recipients.set(s.id, s)
    } else {
      const owner = item.owner_id ? owners.get(item.owner_id) : undefined
      if (owner) recipients.set(owner.id, owner)
      for (const m of managersByClient.get(item.client_id) ?? []) recipients.set(m.id, m)
    }
    for (const person of recipients.values()) {
      const result = await notify({
        eventType: 'due_reminder',
        entityType: 'content_item',
        entityId: `${item.id}#${today}`,
        recipientId: person.id,
        recipientEmail: person.email,
        subject: `${tag === 'OVERDUE' ? '⚠️ Overdue' : tag === 'due today' ? 'Due today' : 'Due tomorrow'}: ${item.title}`,
        bodyHtml: renderEmail(
          `${item.title} — ${tag}`,
          `<p><strong>${item.title}</strong> for ${item.clients?.name ?? 'a client'} is <strong>${tag}</strong> ` +
          `(due ${item.due_date}) and is still in “${stage}”.</p>` +
          (item.status === 'approved_for_scheduling'
            ? '<p>It is approved and waiting to be scheduled.</p>'
            : '<p>It has not reached scheduling yet.</p>'),
          'Open the item',
          `${DASHBOARD_URL}/dashboard/production/${item.id}`
        ),
      })
      if (result === 'sent') emails++
    }
  }
  return { items: items.length, emails }
}
