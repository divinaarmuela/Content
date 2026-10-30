import { normaliseRepeat, type TodoRepeat } from './todo-repeat-core'

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
  /** the first day of its window, Asana's start date (30 Oct 2026); null = just the due date */
  start_date?: string | null
  /** who it is for */
  owner_id: string | null
  created_by: string | null
  client_id: string | null
  files: TodoFile[]
  created_at: string
  updated_at: string
  done_at: string | null
  done_by: string | null
  section_id?: string | null
  position?: number | null
  blocked_by?: string[] | null
  /** Asana's "Repeats" (todo-repeat-core) */
  repeat?: TodoRepeat | null
  repeat_of?: string | null
  /** custom fields' values, by field id (todo-fields-core) */
  fields?: Record<string, string | number> | null
  /** its section on its client's project (todo_project_sections) */
  project_section_id?: string | null
}

/** who is looking — and, for a client's PROJECT (the owner, 20 Oct 2026, Manal's video of Asana's Projects: "if I am
 *  looking at StretchWorks I can see what other people are working on"), the clients they are on */
export type TodoViewer = {
  id: string
  role: string
  clientIds?: readonly string[]
  /** PRIVATE PROJECTS THIS PERSON IS NOT ON (30 Oct 2026) — their to-dos are hidden from them, super admin or not,
   *  unless the to-do is theirs (assigned, made, followed) */
  hiddenProjects?: readonly string[]
}

/** the private projects a person is not a member of — from the agency's own projects (todo_projects) */
export function hiddenProjectsFor(viewerId: string, projects: readonly { id: string; private?: boolean | null; member_ids?: unknown }[]): string[] {
  return projects.filter(p => p.private === true && !(Array.isArray(p.member_ids) && p.member_ids.includes(viewerId))).map(p => p.id)
}

/** is this to-do kept from this person: on a private project they are not on, and not theirs */
export function hiddenFrom(viewer: TodoViewer, todo: { client_id?: string | null; owner_id?: string | null; created_by?: string | null; followers?: unknown }): boolean {
  return !!todo.client_id && !!viewer.hiddenProjects?.includes(todo.client_id) && !isOnTodo(viewer.id, todo)
}

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

export function mayEditTodo(viewer: TodoViewer | null, todo: { owner_id?: string | null; created_by?: string | null; client_id?: string | null; followers?: unknown }): boolean {
  if (!viewer || viewer.role === 'client') return false
  if (hiddenFrom(viewer, todo)) return false
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
  // A START DATE (Abby, 30 Oct 2026: "add start date on due date? So they can have flexibility within xx to xx day")
  if ('start_date' in p) {
    const d = clean(p.start_date)
    if (d && !DATE.test(d)) return { ok: false, reason: 'The start date is not a date' }
    patch.start_date = d
  }
  const due = 'due_date' in patch ? patch.due_date : undefined
  if (patch.start_date && due && patch.start_date > due) return { ok: false, reason: 'The start date is after the due date' }
  if ('owner_id' in p) patch.owner_id = clean(p.owner_id)
  if ('client_id' in p) patch.client_id = clean(p.client_id)
  if ('files' in p) patch.files = todoFilesOf(p.files)
  // 18 Oct 2026: own sections, order, dependencies
  if ('section_id' in p) patch.section_id = clean(p.section_id)
  if ('position' in p) {
    const n = Number(p.position)
    if (!Number.isFinite(n)) return { ok: false, reason: 'The order is not a number' }
    patch.position = n
  }
  if ('blocked_by' in p) patch.blocked_by = idsOf(p.blocked_by).slice(0, 50)
  // 20 Oct 2026: Asana's "Repeats" — anything that is not a rule is "doesn't repeat"
  if ('repeat' in p) patch.repeat = normaliseRepeat(p.repeat)
  // 20 Oct 2026: a project's section, and custom fields' values (checked against the fields by the route)
  if ('project_section_id' in p) patch.project_section_id = clean(p.project_section_id)
  if ('fields' in p) {
    if (!p.fields || typeof p.fields !== 'object' || Array.isArray(p.fields)) return { ok: false, reason: 'The fields are not fields' }
    patch.fields = p.fields as never
  }
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

/* ── ASANA'S MY TASKS (the owner, 18 Oct 2026: "identical ui from asana … everything") ──
 * Subtasks, collaborators (followers), likes, comments with "@Name" tags and the
 * activity feed. The rules stay here, pure; the routes and the page do the I/O. */

/** a list of ids out of whatever the row holds */
export function idsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))].slice(0, 200)
}

/** add or take one id off a list (a like, a follow) — `on` says which */
export function toggleId(raw: unknown, id: string, on: boolean): string[] {
  const list = idsOf(raw).filter(x => x !== id)
  return on ? [...list, id] : list
}

/** is this person on the to-do: holds it, wrote it, or follows it */
export function isOnTodo(viewerId: string, todo: { owner_id?: string | null; created_by?: string | null; followers?: unknown }): boolean {
  return todo.owner_id === viewerId || todo.created_by === viewerId || idsOf(todo.followers).includes(viewerId)
}

/** on the client's project: the viewer is on the to-do's client (Asana's project members see the whole project) */
export function inTodoProject(viewer: TodoViewer, todo: { client_id?: string | null }): boolean {
  return !!todo.client_id && !!viewer.clientIds?.includes(todo.client_id)
}

/** WHO SEES WHAT, with collaborators: a follower sees the to-do too, and a
 *  subtask is seen by whoever sees its parent; everyone on a client sees that client's to-dos (its project) */
export function visibleWithFollowers<T extends { id?: string; owner_id?: string | null; created_by?: string | null; followers?: unknown; parent_id?: string | null; client_id?: string | null }>(viewer: TodoViewer | null, rows: readonly T[]): T[] {
  if (!viewer || viewer.role === 'client') return []
  // a private project's to-dos are its members' — a super admin sees every row but those (30 Oct 2026)
  // …and a subtask under one goes with it, unless the subtask is this person's own
  const blocked = new Set(rows.filter(r => hiddenFrom(viewer, r)).map(r => r.id))
  const off = (r: T) => blocked.has(String(r.id)) || (!!r.parent_id && blocked.has(r.parent_id) && !isOnTodo(viewer.id, r))
  const mine = new Set(rows.filter(r => !off(r) && (viewer.role === 'super_admin' || isOnTodo(viewer.id, r) || inTodoProject(viewer, r))).map(r => r.id))
  return rows.filter(r => !off(r) && (mine.has(r.id) || (!!r.parent_id && mine.has(r.parent_id))))
}

/** who may READ and COMMENT on a to-do: whoever is on it (or on its parent), everyone on its client's project, and a
 *  super admin */
export function mayCommentOnTodo(viewer: TodoViewer | null, todo: { owner_id?: string | null; created_by?: string | null; followers?: unknown; client_id?: string | null }, parent?: { owner_id?: string | null; created_by?: string | null; followers?: unknown; client_id?: string | null } | null): boolean {
  if (!viewer || viewer.role === 'client') return false
  // a private project's to-do: its members, and whoever the to-do (or its parent) is theirs
  if (hiddenFrom(viewer, todo) && !(parent && isOnTodo(viewer.id, parent))) return false
  if (viewer.role === 'super_admin') return true
  return isOnTodo(viewer.id, todo) || (!!parent && isOnTodo(viewer.id, parent)) || inTodoProject(viewer, todo) || (!!parent && inTodoProject(viewer, parent))
}

/** a comment's text, cleaned: trimmed, capped at 4,000 characters, never empty */
export function cleanCommentBody(raw: unknown): { ok: true; body: string } | { ok: false; reason: string } {
  const body = typeof raw === 'string' ? raw.trim() : ''
  if (!body) return { ok: false, reason: 'Write something first' }
  return { ok: true, body: body.slice(0, 4000) }
}

/** WHO IS TOLD about a comment or a change: the holder, the writer and every
 *  collaborator — never the person who did it, never twice. Tagged people are
 *  told separately (they get "tagged you"), so they are taken off this list. */
export function todoAudience(todo: { owner_id?: string | null; created_by?: string | null; followers?: unknown }, actorId: string, tagged: readonly string[] = []): string[] {
  const skip = new Set([actorId, ...tagged])
  const out: string[] = []
  for (const id of [todo.owner_id, todo.created_by, ...idsOf(todo.followers)]) {
    if (id && !skip.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** the due date a to-do gets when it is put in a section (a board column, an "Add task…" row) */
export function dueForGroup(key: TodoGroupKey, today: string): string | null {
  if (key === 'today' || key === 'overdue') return today
  const d = new Date(`${today}T00:00:00Z`)
  if (key === 'week') { d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
  if (key === 'later') { d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10) }
  return null
}

/** what changed, as activity lines: one per field, old → new */
export function todoChanges(before: Record<string, unknown>, patch: Record<string, unknown>): { field: string; from: string | null; to: string | null }[] {
  const out: { field: string; from: string | null; to: string | null }[] = []
  for (const field of ['title', 'due_date', 'owner_id', 'client_id', 'note'] as const) {
    if (!(field in patch)) continue
    const from = (before[field] ?? null) as string | null
    const to = (patch[field] ?? null) as string | null
    if ((from ?? '') !== (to ?? '')) out.push({ field, from, to })
  }
  return out
}

/** one activity row in plain words, Asana style ("Akmal changed the due date to Oct 21") */
export function activityWords(row: { action?: string | null; old_value?: string | null; new_value?: string | null; detail?: string | null }, nameOf: (id: string | null) => string, clientOf: (id: string | null) => string): string {
  const v = row.new_value ?? null
  switch (row.action) {
    case 'todo_made': return 'created this task'
    case 'todo_done': return 'completed this task'
    // the next one, made by a repeat (20 Oct 2026)
    case 'todo_repeated': return `made this task by repeating it${v ? `, due ${v}` : ''}`
    case 'todo_reopened': return 'marked this task incomplete'
    case 'todo_subtask': return `added subtask ${row.detail ?? ''}`.trim()
    case 'todo_attached': return `attached ${row.detail ?? 'a file'}`
    case 'todo_followed': return 'joined as a collaborator'
    case 'todo_dependency': return 'added a dependency'
    case 'todo_changed:title': return `renamed this task to ${v ?? ''}`
    case 'todo_changed:due_date': return v ? `changed the due date to ${v}` : 'removed the due date'
    case 'todo_changed:owner_id': return v ? `assigned this task to ${nameOf(v)}` : 'unassigned this task'
    case 'todo_changed:client_id': return v ? `set the client to ${clientOf(v)}` : 'removed the client'
    case 'todo_changed:note': return 'changed the description'
    default: return 'changed this task'
  }
}

/* ── SORT, GROUP, DEPENDENCIES, NOTES (the owner, 18 Oct 2026: "add this then") ── */

export type TodoSort = 'due' | 'created' | 'alpha' | 'assignee' | 'manual'
export const TODO_SORTS: { key: TodoSort; label: string }[] = [
  { key: 'due', label: 'Due date' },
  { key: 'manual', label: 'None (drag to order)' },
  { key: 'created', label: 'Created on' },
  { key: 'alpha', label: 'Alphabetical' },
  { key: 'assignee', label: 'Assignee' },
]
export type TodoGroupBy = 'date' | 'sections' | 'project' | 'assignee' | 'client' | 'none'
export const TODO_GROUP_BYS: { key: TodoGroupBy; label: string }[] = [
  { key: 'date', label: 'Due date sections' },
  { key: 'sections', label: 'My sections' },
  // a client project's own sections, Asana's columns (20 Oct 2026) — offered inside a project
  { key: 'project', label: 'Project sections' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'client', label: 'Client' },
  { key: 'none', label: 'None' },
]

type Sortable = { id?: string; title?: string | null; status?: string | null; due_date?: string | null; created_at?: string | null; done_at?: string | null; owner_id?: string | null; position?: number | null }

/** a list sorted the chosen way; open before done in every sort */
export function sortTodosBy<T extends Sortable>(rows: readonly T[], by: TodoSort, nameOf: (id: string | null) => string = () => ''): T[] {
  if (by === 'due') return sortTodos(rows)
  const key = (r: T): string | number => by === 'alpha' ? String(r.title ?? '').toLowerCase()
    : by === 'assignee' ? nameOf(r.owner_id ?? null).toLowerCase()
      : by === 'created' ? String(r.created_at ?? '')
        : (r.position ?? Number.MAX_SAFE_INTEGER)
  return [...rows].sort((a, b) => {
    const ad = a.status === 'done', bd = b.status === 'done'
    if (ad !== bd) return ad ? 1 : -1
    const ka = key(a), kb = key(b)
    if (ka !== kb) return ka < kb ? -1 : 1
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  })
}

export type TodoGroup<T> = { key: string; label: string; rows: T[]; tone?: 'red'; sectionId?: string | null; dateKey?: TodoGroupKey; projectSectionId?: string | null }

/** the list cut into groups the chosen way. `sections` are the viewer's own, in order. */
export function groupTodosBy<T extends Sortable & { section_id?: string | null; client_id?: string | null; project_section_id?: string | null }>(
  rows: readonly T[], by: TodoGroupBy,
  ctx: { today: string; sort: TodoSort; sections: readonly { id: string; name: string }[]; nameOf: (id: string | null) => string; clientOf: (id: string | null) => string; projectSections?: readonly { id: string; name: string }[] },
): TodoGroup<T>[] {
  const sorted = sortTodosBy(rows, ctx.sort, ctx.nameOf)
  if (by === 'none') return [{ key: 'all', label: 'Tasks', rows: sorted }]
  // A CLIENT PROJECT'S SECTIONS, as Asana's (20 Oct 2026): its own, in order, then the tasks in none
  if (by === 'project') {
    const ps = ctx.projectSections ?? []
    const known = new Set(ps.map(x => x.id))
    const loose = sorted.filter(r => !r.project_section_id || !known.has(r.project_section_id))
    return [
      ...(loose.length || ps.length === 0 ? [{ key: 'psec:', label: 'Untitled section', projectSectionId: null, rows: loose }] : []),
      ...ps.map(x => ({ key: `psec:${x.id}`, label: x.name, projectSectionId: x.id, rows: sorted.filter(r => r.project_section_id === x.id) })),
    ]
  }
  if (by === 'date') {
    return TODO_GROUPS.map(g => ({ key: g.key, label: g.label, dateKey: g.key, tone: g.key === 'overdue' ? 'red' as const : undefined, rows: sorted.filter(r => todoGroupOf(r, ctx.today) === g.key) }))
  }
  if (by === 'sections') {
    const known = new Set(ctx.sections.map(s => s.id))
    return [
      { key: 'sec:none', label: 'Recently assigned', sectionId: null, rows: sorted.filter(r => !r.section_id || !known.has(r.section_id)) },
      ...ctx.sections.map(s => ({ key: `sec:${s.id}`, label: s.name, sectionId: s.id, rows: sorted.filter(r => r.section_id === s.id) })),
    ]
  }
  const keyOf = (r: T) => (by === 'assignee' ? r.owner_id ?? '' : r.client_id ?? '')
  const keys = [...new Set(sorted.map(keyOf))]
  const label = (k: string) => (by === 'assignee' ? (k ? ctx.nameOf(k) : 'No assignee') : (k ? ctx.clientOf(k) : 'No client'))
  return keys.map(k => ({ key: `${by}:${k}`, label: label(k), rows: sorted.filter(r => keyOf(r) === k) }))
    .sort((a, b) => (a.key.endsWith(':') ? 1 : b.key.endsWith(':') ? -1 : a.label.localeCompare(b.label)))
}

/** the position that puts a row between two neighbours (either may be missing) */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  const a = typeof before === 'number' && Number.isFinite(before) ? before : null
  const b = typeof after === 'number' && Number.isFinite(after) ? after : null
  if (a === null && b === null) return Date.now()
  if (a === null) return (b as number) - 1024
  if (b === null) return a + 1024
  return (a + b) / 2
}

/** DEPENDENCIES: the to-dos this one waits on that are still open (gone ones are ignored) */
export function openBlockers<T extends { id?: string; status?: string | null }>(todo: { blocked_by?: unknown }, all: readonly T[]): T[] {
  const ids = idsOf(todo.blocked_by)
  return all.filter(t => ids.includes(String(t.id)) && t.status !== 'done')
}

/** may `blockerId` be added as a dependency of `todoId` — never itself, never a loop */
export function mayDependOn(todoId: string, blockerId: string, all: readonly { id?: string; blocked_by?: unknown }[]): boolean {
  if (!blockerId || todoId === blockerId) return false
  const byId = new Map(all.map(t => [String(t.id), t]))
  const seen = new Set<string>()
  const stack = [blockerId]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === todoId) return false
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...idsOf(byId.get(id)?.blocked_by))
  }
  return true
}

/* the description's formatting: **bold**, *italic*, "- " bullets, "1. " numbers — read as text, never run as HTML */
export type NoteSpan = { text: string; bold?: boolean; italic?: boolean }
export type NoteBlock = { kind: 'p'; spans: NoteSpan[] } | { kind: 'ul' | 'ol'; items: NoteSpan[][] }

export function noteSpans(line: string): NoteSpan[] {
  const out: NoteSpan[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) })
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], italic: true })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out
}

export function parseNote(text: string | null | undefined): NoteBlock[] {
  const blocks: NoteBlock[] = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const last = blocks[blocks.length - 1]
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol'
      const spans = noteSpans((ul ?? ol)![1])
      if (last && last.kind === kind) last.items.push(spans)
      else blocks.push({ kind, items: [spans] })
    } else if (line.trim()) {
      blocks.push({ kind: 'p', spans: noteSpans(line) })
    }
  }
  return blocks
}

/**
 * LINKS IN A TO-DO'S WORDS ARE LINKS (the owner, 20 Oct 2026: "on todos the description comments etc section make
 * the links hyperlinks … currently existing ones are just texts"). Found when the words are drawn, so every to-do
 * and comment already written gets them too: an https:// or http:// address, or one starting www. — without the full
 * stop or bracket that ends the sentence around it.
 */
export type LinkPart = { text: string; href?: string }
export function linkParts(text: string): LinkPart[] {
  const out: LinkPart[] = []
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let url = m[0]
    // the sentence's own ending is not part of the address
    while (/[.,;:!?)\]}'"]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1)
    if (!url) continue
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    last = m.index + url.length
    re.lastIndex = last
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/**
 * EVERY TASK THAT MAY BE ADDED AS A DEPENDENCY, in one pass (28 Oct 2026: "when we type in description it lags"). The
 * panel asked mayDependOn of each of ~490 tasks on every key pressed, and each ask built a map of all of them — about a
 * quarter of a million steps a keystroke. The tasks that may NOT be one are this task and everything already waiting on
 * it, however far down; one walk backwards from it finds them all.
 */
export function dependableIds(todoId: string, all: readonly { id?: string; blocked_by?: unknown }[]): Set<string> {
  const waitingOn = new Map<string, string[]>()
  for (const t of all) for (const b of idsOf(t.blocked_by)) waitingOn.set(b, [...(waitingOn.get(b) ?? []), String(t.id)])
  const barred = new Set<string>([todoId])
  const stack = [todoId]
  while (stack.length) for (const w of waitingOn.get(stack.pop() as string) ?? []) if (!barred.has(w)) { barred.add(w); stack.push(w) }
  return new Set(all.map(t => String(t.id)).filter(id => id && !barred.has(id)))
}

/**
 * THE DESCRIPTION'S BUTTONS, as a toggle (28 Oct 2026): Bold on bold words takes the bold off, a list button on lines
 * already in that list takes the list off — they only ever added marks before. Returns the new text and selection.
 */
export function formatNote(v: string, a: number, b: number, k: 'bold' | 'italic' | 'ul' | 'ol'): { value: string; a: number; b: number } {
  if (k === 'bold' || k === 'italic') {
    const mark = k === 'bold' ? '**' : '*'
    const before = v.slice(Math.max(0, a - mark.length), a), after = v.slice(b, b + mark.length)
    // italic must not mistake the inner star of bold for its own
    const wrapped = before === mark && after === mark && (k === 'bold' || (v[a - 2] !== '*' && v[b + 1] !== '*'))
    if (wrapped) return { value: v.slice(0, a - mark.length) + v.slice(a, b) + v.slice(b + mark.length), a: a - mark.length, b: b - mark.length }
    return { value: v.slice(0, a) + mark + v.slice(a, b) + mark + v.slice(b), a: a + mark.length, b: b + mark.length }
  }
  const start = v.lastIndexOf('\n', a - 1) + 1
  const endAt = v.indexOf('\n', b)
  const end = endAt < 0 ? v.length : endAt
  const lines = v.slice(start, end).split('\n')
  const marker = k === 'ul' ? /^\s*[-*•]\s+/ : /^\s*\d+[.)]\s+/
  const off = lines.every(l => marker.test(l))
  const made = lines.map((l, i) => (off ? l.replace(marker, '') : `${k === 'ul' ? '- ' : `${i + 1}. `}${l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}`)).join('\n')
  return { value: v.slice(0, start) + made + v.slice(end), a: start + made.length, b: start + made.length }
}

/** Enter inside a list starts the next item ("- " or the next number); Enter on an empty item ends the list. null = an ordinary Enter */
export function continueList(v: string, caret: number): { value: string; caret: number } | null {
  const start = v.lastIndexOf('\n', caret - 1) + 1
  const line = v.slice(start, caret)
  const m = /^(\s*)([-*•]|(\d+)[.)])(\s+)(.*)$/.exec(line)
  if (!m) return null
  if (!m[5].trim() && v.slice(caret, v.indexOf('\n', caret) < 0 ? v.length : v.indexOf('\n', caret)).trim() === '') {
    return { value: v.slice(0, start) + v.slice(caret), caret: start }
  }
  const next = `\n${m[1]}${m[3] !== undefined ? `${Number(m[3]) + 1}${m[2].slice(-1)}` : m[2]}${m[4]}`
  return { value: v.slice(0, caret) + next + v.slice(caret), caret: caret + next.length }
}
