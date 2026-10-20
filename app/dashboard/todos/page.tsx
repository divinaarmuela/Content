'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDown, Calendar, ChevronDown, ChevronLeft, ChevronRight, Filter, GitBranch, GripVertical, Hourglass, Keyboard, Layers, MessageSquare,
  MoreHorizontal, Paperclip, Plus, Sparkles, ThumbsUp, X, Repeat } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTable } from '@/lib/db-client'
import type { Client, TeamUser, Todo as TodoRow, TodoComment, TodoField, TodoProjectSection, TodoSection } from '@/lib/db-types'
import { FieldControl } from './TodoFields'
import { orderedFields, orderedSections, todoGridColumns, type TodoFieldDef } from '../../lib/todo-fields-core'
import { todayKey } from '../ui/tone'
import { useRole } from '../useRole'
import { personLabel } from '../../lib/identity-core'
import {
  TODO_GROUP_BYS, TODO_SORTS, dueForGroup, groupTodos, groupTodosBy, idsOf, mayEditTodo, mayFilterByPerson, openBlockers, positionBetween,
  todoFilesOf, todosEmptyWords, visibleWithFollowers,
  type TodoGroup, type TodoGroupBy, type TodoGroupKey, type TodoSort,
} from '../../lib/todo-core'
import TodoPanel, { Avatar, CheckCircle } from './TodoPanel'
import Celebration from './Celebration'
import { ProjectIcon, TodoInbox, TodoSidebar, useTodoInbox, type Place, type Project } from './TodoNav'
import { MONTH_NAMES, dueTone, monthGrid, shortDue } from './todo-words'
import { normaliseRepeat, repeatWords, upcomingDues } from '../../lib/todo-repeat-core'

/**
 * THE TO-DOS PAGE, AS ASANA'S MY TASKS (the owner, 18 Oct 2026: "create
 * identical ui from asana look from the todos … everything", then "add this":
 * sort and group, own sections, shortcuts, select several, dependencies,
 * formatting, celebrations). Asana's layout, our colours. Measured from the
 * owner's own Asana: 37px rows with hairlines, 14px names, 12px grey column
 * heads, 16px section names with a caret, an "Add task…" row closing each
 * section; List · Board · Calendar tabs; a ~700px task panel over the list
 * from the right (TodoPanel). Who sees and changes what is todo-core's,
 * enforced again by every route; the tables are read live.
 */
type View = 'list' | 'board' | 'calendar'
const VIEWS: { key: View; label: string }[] = [{ key: 'list', label: 'List' }, { key: 'board', label: 'Board' }, { key: 'calendar', label: 'Calendar' }]
const GRID = 'grid grid-cols-[minmax(0,1fr)_96px] md:[grid-template-columns:var(--todo-cols)]'
const CELL = 'flex h-[37px] min-w-0 items-center border-l border-border px-2 text-[12px] max-md:[&:nth-child(n+3)]:hidden'

const SHORTCUTS: [string, string][] = [
  ['Tab + Q', 'Add a task'],
  ['Tab + N', 'Add a section'],
  ['Tab + M', 'Assign the open or selected tasks to me'],
  ['Tab + Backspace', 'Delete the open task'],
  ['Ctrl/⌘ + Enter', 'Mark the open task complete'],
  ['↑ / ↓', 'Open the task above / below'],
  ['Ctrl/⌘ or Shift + click', 'Select several tasks'],
  ['Esc', 'Close the panel, clear the selection'],
  ['?', 'Show these shortcuts'],
]

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window */ } },
}

export default function TodosPage() {
  const { me, loading: meLoading } = useRole()
  // the clients I am on — a client's project shows everyone's to-dos for it (20 Oct 2026, todo-core)
  const { rows: links } = useTable<{ id: string; team_user_id: string; client_id: string }>('team_user_clients')
  const myClientIds = useMemo(() => (me ? links.filter(l => l.team_user_id === me.id).map(l => l.client_id) : []), [links, me])
  const viewer = useMemo(() => (me && me.role !== 'client' ? { id: me.id, role: me.role, clientIds: myClientIds } : null), [me, myClientIds])
  const { rows: raw, loading } = useTable<TodoRow>('todos')
  const { rows: team } = useTable<TeamUser>('team_users')
  const { rows: clients } = useTable<Client>('clients')
  const { rows: comments } = useTable<TodoComment>('todo_comments')
  const { rows: allSections } = useTable<TodoSection>('todo_sections')
  // ASANA'S CUSTOM FIELDS AND EACH PROJECT'S OWN SECTIONS (20 Oct 2026)
  const { rows: fieldRows } = useTable<TodoField>('todo_fields')
  const { rows: projectSectionRows } = useTable<TodoProjectSection>('todo_project_sections')
  const fieldDefs = useMemo<TodoFieldDef[]>(() => orderedFields(fieldRows).map(f => ({ id: f.id, name: f.name, type: f.type as TodoFieldDef['type'], options: (f.options ?? []) as TodoFieldDef['options'], position: f.position })), [fieldRows])
  const gridCols = useMemo(() => ({ ['--todo-cols' as string]: todoGridColumns(fieldDefs.length) }) as React.CSSProperties, [fieldDefs.length])
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])

  const names = useMemo(() => new Map(team.map(u => [u.id, personLabel(u.name, u.email)])), [team])
  const people = useMemo(() => team.filter(u => u.role !== 'client' && u.active_status !== false).map(u => ({ id: u.id, name: personLabel(u.name, u.email), email: u.email ?? undefined })), [team])
  const clientNames = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients])
  const activeClients = useMemo(() => clients.filter(c => ((c as { status?: string | null }).status ?? 'active') === 'active').map(c => ({ id: c.id, name: c.name })), [clients])
  const sections = useMemo(() => allSections.filter(s => s.owner_id === me?.id).sort((a, b) => (Number(a.position ?? 0) - Number(b.position ?? 0)) || String(a.created_at).localeCompare(String(b.created_at))).map(s => ({ id: s.id, name: s.name })), [allSections, me?.id])

  const visibleAll = useMemo(() => visibleWithFollowers(viewer, raw as never[]) as TodoRow[], [viewer, raw])
  const commentCount = useMemo(() => { const m = new Map<string, number>(); for (const c of comments) m.set(String(c.todo_id), (m.get(String(c.todo_id)) ?? 0) + 1); return m }, [comments])
  const subCount = useMemo(() => { const m = new Map<string, number>(); for (const t of visibleAll) if (t.parent_id) m.set(t.parent_id, (m.get(t.parent_id) ?? 0) + 1); return m }, [visibleAll])

  // WHERE ON THE PAGE (the owner, 20 Oct 2026, Manal's video of Asana): Inbox, My tasks (everyone's own, first), a
  // super admin's Everyone's tasks, or a client's project
  const [place, setPlace] = useState<Place>('mine')
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    const saved = store.get('mdm.todos.place')
    if (saved === 'inbox' || saved === 'mine' || saved === 'all' || saved?.startsWith('project:')) setPlace(saved as Place)
    // a project reopens as it opened: by who is doing what
    if (saved?.startsWith('project:')) setGroupBy('project')
    fetch('/api/todos/projects', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { projects: [] })).then(j => setProjects(j.projects ?? [])).catch(() => undefined)
  }, [])
  const inbox = useTodoInbox()
  const project = place.startsWith('project:') ? projects.find(p => `project:${p.id}` === place) ?? null : null
  const projectId = place.startsWith('project:') ? place.slice(8) : null
  const projectSections = useMemo(() => orderedSections(projectSectionRows.filter(x => x.client_id === projectId)).map(x => ({ id: x.id, name: x.name })), [projectSectionRows, projectId])
  const [view, setView] = useState<View>('list')
  const [sort, setSort] = useState<TodoSort>('due')
  const [groupBy, setGroupBy] = useState<TodoGroupBy>('date')
  const [celebrate, setCelebrate] = useState(true)
  const [status, setStatus] = useState<'open' | 'done' | 'all'>('open')
  const [person, setPerson] = useState<string>('')
  const [client, setClient] = useState<string>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const canFilterPeople = mayFilterByPerson(viewer)
  useEffect(() => {
    const v = store.get('mdm.todos.view'); if (v === 'list' || v === 'board' || v === 'calendar') setView(v)
    const s = store.get('mdm.todos.sort'); if (TODO_SORTS.some(x => x.key === s)) setSort(s as TodoSort)
    // the saved grouping is My tasks'; a project opens by who is doing what
    const g = store.get('mdm.todos.group'); if (TODO_GROUP_BYS.some(x => x.key === g) && !store.get('mdm.todos.place')?.startsWith('project:')) setGroupBy(g as TodoGroupBy)
    if (store.get('mdm.todos.celebrate') === '0') setCelebrate(false)
  }, [])
  const pickView = (v: View) => { setView(v); store.set('mdm.todos.view', v) }
  const startAdd = () => {
    if (view !== 'list') { setAddNonce(n => n + 1); return }
    const g = listGroups.find(x => x.key !== 'done')
    if (g) { setCollapsed(c => { const n = new Set(c); n.delete(g.key); return n }); setAdding(g.key) }
  }
  const pickSort = (v: TodoSort) => { setSort(v); store.set('mdm.todos.sort', v) }
  const pickGroup = (v: TodoGroupBy) => { setGroupBy(v); store.set('mdm.todos.group', v) }
  /** go somewhere in the sidebar; a project opens grouped by who is doing what, as Manal asked */
  const goPlace = (p: Place) => {
    setPlace(p); store.set('mdm.todos.place', p); setSelected(new Set())
    if (p.startsWith('project:')) setGroupBy('project')
    else { const g = store.get('mdm.todos.group'); setGroupBy(TODO_GROUP_BYS.some(x => x.key === g) ? (g as TodoGroupBy) : 'date') }
    if (p !== 'all' && !p.startsWith('project:')) setPerson('')
  }

  // the top-level to-dos (subtasks live in their parent's panel, as in Asana's My Tasks)
  const shown = useMemo(() => visibleAll.filter(t => !t.parent_id
    && (status === 'all' || (status === 'done' ? t.status === 'done' : t.status !== 'done'))
    // MY TASKS is mine alone; a project is that client's, everyone's on it; Everyone's tasks is a super admin's all
    && (place === 'mine' ? t.owner_id === me?.id : projectId ? t.client_id === projectId : true)
    && (!person || place === 'mine' || (!canFilterPeople && !projectId) || t.owner_id === person)
    && (!client || !!projectId || t.client_id === client)), [visibleAll, status, person, client, canFilterPeople, place, projectId, me?.id])
  const nameOf = useCallback((id: string | null) => (id ? names.get(id) ?? 'Someone' : ''), [names])
  const clientOf = useCallback((id: string | null) => (id ? clientNames.get(id) ?? 'A client' : ''), [clientNames])
  const listGroups = useMemo(() => {
    if (!today) return []
    const by = groupBy === 'project' && !projectId ? 'date' : groupBy
    const all = groupTodosBy(shown as never[], by, { today, sort, sections, nameOf, clientOf, projectSections }) as TodoGroup<TodoRow>[]
    // the date sections stay even when empty (somewhere to add into), Overdue and Done only when they hold something
    return by === 'date' ? all.filter(g => g.rows.length > 0 || (g.key !== 'done' && g.key !== 'overdue' && status !== 'done')) : all.filter(g => g.rows.length > 0 || by === 'sections' || by === 'project' || by === 'none')
  }, [shown, groupBy, today, sort, sections, nameOf, clientOf, status, projectId, projectSections])
  const boardGroups = useMemo(() => (today ? groupTodos(shown, today).filter(g => g.rows.length > 0 || (g.key !== 'done' && g.key !== 'overdue' && status !== 'done')) : []), [shown, today, status])
  const flat = useMemo(() => listGroups.flatMap(g => g.rows), [listGroups])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  // ADD TASK STAYS IN THE VIEW YOU ARE IN, as Asana's does (the owner, 21 Oct 2026: "what happens if i click new task
  // but im in board view"): List opens a row in the first section, Board a card in its first column, Calendar one
  // on today — it used to throw you back to List
  const [addNonce, setAddNonce] = useState(0)
  const [newSection, setNewSection] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastPicked = useRef<string | null>(null)
  const [party, setParty] = useState(0)
  const open = openId ? visibleAll.find(t => t.id === openId) ?? null : null
  // a link from an email or the bell: /dashboard/todos?task=<id>
  useEffect(() => { const id = new URLSearchParams(location.search).get('task'); if (id) setOpenId(id) }, [])
  const openTask = useCallback((id: string | null) => {
    setOpenId(id)
    try { const u = new URL(location.href); if (id) u.searchParams.set('task', id); else u.searchParams.delete('task'); history.replaceState(null, '', u) } catch { /* fine */ }
  }, [])

  const send = useCallback(async (path: string, init: RequestInit, said?: string) => {
    try {
      const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
      if (said) toast.success(said)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that'); return false }
  }, [])
  const patchTodo = useCallback((id: string, body: Record<string, unknown>, said?: string) => send(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, said), [send])
  const tick = useCallback(async (t: TodoRow, done: boolean) => {
    // DEPENDENCIES: Asana warns, it does not stop you
    if (done && openBlockers(t, visibleAll).length > 0) toast.warning(`This one was waiting on ${openBlockers(t, visibleAll).length} open task${openBlockers(t, visibleAll).length === 1 ? '' : 's'}`)
    const ok = await patchTodo(t.id, { status: done ? 'done' : 'open' }, done ? 'Marked complete' : 'Marked incomplete')
    // CELEBRATIONS: now and then, like Asana's creatures — off in Options, never with reduced motion
    if (ok && done && celebrate && Math.random() < 0.34) setParty(p => p + 1)
  }, [patchTodo, visibleAll, celebrate])
  const create = (title: string, g: TodoGroup<TodoRow> | null, due?: string | null) => {
    const body: Record<string, unknown> = { title, owner_id: person || me?.id || null, client_id: projectId || client || null, files: [] }
    body.due_date = due !== undefined ? due : g?.dateKey ? dueForGroup(g.dateKey, today!) : null
    if (g?.key.startsWith('assignee:')) body.owner_id = g.key.slice(9) || me?.id || null
    if (g?.key.startsWith('client:')) body.client_id = g.key.slice(7) || null
    if (g?.sectionId) body.section_id = g.sectionId
    if (g?.projectSectionId) body.project_section_id = g.projectSectionId
    void send('/api/todos', { method: 'POST', body: JSON.stringify(body) })
  }
  /** a card dropped on a board column or a calendar day gets that column's date */
  const moveTo = (id: string, due: string | null, done?: boolean) => {
    const t = visibleAll.find(x => x.id === id)
    if (!t || !mayEditTodo(viewer, t as never)) { toast.error('Only the person it is for, or who wrote it, can move it'); return }
    if (done) { if (t.status !== 'done') void tick(t, true); return }
    if ((t.due_date ?? null) === due && t.status !== 'done') return
    void patchTodo(id, { due_date: due, ...(t.status === 'done' ? { status: 'open' } : {}) })
  }
  /** a row dropped in the list: into that group (a section, a date, a person, a client), placed before `beforeId` */
  const dropRow = (id: string, g: TodoGroup<TodoRow>, beforeId: string | null) => {
    const t = visibleAll.find(x => x.id === id)
    if (!t || !mayEditTodo(viewer, t as never)) { toast.error('Only the person it is for, or who wrote it, can move it'); return }
    const rows = g.rows.filter(r => r.id !== id)
    const at = beforeId ? rows.findIndex(r => r.id === beforeId) : rows.length
    const idx = at < 0 ? rows.length : at
    const body: Record<string, unknown> = {}
    // dropped on a row: that is a new order — saved, and the list switches to it so the drag shows (Asana does the same)
    const reordered = beforeId !== null || sort === 'manual'
    if (reordered) body.position = positionBetween(rows[idx - 1]?.position ?? null, rows[idx]?.position ?? null)
    if (groupBy === 'sections' && (t.section_id ?? null) !== (g.sectionId ?? null)) body.section_id = g.sectionId ?? null
    if (groupBy === 'project' && projectId && ((t as { project_section_id?: string | null }).project_section_id ?? null) !== (g.projectSectionId ?? null)) body.project_section_id = g.projectSectionId ?? null
    if (groupBy === 'date' && g.dateKey && g.dateKey !== 'done') { const due = dueForGroup(g.dateKey, today!); if ((t.due_date ?? null) !== due && !(g.dateKey === 'overdue')) body.due_date = due }
    if (groupBy === 'assignee' && g.key.slice(9) && g.key.slice(9) !== t.owner_id) body.owner_id = g.key.slice(9)
    if (groupBy === 'client' && (g.key.slice(7) || null) !== (t.client_id ?? null)) body.client_id = g.key.slice(7) || null
    if (Object.keys(body).length === 0) return
    if (body.position !== undefined && sort !== 'manual') { pickSort('manual'); toast('Sorted by your own order now — change it under Sort') }
    void patchTodo(id, body)
  }
  const addProjectSection = async (name: string) => {
    if (!name.trim() || !projectId) return
    const last = projectSectionRows.filter(x => x.client_id === projectId).reduce((m, x) => Math.max(m, Number(x.position ?? 0)), 0)
    await send('/api/todo-project-sections', { method: 'POST', body: JSON.stringify({ client_id: projectId, name: name.trim(), position: last + 1024 }) }, 'Section added')
  }
  const addSection = async (name: string) => {
    if (!name.trim()) return
    const last = allSections.filter(s => s.owner_id === me?.id).reduce((m, s) => Math.max(m, Number(s.position ?? 0)), 0)
    await send('/api/todo-sections', { method: 'POST', body: JSON.stringify({ name: name.trim(), position: last + 1024 }) }, 'Section added')
  }

  // SELECTING SEVERAL: Ctrl/⌘-click adds one, Shift-click a run, the bar acts on all of them
  const pick = (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    // the anchor is read NOW: the updater below runs later, after lastPicked has moved on
    const anchor = lastPicked.current
    setSelected(cur => {
      const n = new Set(cur)
      if (e.shiftKey && anchor) {
        const a = flat.findIndex(r => r.id === anchor), b = flat.findIndex(r => r.id === id)
        if (a >= 0 && b >= 0) for (const r of flat.slice(Math.min(a, b), Math.max(a, b) + 1)) n.add(r.id)
      } else if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    lastPicked.current = id
  }
  const chosen = useMemo(() => visibleAll.filter(t => selected.has(t.id)), [visibleAll, selected])
  const bulk = async (body: Record<string, unknown>, said: string) => {
    const mine = chosen.filter(t => mayEditTodo(viewer, t as never))
    const results = await Promise.all(mine.map(t => fetch(`/api/todos/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.ok).catch(() => false)))
    const ok = results.filter(Boolean).length
    const skipped = chosen.length - mine.length
    if (ok) toast.success(`${said}: ${ok} task${ok === 1 ? '' : 's'}${skipped ? ` (${skipped} not yours to change)` : ''}`)
    if (ok < mine.length) toast.error(`${mine.length - ok} could not be changed`)
    if (body.status === 'done' && ok && celebrate) setParty(p => p + 1)
  }
  const [bulkDelete, setBulkDelete] = useState(false)
  const removeChosen = async () => {
    const results = await Promise.all(chosen.map(t => fetch(`/api/todos/${t.id}`, { method: 'DELETE' }).then(r => r.ok).catch(() => false)))
    const ok = results.filter(Boolean).length
    toast.success(`Deleted ${ok} task${ok === 1 ? '' : 's'}`)
    if (ok < chosen.length) toast.error(`${chosen.length - ok} could not be deleted (only the person who made it, or a super admin)`)
    setSelected(new Set()); setBulkDelete(false)
  }

  // KEYBOARD SHORTCUTS (Asana's): Tab + a letter, Ctrl/⌘+Enter, the arrows, Esc, ?
  const tabDown = useRef(false)
  useEffect(() => {
    const typing = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable=true],[role=listbox],[role=dialog][data-radix-popper-content-wrapper]')
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Tab') { tabDown.current = true; return }
      if (tabDown.current && !typing(e.target)) {
        const k = e.key.toLowerCase()
        if (k === 'q') { e.preventDefault(); startAdd(); return }
        if (k === 'n') { e.preventDefault(); pickView('list'); pickGroup('sections'); setNewSection(''); return }
        if (k === 'm' && me) { e.preventDefault(); if (chosen.length) void bulk({ owner_id: me.id }, 'Assigned to you'); else if (open) void patchTodo(open.id, { owner_id: me.id }, 'Assigned to you'); return }
        if ((k === 'backspace' || k === 'delete') && open) { e.preventDefault(); document.querySelector<HTMLButtonElement>('[data-todo-panel] [aria-label="Delete this to-do"]')?.click(); return }
      }
      if (typing(e.target)) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && open && mayEditTodo(viewer, open as never)) { e.preventDefault(); void tick(open, open.status !== 'done'); return }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && view === 'list' && flat.length) {
        e.preventDefault()
        const i = open ? flat.findIndex(r => r.id === open.id) : -1
        const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
        if (next) { openTask(next.id); document.querySelector(`[data-todo-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }) }
        return
      }
      if (e.key === 'Escape') { if (selected.size) setSelected(new Set()); setHelpOpen(false); setOptionsOpen(false) }
      if (e.key === '?') { setHelpOpen(h => !h) }
    }
    const up = (e: KeyboardEvent) => { if (e.key === 'Tab') tabDown.current = false }
    const blur = () => { tabDown.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  })

  const ready = !meLoading && !loading && today !== null
  const filterPersonName = person ? (names.get(person) ?? null) : null
  const filterCount = (person ? 1 : 0) + (client ? 1 : 0)
  const linkOf = (t: TodoRow) => (t.client_id ? { label: clientNames.get(t.client_id) ?? null } : null)
  const meta = (t: TodoRow) => ({ subs: subCount.get(t.id) ?? 0, comments: commentCount.get(t.id) ?? 0, files: todoFilesOf(t.files).length, likes: idsOf(t.likes).length, blocked: openBlockers(t, visibleAll).length })
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<string | null>(null)
  const tool = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium'

  return (
    // the sidebar in its own column; everything else in the second (Asana's layout)
    <div className="grid min-h-0 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] md:gap-x-6 md:[&>*:not([data-todo-nav])]:col-start-2" data-todos-page>
      <div data-todo-nav className="md:col-start-1 md:row-start-1 md:[grid-row:1/span_999]">
        <TodoSidebar place={place} onPlace={goPlace} projects={projects} unread={inbox.unread} everyone={viewer?.role === 'super_admin'} />
      </div>
      <header className="flex flex-col border-b border-border">
        <div className="flex h-14 items-center gap-2.5">
          {project ? <ProjectIcon p={project} size={28} /> : <Avatar name={(me && names.get(me.id)) || 'Me'} size="md" />}
          <h1 className="text-[20px] font-semibold tracking-tight">
            {place === 'inbox' ? 'Inbox' : place === 'all' ? 'Everyone’s tasks' : project ? project.name : projectId ? 'Project' : 'My tasks'}
          </h1>
          {project && <span className="text-[13px] text-muted-foreground">everyone&rsquo;s tasks for this client, by who is doing them</span>}
          <button type="button" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><Keyboard className="h-4 w-4" aria-hidden /></button>
        </div>
        <nav className={`flex h-9 items-end gap-5 ${place === 'inbox' ? 'hidden' : ''}`} role="tablist" aria-label="Views">
          {VIEWS.map(v => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => pickView(v.key)}
              className={`border-b-2 pb-1.5 text-[14px] font-medium ${view === v.key ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {v.label}
            </button>
          ))}
        </nav>
      </header>

      <div className={`flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border py-2 ${place === 'inbox' ? 'hidden' : ''}`}>
        {viewer && (
          <button type="button" onClick={startAdd}
            title="Add task (Tab + Q)" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[13px] font-semibold text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4" aria-hidden /> Add task
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filters">
          <div className="inline-flex items-center" role="tablist" aria-label="Incomplete or completed">
            {(['open', 'done', 'all'] as const).map(s => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`${tool} ${status === s ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                {s === 'open' ? 'Incomplete' : s === 'done' ? 'Completed' : 'All tasks'}
              </button>
            ))}
          </div>
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(o => !o)}
            className={`${tool} ${filtersOpen || filterCount ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
            <Filter className="h-3.5 w-3.5" aria-hidden /> Filter{filterCount ? `: ${filterCount}` : ''}
          </button>
          {view === 'list' && (
            <>
              <Select value={sort} onValueChange={v => pickSort(v as TodoSort)}>
                <SelectTrigger className={`${tool} w-auto border-0 bg-transparent text-muted-foreground shadow-none hover:bg-muted ${sort !== 'due' ? 'bg-foreground/[0.08] text-foreground' : ''}`} aria-label="Sort">
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden /><span>Sort: {TODO_SORTS.find(s => s.key === sort)?.label}</span>
                </SelectTrigger>
                <SelectContent>{TODO_SORTS.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={groupBy} onValueChange={v => pickGroup(v as TodoGroupBy)}>
                <SelectTrigger className={`${tool} w-auto border-0 bg-transparent text-muted-foreground shadow-none hover:bg-muted ${groupBy !== 'date' ? 'bg-foreground/[0.08] text-foreground' : ''}`} aria-label="Group">
                  <Layers className="h-3.5 w-3.5" aria-hidden /><span>Group: {TODO_GROUP_BYS.find(s => s.key === groupBy)?.label}</span>
                </SelectTrigger>
                <SelectContent>{TODO_GROUP_BYS.filter(s => s.key !== 'project' || !!projectId).map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </>
          )}
          <span className="relative">
            <button type="button" aria-expanded={optionsOpen} aria-label="Options" onClick={() => setOptionsOpen(o => !o)} className={`${tool} text-muted-foreground hover:bg-muted`}><MoreHorizontal className="h-4 w-4" aria-hidden /> Options</button>
            {optionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-1 text-[13px] shadow-lg">
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 hover:bg-muted">
                  <input type="checkbox" checked={celebrate} onChange={e => { setCelebrate(e.target.checked); store.set('mdm.todos.celebrate', e.target.checked ? '1' : '0') }} />
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Celebrations when I complete a task
                </label>
                <button type="button" onClick={() => { setOptionsOpen(false); setHelpOpen(true) }} className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left hover:bg-muted"><Keyboard className="h-3.5 w-3.5" aria-hidden /> Keyboard shortcuts</button>
              </div>
            )}
          </span>
          {(filterCount > 0 || status !== 'open') && (
            <button type="button" onClick={() => { setPerson(''); setClient(''); setStatus('open') }} className="inline-flex h-8 items-center px-2 text-[12px] text-muted-foreground underline-offset-4 hover:underline">Clear</button>
          )}
        </div>
        {filtersOpen && (
          <div className="flex w-full flex-wrap items-center gap-2 pt-1">
            {(canFilterPeople || !!projectId) && place !== 'mine' && (
              <Select value={person || 'everyone'} onValueChange={v => setPerson(v === 'everyone' ? '' : v)}>
                <SelectTrigger className="h-8 w-52 rounded-md text-[13px]" aria-label="Whose to-dos"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  {people.map(p => <SelectItem key={p.id} value={p.id}>{p.id === me?.id ? 'Me' : p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={client || 'all'} onValueChange={v => setClient(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 w-52 rounded-md text-[13px]" aria-label="Which client"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {activeClients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {!ready ? (
        <div className="flex flex-col pt-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="my-[9px] h-[19px] w-1/3 rounded" />)}</div>
      ) : place === 'inbox' ? (
        <TodoInbox items={inbox.items} today={today!} onOpen={id => openTask(id)} markRead={inbox.markRead} />
      ) : view === 'list' ? (
        <div role="table" aria-label="To-dos" aria-multiselectable className="overflow-x-auto pb-28 md:[&>*]:min-w-max">
          <div role="row" style={gridCols} className={`${GRID} sticky top-0 z-10 border-b border-border bg-background text-[12px] text-muted-foreground`}>
            <div role="columnheader" className="flex h-9 items-center pl-8">Task name</div>
            {['Due date', 'Assignee', 'Client', ...fieldDefs.map(f => f.name)].map(h => <div key={h} role="columnheader" className={`${CELL} h-9`}>{h}</div>)}
          </div>
          {shown.length === 0 && status !== 'open' && (
            <p className="px-8 py-6 text-[14px] text-muted-foreground">{todosEmptyWords({ status, person: person || null, client: client || null }, filterPersonName)}</p>
          )}
          {listGroups.map(g => {
            const shut = collapsed.has(g.key)
            return (
              <section key={g.key} aria-label={g.label} data-todo-section={g.key}
                onDragOver={e => { if (dragId) { e.preventDefault(); if (!(e.target as HTMLElement).closest?.('[data-todo]')) setDropAt(`group:${g.key}`) } }}
                onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/todo'); const before = dropAt?.startsWith('row:') ? dropAt.slice(4) : null; setDropAt(null); setDragId(null); if (id) dropRow(id, g, before) }}
                className={dropAt === `group:${g.key}` ? 'rounded bg-accent-blue-deep/5' : ''}>
                <SectionHeader g={g} shut={shut} editable={!!g.sectionId || !!g.projectSectionId}
                  onToggle={() => setCollapsed(c => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}
                  onRename={name => void (g.projectSectionId
                    ? send(`/api/todo-project-sections/${g.projectSectionId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
                    : send(`/api/todo-sections/${g.sectionId}`, { method: 'PATCH', body: JSON.stringify({ name }) }))}
                  onDelete={() => void (g.projectSectionId
                    ? send(`/api/todo-project-sections/${g.projectSectionId}`, { method: 'DELETE' }, 'Section deleted — its tasks stay on the project')
                    : send(`/api/todo-sections/${g.sectionId}`, { method: 'DELETE' }, 'Section deleted — its tasks moved to Recently assigned'))}
                  onAdd={() => setAdding(g.key)} />
                {!shut && (
                  <div role="rowgroup">
                    {g.rows.map(t => (
                      <TaskRow key={t.id} t={t} today={today!} open={openId === t.id} picked={selected.has(t.id)} editable={mayEditTodo(viewer, t as never)}
                        owner={t.owner_id ? (t.owner_id === me?.id ? 'Me' : names.get(t.owner_id) ?? 'Someone') : null}
                        ownerName={t.owner_id ? names.get(t.owner_id) ?? '?' : null}
                        link={linkOf(t)} meta={meta(t)} dropBefore={dropAt === `row:${t.id}`}
                        onOpen={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) pick(t.id, e); else { if (selected.size) setSelected(new Set()); openTask(t.id) } }}
                        onPick={e => pick(t.id, e)} onTick={d => void tick(t, d)}
                        onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setDropAt(null) }}
                        onDragOverRow={() => { if (dragId && dragId !== t.id) setDropAt(`row:${t.id}`) }}
                        onRename={title => void patchTodo(t.id, { title })}
                        gridStyle={gridCols} fieldDefs={fieldDefs} onField={(fid, v) => void patchTodo(t.id, { fields: { [fid]: v } })} />
                    ))}
                    {viewer && g.key !== 'done' && (adding === g.key ? (
                      <NewRow onCancel={() => setAdding(null)} onAdd={title => create(title, g)} />
                    ) : (
                      <button type="button" onClick={() => setAdding(g.key)} className="flex h-[37px] w-full items-center pl-8 text-left text-[14px] text-muted-foreground hover:bg-muted/60">Add task…</button>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
          {viewer && groupBy === 'project' && projectId && (newSection !== null ? (
            <input autoFocus value={newSection} placeholder="Name the section, then press Enter" aria-label="New section name" onChange={e => setNewSection(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { void addProjectSection(newSection); setNewSection(null) } if (e.key === 'Escape') setNewSection(null) }}
              onBlur={() => { if (newSection.trim()) void addProjectSection(newSection); setNewSection(null) }}
              className="mt-3 h-9 w-72 rounded-md border border-border bg-background px-2 text-[14px] outline-none" />
          ) : (
            <button type="button" onClick={() => setNewSection('')} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[14px] font-medium text-muted-foreground hover:bg-muted">
              <Plus className="h-4 w-4" aria-hidden /> Add section
            </button>
          ))}
          {viewer && groupBy === 'sections' && (newSection !== null ? (
            <input autoFocus value={newSection} placeholder="Name the section, then press Enter" aria-label="New section name" onChange={e => setNewSection(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { void addSection(newSection); setNewSection(null) } if (e.key === 'Escape') setNewSection(null) }}
              onBlur={() => { if (newSection.trim()) void addSection(newSection); setNewSection(null) }}
              className="mt-3 h-10 w-80 rounded-md border border-border bg-transparent px-3 text-[16px] font-medium outline-none focus:border-foreground/30" />
          ) : (
            <button type="button" onClick={() => setNewSection('')} title="Add section (Tab + N)" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[14px] font-medium text-muted-foreground hover:bg-muted">
              <Plus className="h-4 w-4" aria-hidden /> Add section
            </button>
          ))}
          {viewer && groupBy !== 'sections' && sections.length === 0 && (
            <button type="button" onClick={() => { pickGroup('sections'); setNewSection('') }} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted">
              <Plus className="h-4 w-4" aria-hidden /> Add your own section
            </button>
          )}
        </div>
      ) : view === 'board' ? (
        projectId && groupBy === 'project' ? (
          <Board groups={listGroups as never} today={today!} names={names} openId={openId} viewer={viewer}
            link={linkOf} meta={meta} onOpen={openTask} onTick={(t, d) => void tick(t, d)} onMove={moveTo}
            onDropTo={(id, key) => { const g = listGroups.find(x => x.key === key); if (g) dropRow(id, g, null) }}
            onAdd={(title, key) => create(title, listGroups.find(x => x.key === key) ?? null)} addNonce={addNonce} />
        ) : (
          <Board groups={boardGroups} today={today!} names={names} openId={openId} viewer={viewer}
            link={linkOf} meta={meta} onOpen={openTask} onTick={(t, d) => void tick(t, d)} onMove={moveTo} onAdd={(title, key) => create(title, null, dueForGroup(key, today!))} addNonce={addNonce} />
        )
      ) : (
        <CalendarView rows={shown} today={today!} names={names} openId={openId} onOpen={openTask} onMove={moveTo} onAdd={(title, day) => create(title, null, day)} canAdd={!!viewer} addNonce={addNonce} />
      )}

      {/* THE BAR FOR SEVERAL SELECTED TASKS */}
      {chosen.length > 0 && (
        <div role="toolbar" aria-label={`${chosen.length} selected`} data-todo-bulk
          className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-1 rounded-lg border border-border bg-popover px-3 py-2 text-[13px] shadow-xl">
          <span className="px-1 font-semibold">{chosen.length} selected</span>
          <button type="button" onClick={() => void bulk({ status: 'done' }, 'Marked complete')} className="h-8 rounded-md px-2.5 font-medium hover:bg-muted">Mark complete</button>
          <label className="flex h-8 items-center gap-1 rounded-md px-2 hover:bg-muted">Due
            <input type="date" aria-label="Due date for the selected tasks" onChange={e => { if (e.target.value) void bulk({ due_date: e.target.value }, 'Due date set') }} className="bg-transparent text-[13px]" />
          </label>
          <Select onValueChange={v => void bulk({ owner_id: v }, 'Reassigned')}>
            <SelectTrigger className="h-8 w-40 rounded-md border-0 bg-transparent text-[13px] hover:bg-muted" aria-label="Assign the selected tasks"><SelectValue placeholder="Assign to…" /></SelectTrigger>
            <SelectContent>{people.map(p => <SelectItem key={p.id} value={p.id}>{p.id === me?.id ? 'Me' : p.name}</SelectItem>)}</SelectContent>
          </Select>
          {sections.length > 0 && (
            <Select onValueChange={v => void bulk({ section_id: v === 'none' ? null : v }, 'Moved')}>
              <SelectTrigger className="h-8 w-44 rounded-md border-0 bg-transparent text-[13px] hover:bg-muted" aria-label="Move the selected tasks to a section"><SelectValue placeholder="Move to section…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Recently assigned</SelectItem>
                {sections.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {bulkDelete ? (
            <span className="flex items-center gap-1 rounded-md bg-accent-red-deep/10 px-2">Delete {chosen.length}?
              <button type="button" onClick={() => setBulkDelete(false)} className="h-8 rounded-md px-2 hover:bg-muted">Keep</button>
              <button type="button" onClick={() => void removeChosen()} className="h-8 rounded-md bg-accent-red-deep px-2.5 font-semibold text-background">Delete</button>
            </span>
          ) : (
            <button type="button" onClick={() => setBulkDelete(true)} className="h-8 rounded-md px-2.5 font-medium text-accent-red-deep hover:bg-muted">Delete</button>
          )}
          <button type="button" aria-label="Clear the selection" onClick={() => setSelected(new Set())} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
        </div>
      )}

      {helpOpen && (
        <div role="dialog" aria-label="Keyboard shortcuts" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHelpOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-popover p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-[16px] font-semibold">Keyboard shortcuts</h2>
              <button type="button" aria-label="Close" onClick={() => setHelpOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button></div>
            <dl className="flex flex-col gap-1.5 text-[13px]">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{v}</dt><dd><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[12px]">{k}</kbd></dd></div>
              ))}
            </dl>
          </div>
        </div>
      )}

      <Celebration key={party} run={party > 0} />

      {open && viewer && today && (
        <TodoPanel key={open.id} t={open} all={visibleAll} today={today} viewer={viewer} people={people} clients={activeClients}
          names={names} clientNames={clientNames} onTick={d => void tick(open, d)} fieldDefs={fieldDefs} projectSections={projectSectionRows}
          onClose={() => openTask(null)} onOpen={id => openTask(id)} onDeleted={() => openTask(open.parent_id ?? null)} />
      )}
    </div>
  )
}

function SectionHeader({ g, shut, editable, onToggle, onRename, onDelete, onAdd }: {
  g: TodoGroup<TodoRow>; shut: boolean; editable: boolean
  onToggle: () => void; onRename: (name: string) => void; onDelete: () => void; onAdd: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(g.label)
  const [menu, setMenu] = useState(false)
  const [sure, setSure] = useState(false)
  useEffect(() => { if (!editing) setName(g.label) }, [g.label, editing])
  return (
    <div className="group/sec flex h-11 items-center gap-1 pt-2">
      <button type="button" aria-expanded={!shut} aria-label={`${shut ? 'Open' : 'Fold'} ${g.label}`} onClick={onToggle}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted">
        {shut ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
      </button>
      {editing ? (
        <input autoFocus value={name} aria-label="Section name" onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(g.label); setEditing(false) } }}
          onBlur={() => { setEditing(false); if (name.trim() && name.trim() !== g.label) onRename(name.trim()) }}
          className="h-8 rounded border border-border bg-transparent px-1.5 text-[16px] font-medium outline-none" />
      ) : (
        <h2 onDoubleClick={() => editable && setEditing(true)} className={`text-[16px] font-medium ${g.tone === 'red' ? 'text-accent-red-deep' : ''}`}>{g.label}</h2>
      )}
      <span className="ml-1 text-[12px] text-muted-foreground">{shut || g.rows.length ? g.rows.length : ''}</span>
      <button type="button" aria-label={`Add a task to ${g.label}`} onClick={onAdd} className="ml-1 flex h-7 w-7 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted focus:opacity-100 group-hover/sec:opacity-100"><Plus className="h-4 w-4" aria-hidden /></button>
      {editable && (
        <span className="relative">
          <button type="button" aria-label={`More for ${g.label}`} aria-expanded={menu} onClick={() => setMenu(m => !m)} className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted focus:opacity-100 group-hover/sec:opacity-100"><MoreHorizontal className="h-4 w-4" aria-hidden /></button>
          {menu && (
            <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-popover p-1 text-[13px] shadow-lg">
              <button type="button" onClick={() => { setMenu(false); setEditing(true) }} className="flex min-h-9 w-full items-center rounded px-2 text-left hover:bg-muted">Rename section</button>
              {sure ? (
                <span className="flex min-h-9 items-center justify-between gap-1 px-2">Delete it?
                  <button type="button" onClick={() => { setSure(false); setMenu(false); onDelete() }} className="h-8 rounded bg-accent-red-deep px-2 font-semibold text-background">Delete</button></span>
              ) : (
                <button type="button" onClick={() => setSure(true)} className="flex min-h-9 w-full items-center rounded px-2 text-left text-accent-red-deep hover:bg-muted">Delete section</button>
              )}
            </div>
          )}
        </span>
      )}
    </div>
  )
}

type Meta = { subs: number; comments: number; files: number; likes: number; blocked: number }
function MetaIcons({ m }: { m: Meta }) {
  return (
    <>
      {m.blocked > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-accent-red-deep" title={`Waiting on ${m.blocked} open task${m.blocked === 1 ? '' : 's'}`}><Hourglass className="h-3 w-3" aria-hidden />{m.blocked}</span>}
      {m.subs > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-muted-foreground" title={`${m.subs} subtask${m.subs === 1 ? '' : 's'}`}>{m.subs}<GitBranch className="h-3 w-3" aria-hidden /></span>}
      {m.comments > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-muted-foreground" title={`${m.comments} comment${m.comments === 1 ? '' : 's'}`}>{m.comments}<MessageSquare className="h-3 w-3" aria-hidden /></span>}
      {m.files > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-muted-foreground" title={`${m.files} file${m.files === 1 ? '' : 's'}`}>{m.files}<Paperclip className="h-3 w-3" aria-hidden /></span>}
      {m.likes > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-muted-foreground" title={`${m.likes} like${m.likes === 1 ? '' : 's'}`}>{m.likes}<ThumbsUp className="h-3 w-3" aria-hidden /></span>}
    </>
  )
}

function LinkChip({ link }: { link: { label: string | null } | null }) {
  if (!link?.label) return null
  return <span className="truncate rounded bg-foreground/[0.06] px-1.5 py-0.5">{link.label}</span>
}

type Mods = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
function TaskRow({ t, today, open, picked, editable, owner, ownerName, link, meta, dropBefore, onOpen, onPick, onTick, onRename, onDragStart, onDragEnd, onDragOverRow, gridStyle, fieldDefs = [], onField }: {
  gridStyle?: React.CSSProperties; fieldDefs?: TodoFieldDef[]; onField?: (fieldId: string, value: string | number | null) => void
  t: TodoRow; today: string; open: boolean; picked: boolean; editable: boolean
  owner: string | null; ownerName: string | null; link: { label: string | null } | null; meta: Meta; dropBefore: boolean
  onOpen: (e: Mods) => void; onPick: (e: Mods) => void; onTick: (done: boolean) => void; onRename: (title: string) => void
  onDragStart: () => void; onDragEnd: () => void; onDragOverRow: () => void
}) {
  const done = t.status === 'done'
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(t.title)
  useEffect(() => { if (!editing) setTitle(t.title) }, [t.title, editing])
  const commit = () => { setEditing(false); const v = title.trim(); if (v && v !== t.title) onRename(v); else setTitle(t.title) }
  return (
    <div role="row" aria-selected={picked} data-todo data-todo-id={t.id} onClick={e => onOpen(e)} style={gridStyle}
      draggable={editable && !editing} onDragStart={e => { e.dataTransfer.setData('text/todo', t.id); e.dataTransfer.effectAllowed = 'move'; onDragStart() }} onDragEnd={onDragEnd}
      onDragOver={e => { e.preventDefault(); onDragOverRow() }}
      className={`group relative ${GRID} cursor-pointer border-b border-border ${picked ? 'bg-accent-blue-deep/15' : open ? 'bg-accent-blue-deep/10' : 'hover:bg-muted/60'} ${dropBefore ? 'shadow-[inset_0_2px_0_0_var(--tw-shadow-color)] shadow-accent-blue-deep' : ''}`}>
      <div role="cell" className="flex h-[37px] min-w-0 items-center gap-1 pr-2">
        {/* the gutter: a drag handle, and a tick box for selecting several */}
        <span className="-ml-6 flex w-6 shrink-0 items-center">
          <input type="checkbox" checked={picked} aria-label={`Select ${t.title}`} onClick={e => { e.stopPropagation(); onPick({ shiftKey: e.shiftKey, metaKey: true, ctrlKey: true }) }} onChange={() => {}}
            className={`h-3.5 w-3.5 ${picked ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`} />
        </span>
        {editable && <GripVertical className="-ml-1 h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-60" aria-hidden />}
        <CheckCircle done={done} disabled={!editable} label={done ? `Mark ${t.title} incomplete` : `Mark ${t.title} complete`} onClick={() => onTick(!done)} />
        {editing ? (
          <input autoFocus value={title} aria-label="Task name" onClick={e => e.stopPropagation()} onChange={e => setTitle(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTitle(t.title); setEditing(false) } }}
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[14px] outline-none focus:border-foreground/40" />
        ) : (
          <span onClick={e => { if (editable && !(e.metaKey || e.ctrlKey || e.shiftKey)) { e.stopPropagation(); setEditing(true) } }}
            className={`min-w-0 truncate rounded px-1 text-[14px] ${done ? 'text-muted-foreground' : ''} ${editable ? 'cursor-text hover:outline hover:outline-1 hover:outline-border' : ''}`}>{t.title}</span>
        )}
        <MetaIcons m={meta} />
        <span className="ml-auto hidden shrink-0 items-center gap-0.5 text-[12px] text-muted-foreground group-hover:inline-flex">Details <ChevronRight className="h-3.5 w-3.5" aria-hidden /></span>
      </div>
      <div role="cell" className={`${CELL} ${dueTone(t.due_date, today, done)}`}>
        {t.due_date ? shortDue(t.due_date, today) : <Calendar className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60" aria-hidden />}
        {/* repeats, as Asana marks it beside the date (20 Oct 2026) */}
        {normaliseRepeat((t as { repeat?: unknown }).repeat) && (
          <Repeat className="ml-1 h-3.5 w-3.5 shrink-0" aria-label={repeatWords(normaliseRepeat((t as { repeat?: unknown }).repeat))} />
        )}
      </div>
      <div role="cell" className={CELL}>
        {owner && <span className="flex min-w-0 items-center gap-1.5"><Avatar name={ownerName ?? '?'} /><span className="truncate">{owner}</span></span>}
      </div>
      <div role="cell" className={CELL}><LinkChip link={link} /></div>
      {fieldDefs.map(def => (
        <div key={def.id} role="cell" className={CELL} onClick={e => e.stopPropagation()}>
          <FieldControl def={def} compact editable={editable && !!onField} value={((t as { fields?: Record<string, unknown> | null }).fields ?? {})[def.id]}
            onChange={v => onField?.(def.id, v)} />
        </div>
      ))}
    </div>
  )
}

/** the inline row Asana opens: type, Enter adds and keeps the row open for the next, Esc stops */
function NewRow({ onAdd, onCancel }: { onAdd: (title: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('')
  return (
    <div className="flex h-[37px] items-center border-b border-border">
      <span className="flex h-9 w-8 shrink-0 items-center justify-center"><span className="h-4 w-4 rounded-full border border-muted-foreground/60" /></span>
      <input autoFocus value={v} placeholder="Write a task name, then press Enter" aria-label="New task name" onChange={e => setV(e.target.value)}
        onBlur={() => { if (v.trim()) onAdd(v.trim()); onCancel() }}
        onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV('') } if (e.key === 'Escape') onCancel() }}
        className="h-7 min-w-0 flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-muted-foreground" />
    </div>
  )
}

/** BOARD — one column per date section; drag a card to another to give it that date (Done completes it) */
function Board({ groups, today, names, openId, viewer, link, meta, onOpen, onTick, onMove, onAdd, onDropTo, addNonce = 0 }: {
  /** the page's Add task, pressed: a new card at the end of the first column */
  addNonce?: number
  /** a project's board: a card dropped on a column moves it to that section, not a date */
  onDropTo?: (id: string, key: string) => void
  groups: { key: TodoGroupKey; label: string; rows: TodoRow[] }[]; today: string; names: Map<string, string>; openId: string | null
  viewer: { id: string; role: string } | null
  link: (t: TodoRow) => { label: string | null } | null; meta: (t: TodoRow) => Meta
  onOpen: (id: string) => void; onTick: (t: TodoRow, done: boolean) => void; onMove: (id: string, due: string | null, done?: boolean) => void; onAdd: (title: string, key: TodoGroupKey) => void
}) {
  const [over, setOver] = useState<string | null>(null)
  const [adding, setAdding] = useState<TodoGroupKey | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (!addNonce) return
    const first = groups.find(g => g.key !== 'done')
    if (first) { setDraft(''); setAdding(first.key) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNonce])
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-24 pt-3" aria-label="Board">
      {groups.map(g => (
        <section key={g.key} aria-label={g.label} data-todo-column={g.key}
          onDragOver={e => { e.preventDefault(); setOver(g.key) }} onDragLeave={() => setOver(o => (o === g.key ? null : o))}
          onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/todo'); if (!id) return; if (onDropTo) onDropTo(id, g.key); else onMove(id, g.key === 'done' ? null : dueForGroup(g.key, today), g.key === 'done') }}
          className={`flex w-[272px] shrink-0 flex-col gap-2 rounded-lg p-2 ${over === g.key ? 'bg-accent-blue-deep/10' : 'bg-muted/50'}`}>
          <h2 className={`flex h-8 items-center gap-2 px-1 text-[14px] font-semibold ${g.key === 'overdue' ? 'text-accent-red-deep' : ''}`}>{g.label}<span className="text-[12px] font-normal text-muted-foreground">{g.rows.length}</span></h2>
          {g.rows.map(t => {
            const done = t.status === 'done'
            const editable = mayEditTodo(viewer, t as never)
            const l = link(t)
            return (
              <article key={t.id} draggable={editable} onDragStart={e => e.dataTransfer.setData('text/todo', t.id)} onClick={() => onOpen(t.id)} data-todo-card
                className={`flex cursor-pointer flex-col gap-2 rounded-md border bg-card p-3 shadow-sm hover:border-foreground/30 ${openId === t.id ? 'border-accent-blue-deep' : 'border-border'}`}>
                <div className="-ml-2 -mt-2 flex items-start">
                  <CheckCircle done={done} disabled={!editable} label={done ? `Mark ${t.title} incomplete` : `Mark ${t.title} complete`} onClick={() => onTick(t, !done)} />
                  <span className={`pt-2 text-[14px] leading-snug ${done ? 'text-muted-foreground' : ''}`}>{t.title}</span>
                </div>
                {l?.label && <span className="text-[12px]"><LinkChip link={l} /></span>}
                <div className="flex items-center gap-2">
                  {t.owner_id && <Avatar name={names.get(t.owner_id) ?? '?'} />}
                  {t.due_date && <span className={`text-[12px] ${dueTone(t.due_date, today, done)}`}>{shortDue(t.due_date, today)}</span>}
                  <span className="ml-auto flex items-center gap-2"><MetaIcons m={meta(t)} /></span>
                </div>
              </article>
            )
          })}
          {viewer && g.key !== 'done' && (adding === g.key ? (
            <textarea autoFocus value={draft} rows={2} placeholder="Write a task name" aria-label="New task name" onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) onAdd(draft.trim(), g.key); setDraft('') } if (e.key === 'Escape') { setAdding(null); setDraft('') } }}
              onBlur={() => { if (draft.trim()) onAdd(draft.trim(), g.key); setDraft(''); setAdding(null) }}
              className="resize-none rounded-md border border-border bg-card p-3 text-[14px] outline-none focus:border-foreground/30" />
          ) : (
            <button type="button" onClick={() => setAdding(g.key)} className="flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted">
              <Plus className="h-4 w-4" aria-hidden /> Add task
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

/** CALENDAR — a month by due date; drag a task to another day, press a day's + to add one there */
function CalendarView({ rows, today, names, openId, onOpen, onMove, onAdd, canAdd, addNonce = 0 }: {
  /** the page's Add task, pressed: a new task on today, in today's month */
  addNonce?: number
  rows: TodoRow[]; today: string; names: Map<string, string>; openId: string | null
  onOpen: (id: string) => void; onMove: (id: string, due: string | null) => void; onAdd: (title: string, day: string) => void; canAdd: boolean
}) {
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const days = useMemo(() => monthGrid(ym.y, ym.m), [ym])
  const byDay = useMemo(() => { const m = new Map<string, TodoRow[]>(); for (const t of rows) if (t.due_date) m.set(t.due_date, [...(m.get(t.due_date) ?? []), t]); return m }, [rows])
  // WHEN A REPEATING TASK COMES ROUND (Manal, 20 Oct 2026: "I can't see in my calendar when it's gonna pop up next …
  // add a little code for the colour"): its next dates, faded and marked, until the real one is made
  const repeatsByDay = useMemo(() => {
    const m = new Map<string, TodoRow[]>()
    for (const t of rows) {
      if (t.status === 'done' || !t.due_date) continue
      for (const d of upcomingDues(normaliseRepeat(t.repeat), t.due_date, 14)) m.set(d, [...(m.get(d) ?? []), t])
    }
    return m
  }, [rows])
  const undated = rows.filter(t => !t.due_date).length
  const [over, setOver] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (!addNonce || !canAdd) return
    setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })
    setDraft(''); setAdding(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addNonce])
  const step = (d: number) => setYm(({ y, m }) => { const n = new Date(Date.UTC(y, m + d, 1)); return { y: n.getUTCFullYear(), m: n.getUTCMonth() } })
  return (
    <div className="flex flex-col gap-2 pb-24 pt-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })} className="h-8 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted">Today</button>
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><ChevronRight className="h-4 w-4" aria-hidden /></button>
        <h2 className="text-[16px] font-medium">{MONTH_NAMES[ym.m]} {ym.y}</h2>
        {undated > 0 && <span className="ml-auto text-[12px] text-muted-foreground">{undated} with no date — on the List</span>}
      </div>
      <div className="grid grid-cols-7 border-l border-t border-border text-[12px]">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="border-b border-r border-border px-2 py-1.5 text-muted-foreground">{d}</div>)}
        {days.map(day => {
          const inMonth = Number(day.slice(5, 7)) - 1 === ym.m
          const list = byDay.get(day) ?? []
          return (
            <div key={day} data-day={day}
              onDragOver={e => { e.preventDefault(); setOver(day) }} onDragLeave={() => setOver(o => (o === day ? null : o))}
              onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/todo'); if (id) onMove(id, day) }}
              className={`group flex min-h-[112px] min-w-0 flex-col gap-1 border-b border-r border-border p-1 ${over === day ? 'bg-accent-blue-deep/10' : inMonth ? '' : 'bg-muted/40'}`}>
              <div className="flex items-center justify-between">
                <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${day === today ? 'bg-accent-red-deep font-semibold text-background' : inMonth ? '' : 'text-muted-foreground'}`}>{Number(day.slice(8))}</span>
                {canAdd && <button type="button" aria-label={`Add a task on ${day}`} onClick={() => { setAdding(day); setDraft('') }} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100"><Plus className="h-3.5 w-3.5" aria-hidden /></button>}
              </div>
              {list.map(t => (
                <button key={t.id} type="button" draggable onDragStart={e => e.dataTransfer.setData('text/todo', t.id)} onClick={() => onOpen(t.id)} data-todo-chip
                  title={`${t.title}${t.owner_id ? ` · ${names.get(t.owner_id) ?? ''}` : ''}`}
                  className={`truncate rounded px-1.5 py-1 text-left text-[12px] ${t.status === 'done' ? 'text-muted-foreground line-through' : ''} ${openId === t.id ? 'bg-accent-blue-deep/20' : t.due_date && t.due_date < today && t.status !== 'done' ? 'bg-accent-red-deep/10' : 'bg-foreground/[0.06]'} hover:bg-foreground/10`}>
                  {t.title}
                </button>
              ))}
              {(repeatsByDay.get(day) ?? []).map(t => (
                <button key={`again:${t.id}`} type="button" onClick={() => onOpen(t.id)} data-todo-repeat
                  title={`${t.title} — comes round again on this day (${repeatWords(normaliseRepeat(t.repeat))})`}
                  className="flex min-w-0 items-center gap-1 truncate rounded border border-dashed border-accent-blue/50 bg-accent-blue/[0.06] px-1.5 py-1 text-left text-[12px] text-accent-blue-deep hover:bg-accent-blue/10">
                  <Repeat className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{t.title}</span>
                </button>
              ))}
              {adding === day && (
                <input autoFocus value={draft} placeholder="Task name" aria-label="New task name" onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { onAdd(draft.trim(), day); setDraft(''); setAdding(null) } if (e.key === 'Escape') setAdding(null) }}
                  onBlur={() => { if (draft.trim()) onAdd(draft.trim(), day); setAdding(null) }}
                  className="h-7 rounded border border-border bg-card px-1.5 text-[12px] outline-none" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

