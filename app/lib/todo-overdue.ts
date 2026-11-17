import 'server-only'
import { table } from '@/lib/db'
import type { TeamUser as TeamUserRow } from '@/lib/db-types'
import { escapeHtml, notify, renderEmail } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { isTestClient } from './test-clients-core'
import { overdueByOwner, overdueKey, overdueSubject, overdueToRemind, overdueWords, type OverdueTodoLike } from './todo-overdue-core'

type TodoRow = OverdueTodoLike & { client_id?: string | null }

const melbourneToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

/**
 * One pass over the open to-dos that are past their due date: each person
 * gets ONE email (and one bell row) listing the to-dos assigned to them that
 * became a day late or three days late since the job last ran
 * (todo-overdue-core). Through `notify`, so EMAIL_TEST_ONLY and the
 * exactly-once log apply: a retry or a second run sends nothing twice.
 *
 * A test project's to-dos are left out here, because the email is about
 * several to-dos at once and `notify`'s own test-client guard reads one.
 */
export async function runTodoOverdueReminders(): Promise<{ overdue: number; emails: number }> {
  const today = melbourneToday()
  const rows = await table<TodoRow>('todos' as never).list({
    where: r => r.status === 'open' && !r.done_at && !!r.owner_id && r.due_date != null && String(r.due_date).slice(0, 10) < today,
    limit: 2000,
  })
  const owed = overdueToRemind((rows as TodoRow[]).filter(r => !isTestClient(r.client_id ?? null)), today)
  if (owed.length === 0) return { overdue: 0, emails: 0 }

  const byOwner = overdueByOwner(owed)
  const ownerIds = [...byOwner.keys()]
  const people = await table<TeamUserRow>('team_users').list({
    where: u => ownerIds.includes(String(u.id)) && u.active_status !== false && !!u.email,
  })

  let emails = 0
  for (const person of people) {
    const list = byOwner.get(String(person.id)) ?? []
    if (list.length === 0) continue
    const titles = list.map(o => String(o.todo.title ?? '').trim() || 'A to-do')
    const subject = overdueSubject(titles)
    const first = list[0].todo
    const lines = list.map((o, i) =>
      `<li style="margin:0 0 6px;"><a href="${DASHBOARD_URL}/dashboard/todos?task=${encodeURIComponent(o.todo.id)}" style="color:#1838E0;">${escapeHtml(titles[i])}</a>` +
      ` — due ${escapeHtml(String(o.todo.due_date).slice(0, 10))}, <strong>${escapeHtml(overdueWords(o.days))}</strong></li>`).join('')
    const result = await notify({
      eventType: 'todo_overdue',
      entityType: 'todo',
      entityId: overdueKey(first.id, today),
      recipientId: String(person.id),
      recipientEmail: String(person.email),
      clientId: null,
      subject,
      bodyHtml: renderEmail(
        list.length === 1 ? `${titles[0]} — ${overdueWords(list[0].days)}` : `${list.length} to-dos assigned to you are overdue`,
        `<p>${list.length === 1 ? 'This to-do is assigned to you and is past its due date:' : 'These to-dos are assigned to you and are past their due date:'}</p>` +
        `<ul style="margin:12px 0;padding-left:20px;">${lines}</ul>` +
        '<p>Tick off what is done, or move the due date if the plan has changed.</p>',
        list.length === 1 ? 'Open the to-do' : 'Open your to-dos',
        list.length === 1 ? `${DASHBOARD_URL}/dashboard/todos?task=${encodeURIComponent(first.id)}` : `${DASHBOARD_URL}/dashboard/todos`,
      ),
    })
    if (result === 'sent') emails++
  }
  return { overdue: owed.length, emails }
}
