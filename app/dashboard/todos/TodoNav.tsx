'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, FolderKanban, Search, Users } from 'lucide-react'
import { agoWords, inboxDay, inboxFor, type InboxItem, type InboxTab } from '../../lib/todo-inbox-core'

/**
 * TO-DOS, LAID OUT AS ASANA'S (the owner, 20 Oct 2026, Manal's video: "my own little icon dashboard … on the side
 * there's like all these sections … you also have an inbox section … and a project section based off clients";
 * "make sure it shows their own logo"). The sidebar — Inbox, My tasks, then the clients as projects, each with its
 * logo or colour — and the Inbox itself. Where a press goes is the page's (`place`).
 */

export type Project = { id: string; name: string; logo: string | null; colour: string; open: number; mine: boolean }
/** where the page is: the inbox, my tasks, everyone's (a super admin), one client's project, or one person's tasks */
export type Place = 'inbox' | 'mine' | 'all' | `project:${string}` | `person:${string}`

/** a person's initials, for the round mark beside their name (Asana's "YM") */
export function initialsOf(name: string): string {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '•'
}
export function PersonMark({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-accent-blue/20 font-semibold text-accent-blue-deep" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {initialsOf(name)}
    </span>
  )
}

/**
 * SOMEONE'S TASKS (the owner, 27 Oct 2026, Asana's "Yusuf's tasks": "is there a way to view each team's tasks — if I
 * search their name, it would show all tasks under them"). Type a name, pick them, and the page is theirs — every
 * one of their tasks, for anyone on the team ("anyone should be able to see it").
 */
function PeopleSearch({ people, place, onPlace, item }: {
  people: { id: string; name: string }[]
  place: Place
  onPlace: (p: Place) => void
  item: (on: boolean) => string
}) {
  const [q, setQ] = useState('')
  const open = place.startsWith('person:') ? people.find(p => `person:${p.id}` === place) ?? null : null
  const found = q.trim() ? people.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []
  return (
    <div className="mt-3 flex flex-col gap-1">
      <p className="flex items-center gap-1.5 px-2.5 text-[12px] font-semibold text-muted-foreground"><Users className="h-3.5 w-3.5" aria-hidden /> People</p>
      <label className="relative mx-0.5 flex items-center">
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find someone’s tasks" aria-label="Find someone’s tasks"
          onKeyDown={e => { if (e.key === 'Enter' && found[0]) { onPlace(`person:${found[0].id}`); setQ('') } if (e.key === 'Escape') setQ('') }}
          className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-2 text-[13px] outline-none focus:border-foreground/40" />
      </label>
      {q.trim() && (
        <ul className="flex flex-col gap-0.5" aria-label="People found">
          {found.length === 0 && <li className="px-2.5 py-1 text-[12px] text-muted-foreground">Nobody by that name</li>}
          {found.map(p => (
            <li key={p.id}>
              <button type="button" onClick={() => { onPlace(`person:${p.id}`); setQ('') }} className={item(false)}>
                <PersonMark name={p.name} /> <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !q.trim() && (
        <button type="button" aria-current="page" className={item(true)} onClick={() => onPlace(place)}>
          <PersonMark name={open.name} /> <span className="min-w-0 flex-1 truncate">{open.name}</span>
        </button>
      )}
    </div>
  )
}

/** a project's own mark: its logo, or Asana's coloured square with its first letter */
export function ProjectIcon({ p, size = 20 }: { p: Pick<Project, 'name' | 'logo' | 'colour'>; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (p.logo && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.logo} alt="" onError={() => setBroken(true)} className="shrink-0 rounded-[5px] object-cover" style={{ width: size, height: size }} />
  }
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white" style={{ width: size, height: size, backgroundColor: p.colour, fontSize: Math.round(size * 0.55) }}>
      {p.name.trim()[0]?.toUpperCase() ?? '•'}
    </span>
  )
}

export function TodoSidebar({ place, onPlace, projects, unread, everyone, people = [] }: {
  place: Place
  onPlace: (p: Place) => void
  projects: Project[]
  /** the team, for "Find someone's tasks" */
  people?: { id: string; name: string }[]
  unread: number
  /** a super admin also has "Everyone's tasks" */
  everyone: boolean
}) {
  const item = (on: boolean) => `flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[14px] ${on ? 'bg-foreground/[0.08] font-semibold text-foreground' : 'text-foreground/80 hover:bg-muted'}`
  const mine = projects.filter(p => p.mine)
  const others = projects.filter(p => !p.mine)
  const list = (ps: Project[]) => ps.map(p => {
    const key = `project:${p.id}` as Place
    return (
      <li key={p.id}>
        <button type="button" onClick={() => onPlace(key)} aria-current={place === key ? 'page' : undefined} className={item(place === key)} title={p.name}>
          <ProjectIcon p={p} />
          {/* the name alone, as Asana's sidebar has it — no count (21 Oct 2026) */}
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
        </button>
      </li>
    )
  })
  return (
    <nav data-todo-nav aria-label="To-dos" className="flex flex-col gap-1 border-border pb-2 md:sticky md:top-0 md:max-h-[calc(100vh-120px)] md:border-r md:pr-3 md:pt-3">
      <ul className="flex shrink-0 flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        <li>
          <button type="button" onClick={() => onPlace('inbox')} aria-current={place === 'inbox' ? 'page' : undefined} className={item(place === 'inbox')}>
            <Bell className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">Inbox</span>
            {/* a quiet count, not an alarm (the owner, 21 Oct 2026: "the number 1 looks ugly red") — the sidebar's soft blue */}
            {unread > 0 && <span aria-label={`${unread} unread`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-blue/15 px-1.5 text-[11px] font-semibold tabular-nums text-accent-blue-deep">{unread}</span>}
          </button>
        </li>
        <li>
          <button type="button" onClick={() => onPlace('mine')} aria-current={place === 'mine' ? 'page' : undefined} className={item(place === 'mine')}>
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">My tasks</span>
          </button>
        </li>
        {everyone && (
          <li>
            <button type="button" onClick={() => onPlace('all')} aria-current={place === 'all' ? 'page' : undefined} className={item(place === 'all')}>
              <Users className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">Everyone&rsquo;s tasks</span>
            </button>
          </li>
        )}
      </ul>
      {people.length > 0 && <PeopleSearch people={people} place={place} onPlace={onPlace} item={item} />}
      {projects.length > 0 && (
        <div className="mt-3 hidden min-h-0 flex-1 flex-col gap-1 overflow-y-auto [overflow-anchor:none] md:flex">
          <p className="flex items-center gap-1.5 px-2.5 text-[12px] font-semibold text-muted-foreground"><FolderKanban className="h-3.5 w-3.5" aria-hidden /> Projects</p>
          {/* "Other clients" only when some are yours: with none of your own it was a heading over every project (21 Oct 2026) */}
          {mine.length > 0 && others.length > 0 ? (
            <>
              <ul className="flex flex-col gap-0.5">{list(mine)}</ul>
              <p className="mt-2 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Other clients</p>
              <ul className="flex flex-col gap-0.5">{list(others)}</ul>
            </>
          ) : <ul className="flex flex-col gap-0.5">{list(projects)}</ul>}
        </div>
      )}
      {/* on a phone, the projects as one picker under the tabs */}
      {projects.length > 0 && (
        <select aria-label="Open a project" className="mt-1 h-9 rounded-md border border-border bg-surface px-2 text-[13px] md:hidden"
          value={place.startsWith('project:') ? place : ''} onChange={e => e.target.value && onPlace(e.target.value as Place)}>
          <option value="">Projects…</option>
          {projects.map(p => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}
        </select>
      )}
    </nav>
  )
}

/** the Inbox's data: my to-do notifications, live enough (on open and every minute) */
export function useTodoInbox() {
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/todos/inbox', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json() as { items?: InboxItem[] }
      setItems(j.items ?? [])
    } catch { /* offline: keep what we had */ }
  }, [])
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(t) }, [load])
  const markRead = useCallback(async (ids: string[] | 'all') => {
    setItems(cur => cur?.map(i => (ids === 'all' || ids.includes(i.id) ? { ...i, read: true } : i)) ?? cur)
    await fetch('/api/todos/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) }).catch(() => undefined)
  }, [])
  const unread = useMemo(() => (items ?? []).filter(i => !i.read).length, [items])
  return { items, unread, markRead, reload: load }
}

export function TodoInbox({ items, today, onOpen, markRead }: {
  items: InboxItem[] | null
  today: string
  onOpen: (todoId: string) => void
  markRead: (ids: string[] | 'all') => void
}) {
  const [tab, setTab] = useState<InboxTab>('activity')
  const shown = useMemo(() => inboxFor(items ?? [], tab), [items, tab])
  const groups = useMemo(() => {
    const out: { day: string; rows: InboxItem[] }[] = []
    for (const i of shown) {
      const day = inboxDay(i.at, today)
      const g = out.find(x => x.day === day)
      if (g) g.rows.push(i); else out.push({ day, rows: [i] })
    }
    return out
  }, [shown, today])
  return (
    <div className="flex flex-col gap-3 pb-24 pt-2">
      <div className="flex flex-wrap items-center gap-5 border-b border-border">
        {(['activity', 'mentioned'] as const).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`border-b-2 pb-1.5 text-[14px] font-medium ${tab === t ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t === 'activity' ? 'Activity' : '@Mentioned'}
          </button>
        ))}
        {(items ?? []).some(i => !i.read) && (
          <button type="button" onClick={() => markRead('all')} className="ml-auto pb-1.5 text-[12px] text-muted-foreground underline-offset-4 hover:underline">Mark all as read</button>
        )}
      </div>
      {items === null ? (
        <p className="px-1 text-[14px] text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="px-1 py-6 text-[14px] text-muted-foreground">
          {tab === 'mentioned' ? 'Nobody has tagged you yet. When someone writes @ and your name on a task, it shows here.' : 'Nothing yet. When someone assigns you, tags you, comments on or completes a task you are on, it shows here.'}
        </p>
      ) : groups.map(g => (
        <section key={g.day} aria-label={g.day} className="flex flex-col">
          <h2 className="px-1 pb-1 text-[13px] font-semibold text-muted-foreground">{g.day}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {g.rows.map(i => (
              <li key={i.id}>
                <button type="button" onClick={() => { onOpen(i.todoId); if (!i.read) markRead([i.id]) }}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted">
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.read ? 'bg-transparent' : 'bg-accent-blue'}`} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`text-[14px] ${i.read ? '' : 'font-semibold'}`}>{i.subject}</span>
                    {i.quote && <span className="line-clamp-2 text-[13px] text-muted-foreground">“{i.quote}”</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{agoWords(i.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
