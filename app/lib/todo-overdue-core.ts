/**
 * OVERDUE TO-DOS — the pure half (the owner, 17 Nov 2026: "an overdue task
 * reminder email sent to the task assignee… a day after a task is due and
 * 3 days after").
 *
 * Each to-do is mentioned exactly twice: on the first weekday morning it is
 * a day past its due date, and on the first weekday morning it is three days
 * past. The job runs Monday to Friday, so "first morning" is a CROSSING: the
 * to-do was not yet that late the last time the job ran. A to-do due on a
 * Friday crosses both marks over the weekend and is mentioned once on Monday,
 * as three days late — never twice in a morning. A to-do that has been late
 * for a month crosses nothing and is never mentioned, so switching this on
 * does not empty a backlog into people's inboxes.
 *
 * ONE EMAIL PER PERSON, NOT ONE PER TO-DO. Measured on the real list before
 * this shipped (17 Nov 2026): one email each would have been 31 emails the
 * next morning, about twenty of them to the schedulers for daily repeating
 * to-dos. So a person gets one email listing what crossed a mark today.
 */

export type OverdueStage = 'day1' | 'day3'

const DAY = /^\d{4}-\d{2}-\d{2}/

/** Whole days from `due` to `today`, both `YYYY-MM-DD` (a longer stamp is cut to its date). Null when either is not a date. */
export function daysPast(due: string | null | undefined, today: string): number | null {
  const d = DAY.exec(String(due ?? ''))?.[0]
  const t = DAY.exec(String(today ?? ''))?.[0]
  if (!d || !t) return null
  const a = Date.parse(`${d}T00:00:00Z`)
  const b = Date.parse(`${t}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** Days since the job last ran before `today`: 3 on a Monday (Friday), 1 otherwise. Null on a weekend — it does not run. */
export function daysSinceLastRun(today: string): number | null {
  const t = DAY.exec(String(today ?? ''))?.[0]
  if (!t) return null
  const dow = new Date(`${t}T00:00:00Z`).getUTCDay() // 0 Sunday … 6 Saturday
  if (dow === 0 || dow === 6) return null
  return dow === 1 ? 3 : 1
}

/** Which mark a to-do crossed since the job last ran — the later one when it crossed both. */
export function overdueStage(due: string | null | undefined, today: string): OverdueStage | null {
  const n = daysPast(due, today)
  const gap = daysSinceLastRun(today)
  if (n === null || gap === null || n < 1) return null
  const before = n - gap
  if (n >= 3 && before < 3) return 'day3'
  if (before < 1) return 'day1'
  return null
}

export type OverdueTodoLike = {
  id: string
  title?: string | null
  status?: string | null
  done_at?: string | null
  due_date?: string | null
  owner_id?: string | null
}

export type OverdueOwed<T> = { todo: T; stage: OverdueStage; days: number }

/** The open, assigned to-dos that crossed a mark this morning. */
export function overdueToRemind<T extends OverdueTodoLike>(todos: readonly T[], today: string): OverdueOwed<T>[] {
  const out: OverdueOwed<T>[] = []
  for (const todo of todos) {
    if (todo.status !== 'open' || todo.done_at || !todo.owner_id) continue
    const stage = overdueStage(todo.due_date, today)
    if (!stage) continue
    out.push({ todo, stage, days: daysPast(todo.due_date, today) as number })
  }
  return out
}

/** One list per assignee, the latest first. */
export function overdueByOwner<T extends OverdueTodoLike>(owed: readonly OverdueOwed<T>[]): Map<string, OverdueOwed<T>[]> {
  const by = new Map<string, OverdueOwed<T>[]>()
  for (const o of owed) {
    const id = String(o.todo.owner_id)
    by.set(id, [...(by.get(id) ?? []), o])
  }
  for (const list of by.values()) list.sort((a, b) => b.days - a.days)
  return by
}

/** "1 day overdue", "3 days overdue". */
export function overdueWords(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} overdue`
}

/** The email's subject: the to-do by name when there is one, a count when there are more. */
export function overdueSubject(titles: readonly string[]): string {
  if (titles.length === 1) return `Overdue: ${titles[0]}`.slice(0, 180)
  return `${titles.length} overdue to-dos`
}

/** The notification's entity id: one email per person per morning. */
export function overdueKey(firstTodoId: string, today: string): string {
  return `${firstTodoId}#overdue#${String(today).slice(0, 10)}`
}
