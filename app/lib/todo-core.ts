/**
 * TO-DOS (the owner, 17 Sep 2026: "create a to-dos page for every role —
 * anyone can have access, but they see theirs: a scheduler sees theirs, an
 * AM sees the ones they've been assigned and can create their own, a super
 * admin sees all; filter by employee; allow file uploads").
 *
 * One flat table, `todos`, and the pure rules here: who sees which row, who
 * may change or delete it, how a patch is cleaned, and how the list is
 * grouped for the page. No I/O — the routes and the page do that.
 */
export type TodoStatus = 'open' | 'done'

export type TodoFile = { url: string; name: string; mime: string | null; size: number | null }

export type Todo = {
  id: string
  title: string
  note: string | null
  status: TodoStatus
  due_date: string | null
  /** who it is for */
  owner_id: string | null
  created_by: string | null
  client_id: string | null
  files: TodoFile[]
  created_at: string
  updated_at: string
  done_at: string | null
  done_by: string | null
}

export type TodoViewer = { id: string; role: string }

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

/** WHO SEES WHAT: a super admin every row; anyone else the rows they hold or
 *  made. (An account manager is "anyone else" here — their world is the
 *  to-dos handed to them and the ones they wrote, not the whole team's.) */
export function visibleTodos<T extends { owner_id?: string | null; created_by?: string | null }>(viewer: TodoViewer | null, rows: readonly T[]): T[] {
  if (!viewer || viewer.role === 'client') return []
  if (viewer.role === 'super_admin') return [...rows]
  return rows.filter(r => r.owner_id === viewer.id || r.created_by === viewer.id)
}

/** the person filter is a manager's — everyone else already sees only their own */
export function mayFilterByPerson(viewer: TodoViewer | null): boolean {
  return viewer?.role === 'super_admin' || viewer?.role === 'account_manager'
}

export function mayEditTodo(viewer: TodoViewer | null, todo: { owner_id?: string | null; created_by?: string | null }): boolean {
  if (!viewer || viewer.role === 'client') return false
  if (viewer.role === 'super_admin') return true
  return todo.owner_id === viewer.id || todo.created_by === viewer.id
}

export function mayDeleteTodo(viewer: TodoViewer | null, todo: { created_by?: string | null }): boolean {
  if (!viewer || viewer.role === 'client') return false
  return viewer.role === 'super_admin' || todo.created_by === viewer.id
}

export function todoFilesOf(raw: unknown): TodoFile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map(f => ({
      url: String(f.url ?? '').trim(),
      name: String(f.name ?? '').trim() || 'file',
      mime: clean(f.mime),
      size: typeof f.size === 'number' && f.size >= 0 ? f.size : null,
    }))
    .filter(f => /^https?:\/\//i.test(f.url))
    .slice(0, 50)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A patch, cleaned: unknown keys dropped, strings trimmed and capped, the
 *  date checked, the status one of two words. `ok: false` says what is wrong. */
export function sanitiseTodoPatch(raw: unknown): { ok: true; patch: Partial<Todo> } | { ok: false, reason: string } {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const patch: Partial<Todo> = {}
  if ('title' in p) {
    const t = clean(p.title)
    if (!t) return { ok: false, reason: 'Say what the to-do is' }
    patch.title = t.slice(0, 200)
  }
  if ('note' in p) patch.note = clean(p.note)?.slice(0, 4000) ?? null
  if ('status' in p) {
    if (p.status !== 'open' && p.status !== 'done') return { ok: false, reason: 'A to-do is open or done' }
    patch.status = p.status
  }
  if ('due_date' in p) {
    const d = clean(p.due_date)
    if (d && !DATE.test(d)) return { ok: false, reason: 'The date is not a date' }
    patch.due_date = d
  }
  if ('owner_id' in p) patch.owner_id = clean(p.owner_id)
  if ('client_id' in p) patch.client_id = clean(p.client_id)
  if ('files' in p) patch.files = todoFilesOf(p.files)
  return { ok: true, patch }
}

/** open first; among open, dated before undated, sooner first; done newest first */
export function sortTodos<T extends { status?: string | null; due_date?: string | null; created_at?: string | null; done_at?: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ad = a.status === 'done', bd = b.status === 'done'
    if (ad !== bd) return ad ? 1 : -1
    if (ad) return String(b.done_at ?? b.created_at ?? '').localeCompare(String(a.done_at ?? a.created_at ?? ''))
    const da = a.due_date ?? '', db = b.due_date ?? ''
    if (!!da !== !!db) return da ? -1 : 1
    if (da !== db) return da.localeCompare(db)
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  })
}

export type TodoGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'done'
export const TODO_GROUPS: { key: TodoGroupKey; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'undated', label: 'No date' },
  { key: 'done', label: 'Done' },
]

/** which group a to-do sits in, given today's key (YYYY-MM-DD) */
export function todoGroupOf(todo: { status?: string | null; due_date?: string | null }, today: string): TodoGroupKey {
  if (todo.status === 'done') return 'done'
  const d = todo.due_date ?? null
  if (!d) return 'undated'
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  const t = new Date(`${today}T00:00:00Z`).getTime()
  const due = new Date(`${d}T00:00:00Z`).getTime()
  return due - t <= 6 * 86400000 ? 'week' : 'later'
}

export function groupTodos<T extends { status?: string | null; due_date?: string | null; created_at?: string | null; done_at?: string | null }>(rows: readonly T[], today: string): { key: TodoGroupKey; label: string; rows: T[] }[] {
  const sorted = sortTodos(rows)
  return TODO_GROUPS.map(g => ({ ...g, rows: sorted.filter(r => todoGroupOf(r, today) === g.key) }))
}

/** the due chip's words */
export function dueWords(due: string | null | undefined, today: string): string | null {
  if (!due) return null
  if (due === today) return 'Due today'
  if (due < today) return `Overdue · ${due.slice(5).replace('-', '/')}`
  const [y, m, d] = due.split('-').map(Number)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? ''
  return `Due ${d} ${month}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`
}

/** what the list says when a filter empties it */
export function todosEmptyWords(filter: { status: 'open' | 'done' | 'all'; person: string | null; client: string | null }, personName: string | null): string {
  const who = filter.person ? (personName ? ` for ${personName}` : ' for that person') : ''
  if (filter.status === 'done') return `Nothing done yet${who}.`
  if (filter.status === 'all') return `No to-dos${who}.`
  return `Nothing to do${who} — add one.`
}
