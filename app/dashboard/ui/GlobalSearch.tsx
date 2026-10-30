'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, LayoutList, MessageSquare, Search, User, X } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import { useRole } from '../useRole'
import { hiddenFrom, hiddenProjectsFor, isOnTodo } from '../../lib/todo-core'
import { personLabel } from '../../lib/identity-core'
import {
  FIRST_SHOWN, SEARCH_KINDS, addRecent, highlightParts, plainText, readRecents, searchAll, snippet,
  type RecentPick, type SearchComment, type SearchKind, type SearchPerson, type SearchTask,
} from '../../lib/global-search-core'
import { ProjectIcon, type Project } from '../todos/TodoNav'

/**
 * THE SEARCH BAR, AS ASANA'S (the owner, 27 Oct 2026, Asana side by side: "that's not how the search feature in Asana
 * is"). Pressing the box opens it in place — the box grows into a panel, chips under it (Tasks, Projects, People,
 * Messages) and, before anything is typed, Recents: what was last opened from here. Typing drops the matches by kind,
 * three of each with "Show more", the letters typed in bold; a chip looks at one kind only. A task opens on To-dos, a
 * project opens that client's project, a person opens their tasks, a message opens the task it was left on. Enter with
 * nothing picked asks the assistant, as the bar always has (16 Sep 2026).
 *
 * The tables are read only once somebody uses the bar, so a page that never searches pays nothing for it.
 */

type Row = { key: string; href: string; recent?: RecentPick }
const RECENTS_KEY = 'mdm.search.recent'
const KIND_ICON: Record<SearchKind, typeof Circle> = { tasks: CheckCircle2, projects: LayoutList, people: User, messages: MessageSquare }

const initials = (name: string) => {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '•'
}
/** a person's round mark, one steady colour per name, as Asana's */
function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <span aria-hidden title={name} style={{ width: size, height: size, background: `hsl(${h} 55% 45%)` }}
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white">{initials(name)}</span>
  )
}
/** the words with what was typed in bold */
function Marked({ text, q }: { text: string; q: string }) {
  return <>{highlightParts(text, q).map((p, i) => (p.hit ? <b key={i} className="font-bold">{p.text}</b> : <span key={i}>{p.text}</span>))}</>
}

export default function GlobalSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SearchKind | null>(null)
  const [hi, setHi] = useState(-1)
  const [used, setUsed] = useState(false)
  const [recents, setRecents] = useState<RecentPick[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const { rows: allTodos } = useTable<SearchTask & { id: string; created_by?: string | null; followers?: unknown }>('todos', { enabled: used })
  // a PRIVATE project's to-dos are its members' — search never finds them for anyone else (30 Oct 2026)
  const { me } = useRole()
  const { rows: ownProjects } = useTable<{ id: string; private?: boolean | null; member_ids?: unknown }>('todo_projects' as never, { enabled: used })
  const todos = useMemo(() => {
    if (!me) return []
    const viewer = { id: me.id, role: me.role, hiddenProjects: hiddenProjectsFor(me.id, ownProjects) }
    const kept = allTodos.filter(t => !hiddenFrom(viewer, t))
    const ids = new Set(kept.map(t => t.id))
    // a subtask goes with its parent — unless it is this person's own
    return kept.filter(t => !t.parent_id || ids.has(t.parent_id) || isOnTodo(me.id, t))
  }, [allTodos, ownProjects, me])
  const { rows: team } = useTable<{ id: string; name?: string | null; email?: string | null; role?: string | null; active_status?: boolean | null }>('team_users', { enabled: used })
  const { rows: allComments } = useTable<SearchComment & { id: string }>('todo_comments', { enabled: used })

  // the projects as the To-dos sidebar has them — each client with its logo or colour
  useEffect(() => {
    if (!used) return
    try { setRecents(readRecents(localStorage.getItem(RECENTS_KEY))) } catch { /* no storage: no recents */ }
    fetch('/api/todos/projects', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { projects: [] })).then(j => setProjects(j.projects ?? [])).catch(() => undefined)
  }, [used])

  const people = useMemo<SearchPerson[]>(() => team.filter(u => u.role !== 'client' && u.active_status !== false)
    .map(u => ({ id: u.id, name: personLabel(u.name ?? null, u.email ?? null), email: u.email ?? null })), [team])
  const personOf = useMemo(() => new Map(people.map(p => [p.id, p])), [people])
  const projectOf = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const taskOf = useMemo(() => new Map(todos.map(t => [t.id, t])), [todos])
  // messages only on to-dos this person may see
  const comments = useMemo(() => allComments.filter(c => taskOf.has(c.todo_id)), [allComments, taskOf])
  const found = useMemo(() => searchAll({ tasks: todos, projects, people, comments }, q), [todos, projects, people, comments, q])
  const typed = q.trim().length > 0

  const shown = (n: number, k: SearchKind) => (kind === null ? Math.min(n, FIRST_SHOWN) : kind === k ? Math.min(n, 30) : 0)
  const tasks = found.tasks.slice(0, shown(found.tasks.length, 'tasks'))
  const projs = found.projects.slice(0, shown(found.projects.length, 'projects'))
  const ppl = found.people.slice(0, shown(found.people.length, 'people'))
  const msgs = found.messages.slice(0, shown(found.messages.length, 'messages'))
  const recentRows = recents.filter(r => kind === null || (kind === 'tasks' && r.kind === 'task') || (kind === 'projects' && r.kind === 'project') || (kind === 'people' && r.kind === 'person'))
    .filter(r => (r.kind === 'task' ? taskOf.has(r.id) : r.kind === 'project' ? projectOf.has(r.id) : personOf.has(r.id)))

  const taskHref = (id: string) => `/dashboard/todos?task=${encodeURIComponent(id)}`
  const projectHref = (id: string) => `/dashboard/todos?project=${encodeURIComponent(id)}`
  const personHref = (id: string) => `/dashboard/todos?person=${encodeURIComponent(id)}`
  // the keyboard's order: the rows as drawn
  const rows: Row[] = typed ? [
    ...tasks.map(t => ({ key: `t${t.id}`, href: taskHref(t.id), recent: { kind: 'task' as const, id: t.id } })),
    ...projs.map(p => ({ key: `p${p.id}`, href: projectHref(p.id), recent: { kind: 'project' as const, id: p.id } })),
    ...ppl.map(p => ({ key: `u${p.id}`, href: personHref(p.id), recent: { kind: 'person' as const, id: p.id } })),
    ...msgs.map(m => ({ key: `m${m.id}`, href: taskHref(m.todo_id), recent: { kind: 'task' as const, id: m.todo_id } })),
  ] : recentRows.map(r => ({ key: `r${r.kind}${r.id}`, href: r.kind === 'task' ? taskHref(r.id) : r.kind === 'project' ? projectHref(r.id) : personHref(r.id), recent: r }))
  useEffect(() => { setHi(-1) }, [q, kind])

  // a click anywhere else closes it
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => { setOpen(false); setQ(''); setKind(null); input.current?.blur() }
  const go = (r: Row | undefined) => {
    if (!r) return
    if (r.recent) {
      const next = addRecent(recents, r.recent)
      setRecents(next)
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch { /* fine */ }
    }
    close()
    router.push(r.href)
    // To-dos already open stays mounted and does not re-read its address: it hears the pick instead
    if (location.pathname.startsWith('/dashboard/todos')) window.dispatchEvent(new CustomEvent('mdm:todos-link', { detail: r.href }))
  }
  const ask = () => { if (!typed) return; const t = q.trim(); close(); router.push(`/dashboard/ai?q=${encodeURIComponent(t)}`) }

  let at = -1
  const option = (r: Row, children: ReactNode) => {
    const i = ++at
    return (
      <button key={r.key} type="button" role="option" aria-selected={hi === i} onMouseEnter={() => setHi(i)} onClick={() => go(r)}
        className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-[14px] ${hi === i ? 'bg-muted' : 'hover:bg-muted/70'}`}>
        {children}
      </button>
    )
  }
  const taskLine = (t: SearchTask, r: Row) => {
    const owner = t.owner_id ? personOf.get(t.owner_id) : null
    const proj = t.client_id ? projectOf.get(t.client_id) : null
    return option(r, <>
      {t.status === 'done' ? <CheckCircle2 className="h-[18px] w-[18px] shrink-0 fill-accent-green text-white" aria-label="Done" /> : <Circle className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate"><Marked text={t.title} q={q} /></span>
        {proj && <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground"><span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: proj.colour }} /><span className="truncate">{proj.name}</span></span>}
      </span>
      {owner && <Avatar name={owner.name} />}
    </>)
  }
  const projectLine = (p: Project, r: Row) => option(r, <>
    <ProjectIcon p={p} size={22} />
    <span className="min-w-0 flex-1 truncate"><Marked text={p.name} q={q} /></span>
    {p.open > 0 && <span className="shrink-0 text-[12px] text-muted-foreground">{p.open} open</span>}
  </>)
  const personLine = (p: SearchPerson, r: Row) => option(r, <>
    <Avatar name={p.name} />
    <span className="shrink-0 truncate"><Marked text={p.name} q={q} /></span>
    {p.email && <span className="min-w-0 truncate text-[12px] text-muted-foreground"><Marked text={p.email} q={q} /></span>}
  </>)
  const messageLine = (m: SearchComment, r: Row) => {
    const task = taskOf.get(m.todo_id)
    const who = m.author_id ? personOf.get(m.author_id)?.name : null
    const proj = task?.client_id ? projectOf.get(task.client_id)?.name : null
    const when = m.created_at ? new Date(m.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null
    return option(r, <>
      <MessageSquare className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{task?.title ?? 'A task'}</span>
        <span className="truncate text-[12px] text-muted-foreground">
          {[when, proj, who].filter(Boolean).join(' · ')}{' — '}<Marked text={snippet(plainText(m.body), q, 90)} q={q} />
        </span>
      </span>
      {who && <Avatar name={who} />}
    </>)
  }
  const heading = (label: string) => <p className="px-1.5 pb-1 pt-2.5 text-[12px] font-medium text-muted-foreground">{label}</p>
  const more = (k: SearchKind, n: number, label: string) => kind === null && n > FIRST_SHOWN && (
    <button type="button" onClick={() => { setKind(k); input.current?.focus() }} className="px-1.5 py-1 text-left text-[13px] font-medium text-accent-blue-deep hover:underline">Show more {label}</button>
  )

  let ri = 0
  const nextRow = () => rows[ri++]
  return (
    <div ref={box} className={`relative hidden min-w-0 flex-1 sm:block sm:max-w-sm ${open ? 'z-50' : ''}`}>
      {open && (
        // the box grows into the panel: it starts behind the box and runs down from it
        <div role="listbox" aria-label="Search" data-global-search
          className="absolute -left-3 -top-3 flex max-h-[80vh] w-[min(600px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[22px] border border-border bg-popover pt-[66px] shadow-[0_16px_48px_rgba(11,11,11,0.22)]">
          <div className="flex shrink-0 flex-wrap gap-2 px-3 pb-2">
            {SEARCH_KINDS.map(k => {
              const Icon = KIND_ICON[k.key]
              const on = kind === k.key
              return (
                <button key={k.key} type="button" aria-pressed={on} onClick={() => { setKind(on ? null : k.key); input.current?.focus() }}
                  className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] ${on ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden />{k.label}
                </button>
              )
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {!typed && (
              recentRows.length > 0 ? (
                <section className="flex flex-col">
                  {heading('Recents')}
                  {recentRows.map(rec => {
                    const r = nextRow()
                    if (rec.kind === 'task') return taskLine(taskOf.get(rec.id)!, r)
                    if (rec.kind === 'project') return projectLine(projectOf.get(rec.id)!, r)
                    return personLine(personOf.get(rec.id)!, r)
                  })}
                </section>
              ) : (
                <p className="px-1.5 py-3 text-[13px] text-muted-foreground">Search the team&rsquo;s tasks, projects, people and messages. What you open from here shows up as Recents.</p>
              )
            )}

            {typed && tasks.length > 0 && (
              <section className="flex flex-col">{heading('Tasks')}{tasks.map(t => taskLine(t, nextRow()))}{more('tasks', found.tasks.length, 'tasks')}</section>
            )}
            {typed && projs.length > 0 && (
              <section className="flex flex-col">{heading('Projects')}{projs.map(p => projectLine(projectOf.get(p.id)!, nextRow()))}{more('projects', found.projects.length, 'projects')}</section>
            )}
            {typed && ppl.length > 0 && (
              <section className="flex flex-col">{heading('People')}{ppl.map(p => personLine(p, nextRow()))}{more('people', found.people.length, 'people')}</section>
            )}
            {typed && msgs.length > 0 && (
              <section className="flex flex-col">{heading('Messages')}{msgs.map(m => messageLine(m, nextRow()))}{more('messages', found.messages.length, 'messages')}</section>
            )}
            {typed && rows.length === 0 && (
              <p className="px-1.5 py-3 text-[13px] text-muted-foreground">{todos.length || people.length ? `Nothing matches “${q.trim()}”.` : 'Looking…'}</p>
            )}
          </div>

          {typed && (
            <button type="button" onClick={ask} className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[13px] text-muted-foreground hover:bg-muted/70">
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <kbd className="rounded border border-border px-1.5 py-0.5 font-sans text-[11px]">↵ Enter</kbd>
              <span className="truncate">to ask the assistant about &ldquo;{q.trim()}&rdquo;</span>
            </button>
          )}
        </div>
      )}

      <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
      <input
        ref={input}
        type="text"
        value={q}
        onFocus={() => { setUsed(true); setOpen(true) }}
        onChange={e => { setQ(e.target.value); setOpen(true); setUsed(true) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(rows.length - 1, h + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(-1, h - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0) go(rows[hi]); else ask() }
          else if (e.key === 'Escape') close()
        }}
        aria-label="Search tasks, projects, people and messages, or ask the assistant"
        aria-expanded={open}
        placeholder="Search tasks, people, messages — or ask"
        className={`relative h-11 rounded-full border bg-surface pl-11 pr-11 ${open ? 'w-[calc(min(600px,100vw-2rem)-24px)]' : 'w-full'} text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none ${open ? 'border-foreground/60' : 'border-border'}`}
      />
      {open && q && (
        <button type="button" aria-label="Clear" onClick={() => { setQ(''); input.current?.focus() }}
          style={{ left: 'calc(min(600px, 100vw - 2rem) - 24px - 36px)' }}
          className="absolute top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/70 text-background hover:bg-muted-foreground">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
