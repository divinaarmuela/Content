'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, MessageSquare, Search, Sparkles } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import { personLabel } from '../../lib/identity-core'
import {
  FIRST_SHOWN, SEARCH_KINDS, plainText, searchAll, snippet,
  type SearchComment, type SearchKind, type SearchPerson, type SearchTask,
} from '../../lib/global-search-core'

/**
 * THE SEARCH BAR, AS ASANA'S (the owner, 27 Oct 2026, a screenshot of Asana: "we also need this at the search bar …
 * for to-do"). Type and the matches drop down — Tasks, People, Messages — three of each, "Show more" for the rest,
 * and chips to look at one kind. A task opens on the To-dos page; a person opens their tasks; a message opens the task
 * it was left on. Enter with nothing picked still asks the assistant, as the bar always has (16 Sep 2026).
 *
 * The tables are read only once somebody uses the bar, so a page that never searches pays nothing for it.
 */

type Row = { kind: 'task' | 'person' | 'message' | 'ask'; id: string; href: string }

const initials = (name: string) => {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '•'
}
function Mark({ name }: { name: string }) {
  return <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-blue/20 text-[10px] font-semibold text-accent-blue-deep">{initials(name)}</span>
}

export default function GlobalSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SearchKind>('all')
  const [hi, setHi] = useState(0)
  const [used, setUsed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const { rows: todos } = useTable<SearchTask & { id: string }>('todos', { enabled: used })
  const { rows: team } = useTable<{ id: string; name?: string | null; email?: string | null; role?: string | null; active_status?: boolean | null }>('team_users', { enabled: used })
  const { rows: comments } = useTable<SearchComment & { id: string }>('todo_comments', { enabled: used })
  const { rows: clients } = useTable<{ id: string; name: string }>('clients', { enabled: used })

  const people = useMemo<SearchPerson[]>(() => team.filter(u => u.role !== 'client' && u.active_status !== false)
    .map(u => ({ id: u.id, name: personLabel(u.name ?? null, u.email ?? null), email: u.email ?? null })), [team])
  const nameOf = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people])
  const clientOf = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients])
  const taskOf = useMemo(() => new Map(todos.map(t => [t.id, t])), [todos])
  const found = useMemo(() => searchAll({ tasks: todos, people, comments }, q), [todos, people, comments, q])

  const cap = (n: number, k: Exclude<SearchKind, 'all'>) => (kind === 'all' ? Math.min(n, FIRST_SHOWN) : kind === k ? Math.min(n, 30) : 0)
  const tasks = found.tasks.slice(0, cap(found.tasks.length, 'tasks'))
  const ppl = found.people.slice(0, cap(found.people.length, 'people'))
  const msgs = found.messages.slice(0, cap(found.messages.length, 'messages'))
  // the keyboard's order: the rows as drawn, then "Ask the assistant"
  const rows: Row[] = [
    ...tasks.map(t => ({ kind: 'task' as const, id: t.id, href: `/dashboard/todos?task=${encodeURIComponent(t.id)}` })),
    ...ppl.map(p => ({ kind: 'person' as const, id: p.id, href: `/dashboard/todos?person=${encodeURIComponent(p.id)}` })),
    ...msgs.map(m => ({ kind: 'message' as const, id: m.id, href: `/dashboard/todos?task=${encodeURIComponent(m.todo_id)}` })),
    { kind: 'ask' as const, id: 'ask', href: `/dashboard/ai?q=${encodeURIComponent(q.trim())}` },
  ]
  useEffect(() => { setHi(0) }, [q, kind])

  // a click anywhere else closes it
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const go = (r: Row | undefined) => {
    if (!r || (r.kind === 'ask' && !q.trim())) return
    setOpen(false); setQ(''); setKind('all')
    router.push(r.href)
  }
  const rowClass = (on: boolean) => `flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] ${on ? 'bg-muted' : 'hover:bg-muted/70'}`
  let at = -1
  const next = () => ++at

  const showPanel = open && q.trim().length > 0
  return (
    <div ref={box} className="relative hidden min-w-0 flex-1 sm:block sm:max-w-sm">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
      <input
        ref={input}
        type="search"
        value={q}
        onFocus={() => { setUsed(true); setOpen(true) }}
        onChange={e => { setQ(e.target.value); setOpen(true); setUsed(true) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(rows.length - 1, h + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); go(rows[hi]) }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
        }}
        aria-label="Search tasks, people and messages, or ask the assistant"
        aria-expanded={showPanel}
        placeholder="Search tasks, people, messages — or ask"
        className="h-11 w-full rounded-full border border-border bg-surface pl-11 pr-4 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
      />

      {showPanel && (
        <div role="listbox" aria-label="Search results" data-global-search
          className="absolute left-0 top-[calc(100%+6px)] z-50 flex max-h-[70vh] w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-border bg-popover shadow-[0_12px_40px_rgba(11,11,11,0.18)]">
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border p-2">
            {SEARCH_KINDS.map(k => (
              <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => { setKind(k.key); input.current?.focus() }}
                className={`h-8 rounded-full border px-3 text-[12px] font-semibold ${kind === k.key ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
                {k.label}
                {k.key !== 'all' && <span className="ml-1 tabular-nums opacity-60">{k.key === 'tasks' ? found.tasks.length : k.key === 'people' ? found.people.length : found.messages.length}</span>}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {tasks.length > 0 && (
              <section className="flex flex-col">
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tasks</p>
                {tasks.map(t => {
                  const i = next(); const r = rows[i]
                  const owner = t.owner_id ? nameOf.get(t.owner_id) : null
                  const client = t.client_id ? clientOf.get(t.client_id) : null
                  return (
                    <button key={t.id} type="button" role="option" aria-selected={hi === i} onMouseEnter={() => setHi(i)} onClick={() => go(r)} className={rowClass(hi === i)}>
                      {t.status === 'done' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-green" aria-label="Done" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={`truncate ${t.status === 'done' ? 'text-muted-foreground' : ''}`}>{t.title}</span>
                        {client && <span className="truncate text-[11px] text-muted-foreground">{client}</span>}
                      </span>
                      {owner && <span title={owner}><Mark name={owner} /></span>}
                    </button>
                  )
                })}
                {kind === 'all' && found.tasks.length > FIRST_SHOWN && (
                  <button type="button" onClick={() => setKind('tasks')} className="px-2.5 py-1 text-left text-[12px] font-semibold text-accent-blue-deep hover:underline">Show more tasks ({found.tasks.length})</button>
                )}
              </section>
            )}

            {ppl.length > 0 && (
              <section className="flex flex-col">
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">People</p>
                {ppl.map(p => {
                  const i = next(); const r = rows[i]
                  return (
                    <button key={p.id} type="button" role="option" aria-selected={hi === i} onMouseEnter={() => setHi(i)} onClick={() => go(r)} className={rowClass(hi === i)}>
                      <Mark name={p.name} />
                      <span className="truncate font-medium">{p.name}</span>
                      {p.email && <span className="truncate text-[12px] text-muted-foreground">{p.email}</span>}
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">their tasks</span>
                    </button>
                  )
                })}
                {kind === 'all' && found.people.length > FIRST_SHOWN && (
                  <button type="button" onClick={() => setKind('people')} className="px-2.5 py-1 text-left text-[12px] font-semibold text-accent-blue-deep hover:underline">Show more people ({found.people.length})</button>
                )}
              </section>
            )}

            {msgs.length > 0 && (
              <section className="flex flex-col">
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Messages</p>
                {msgs.map(m => {
                  const i = next(); const r = rows[i]
                  const task = taskOf.get(m.todo_id)
                  const who = m.author_id ? nameOf.get(m.author_id) : null
                  return (
                    <button key={m.id} type="button" role="option" aria-selected={hi === i} onMouseEnter={() => setHi(i)} onClick={() => go(r)} className={rowClass(hi === i)}>
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{snippet(plainText(m.body), q)}</span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {[task?.title, who, m.created_at ? new Date(m.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  )
                })}
                {kind === 'all' && found.messages.length > FIRST_SHOWN && (
                  <button type="button" onClick={() => setKind('messages')} className="px-2.5 py-1 text-left text-[12px] font-semibold text-accent-blue-deep hover:underline">Show more messages ({found.messages.length})</button>
                )}
              </section>
            )}

            {tasks.length + ppl.length + msgs.length === 0 && (
              <p className="px-2.5 py-3 text-[13px] text-muted-foreground">{todos.length || people.length ? 'Nothing matches — ask the assistant instead.' : 'Looking…'}</p>
            )}
          </div>

          {(() => {
            const i = next()
            return (
              <button type="button" role="option" aria-selected={hi === i} onMouseEnter={() => setHi(i)} onClick={() => go(rows[i])}
                className={`flex shrink-0 items-center gap-2.5 border-t border-border px-4 py-2.5 text-left text-[13px] ${hi === i ? 'bg-muted' : 'hover:bg-muted/70'}`}>
                <Sparkles className="h-4 w-4 shrink-0 text-accent-blue-deep" aria-hidden />
                <span className="truncate">Ask the assistant: <span className="font-semibold">&ldquo;{q.trim()}&rdquo;</span></span>
              </button>
            )
          })()}
        </div>
      )}
    </div>
  )
}
