'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, FolderKanban, Users } from 'lucide-react'
import { agoWords, inboxDay, inboxFor, type InboxItem, type InboxTab } from '../../lib/todo-inbox-core'

/**
 * TO-DOS, LAID OUT AS ASANA'S (the owner, 20 Oct 2026, Manal's video: "my own little icon dashboard … on the side
 * there's like all these sections … you also have an inbox section … and a project section based off clients";
 * "make sure it shows their own logo"). The sidebar — Inbox, My tasks, then the clients as projects, each with its
 * logo or colour — and the Inbox itself. Where a press goes is the page's (`place`).
 */

export type Project = { id: string; name: string; logo: string | null; colour: string; open: number; mine: boolean }
/** where the page is: the inbox, my tasks, everyone's (a super admin), or one client's project */
export type Place = 'inbox' | 'mine' | 'all' | `project:${string}`

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

export function TodoSidebar({ place, onPlace, projects, unread, everyone }: {
  place: Place
  onPlace: (p: Place) => void
  projects: Project[]
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
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          {p.open > 0 && <span className="text-[11px] text-muted-foreground">{p.open}</span>}
        </button>
      </li>
    )
  })
  return (
    <nav data-todo-nav aria-label="To-dos" className="flex flex-col gap-1 border-border pb-2 md:sticky md:top-0 md:max-h-[calc(100vh-120px)] md:overflow-y-auto md:border-r md:pr-3 md:pt-3">
      <ul className="flex flex-row gap-1 overflow-x-auto md:flex-col">
        <li>
          <button type="button" onClick={() => onPlace('inbox')} aria-current={place === 'inbox' ? 'page' : undefined} className={item(place === 'inbox')}>
            <Bell className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">Inbox</span>
            {unread > 0 && <span className="rounded-full bg-accent-red-deep px-1.5 text-[11px] font-semibold leading-5 text-white">{unread}</span>}
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
      {projects.length > 0 && (
        <div className="mt-3 hidden flex-col gap-1 md:flex">
          <p className="flex items-center gap-1.5 px-2.5 text-[12px] font-semibold text-muted-foreground"><FolderKanban className="h-3.5 w-3.5" aria-hidden /> Projects</p>
          <ul className="flex flex-col gap-0.5">{list(mine)}</ul>
          {others.length > 0 && (
            <>
              <p className="mt-2 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Other clients</p>
              <ul className="flex flex-col gap-0.5">{list(others)}</ul>
            </>
          )}
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
