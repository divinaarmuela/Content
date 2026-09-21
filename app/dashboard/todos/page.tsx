'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, ExternalLink, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTable } from '@/lib/db-client'
import type { Client, TeamUser, Todo as TodoRow } from '@/lib/db-types'
import PageTitle from '../ui/PageTitle'
import Chip from '../ui/Chip'
import { todayKey } from '../ui/tone'
import { useRole } from '../useRole'
import { personLabel } from '../../lib/identity-core'
import { initialsOf } from '../../lib/board-view-core'
import { downloadHref } from '../../lib/download-core'
import { uploadFiles } from '../uploadQueue'
import { UploadRows, useUploadGroup } from '../UploadRows'
import {
  dueWords, groupTodos, mayDeleteTodo, mayEditTodo, mayFilterByPerson, todoFilesOf, todosEmptyWords, visibleTodos,
  type TodoFile,
} from '../../lib/todo-core'

/**
 * THE TO-DOS PAGE (todo-core, 17 Sep 2026): every team role's own list —
 * what they hold and what they wrote; a super admin's is everyone's. A
 * manager can narrow it to one person. A to-do carries a note, a date, a
 * client and files. The table is read live, so a tick lands for everyone
 * looking.
 */
const field = 'h-11 rounded-full border-border bg-surface px-4'
const isImage = (f: TodoFile) => (f.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(f.name)

type Draft = { id: string | null; title: string; note: string; due: string; owner: string; client: string; files: TodoFile[] }
const EMPTY: Draft = { id: null, title: '', note: '', due: '', owner: '', client: '', files: [] }

export default function TodosPage() {
  const { me, loading: meLoading } = useRole()
  const viewer = useMemo(() => (me && me.role !== 'client' ? { id: me.id, role: me.role } : null), [me])
  const { rows: raw, loading } = useTable<TodoRow>('todos')
  const { rows: team } = useTable<TeamUser>('team_users')
  const { rows: clients } = useTable<Client>('clients')
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])

  const names = useMemo(() => new Map(team.map(u => [u.id, personLabel(u.name, u.email)])), [team])
  const people = useMemo(() => team.filter(u => u.role !== 'client' && u.active_status !== false).map(u => ({ id: u.id, name: personLabel(u.name, u.email) })), [team])
  const clientNames = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients])

  const [status, setStatus] = useState<'open' | 'done' | 'all'>('open')
  const [person, setPerson] = useState<string>('')
  const [client, setClient] = useState<string>('')
  const canFilterPeople = mayFilterByPerson(viewer)

  const visible = useMemo(() => visibleTodos(viewer, raw as never[]) as TodoRow[], [viewer, raw])
  const shown = useMemo(() => visible.filter(t =>
    (status === 'all' || (status === 'done' ? t.status === 'done' : t.status !== 'done'))
    && (!person || !canFilterPeople || t.owner_id === person)
    && (!client || t.client_id === client)), [visible, status, person, client, canFilterPeople])
  const groups = useMemo(() => (today ? groupTodos(shown, today).filter(g => g.rows.length > 0) : []), [shown, today])

  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const call = async (path: string, init: RequestInit, said: string) => {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
    toast.success(said)
    return res
  }
  const tick = async (t: TodoRow, done: boolean) => {
    try { await call(`/api/todos/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: done ? 'done' : 'open' }) }, done ? 'Done' : 'Reopened') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that') }
  }
  const save = async () => {
    if (!draft || !draft.title.trim()) return
    setBusy(true)
    try {
      const body = { title: draft.title, note: draft.note, due_date: draft.due || null, owner_id: draft.owner || (me?.id ?? null), client_id: draft.client || null, files: draft.files }
      if (draft.id) await call(`/api/todos/${draft.id}`, { method: 'PATCH', body: JSON.stringify(body) }, 'Saved')
      else await call('/api/todos', { method: 'POST', body: JSON.stringify(body) }, 'To-do added')
      setDraft(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that') }
    finally { setBusy(false) }
  }
  const remove = async (t: TodoRow) => {
    setBusy(true)
    try { await call(`/api/todos/${t.id}`, { method: 'DELETE' }, 'Deleted'); setDraft(null) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete it') }
    finally { setBusy(false) }
  }

  const ready = !meLoading && !loading && today !== null
  const filterPersonName = person ? (names.get(person) ?? null) : null

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="To-dos"
        summary={viewer?.role === 'super_admin'
          ? 'Everyone’s to-dos — what each person holds and what they wrote. Narrow it to one person, tick things off, attach files.'
          : 'Yours — what you hold and what you wrote. Add one for yourself or for somebody else, with a date, a client and files.'}
        actions={viewer && (
          <Button onClick={() => setDraft({ ...EMPTY, owner: me?.id ?? '' })}
            className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4" /> New to-do
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div className="inline-flex rounded-full border border-border bg-surface p-1" role="tablist" aria-label="Open or done">
          {(['open', 'done', 'all'] as const).map(s => (
            <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
              className={`inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-semibold ${status === s ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
              {s === 'open' ? 'Open' : s === 'done' ? 'Done' : 'All'}
            </button>
          ))}
        </div>
        {canFilterPeople && (
          <Select value={person || 'everyone'} onValueChange={v => setPerson(v === 'everyone' ? '' : v)}>
            <SelectTrigger className={`${field} w-56`} aria-label="Whose to-dos"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="everyone">Everyone</SelectItem>
              {people.map(p => <SelectItem key={p.id} value={p.id}>{p.id === me?.id ? 'Me' : p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={client || 'all'} onValueChange={v => setClient(v === 'all' ? '' : v)}>
          <SelectTrigger className={`${field} w-56`} aria-label="Which client"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.filter(c => ((c as { status?: string | null }).status ?? 'active') === 'active').map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(person || client || status !== 'open') && (
          <button type="button" onClick={() => { setPerson(''); setClient(''); setStatus('open') }} className="inline-flex min-h-9 items-center px-2 text-[13px] text-muted-foreground underline-offset-4 hover:underline">Clear</button>
        )}
      </div>

      {!ready ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-inner" />)}</div>
      ) : groups.length === 0 ? (
        <p className="rounded-card border border-border bg-card px-5 py-8 text-center text-[14px] text-muted-foreground">{todosEmptyWords({ status, person: person || null, client: client || null }, filterPersonName)}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(g => (
            <section key={g.key} className="flex flex-col gap-2" aria-label={g.label}>
              <h2 className={`text-[12px] font-semibold uppercase tracking-[0.08em] ${g.key === 'overdue' ? 'text-accent-red-deep' : 'text-muted-foreground'}`}>{g.label} · {g.rows.length}</h2>
              <ul className="flex flex-col gap-2">
                {g.rows.map(t => {
                  const files = todoFilesOf(t.files)
                  const due = dueWords(t.due_date, today!)
                  const editable = mayEditTodo(viewer, t as never)
                  const done = t.status === 'done'
                  return (
                    <li key={t.id} className={`flex gap-3 rounded-inner border border-border bg-card p-3 ${done ? 'opacity-70' : ''}`} data-todo>
                      <button type="button" role="checkbox" aria-checked={done} aria-label={done ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                        disabled={!editable} onClick={() => void tick(t, !done)}
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${done ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'} disabled:opacity-50`}>
                        {done && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
                      </button>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[14px] font-semibold ${done ? 'line-through' : ''}`}>{t.title}</span>
                          {t.client_id && clientNames.get(t.client_id) && <Chip tone="muted">{clientNames.get(t.client_id)}</Chip>}
                          {/* an acquisition reminder opens the prospect it is about (21 Sep 2026) */}
                          {(t as { prospect_id?: string | null }).prospect_id && (
                            <a href={`/dashboard/leads/acquisition?prospect=${encodeURIComponent(String((t as { prospect_id?: string | null }).prospect_id))}`}
                              className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-blue-deep underline underline-offset-4">Open the prospect</a>
                          )}
                          {due && !done && <Chip tone={g.key === 'overdue' ? 'red' : g.key === 'today' ? 'amber' : 'muted'}>{due}</Chip>}
                          {t.owner_id && (
                            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground" title={names.get(t.owner_id) ?? ''}>
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground/[0.08] text-[10px] font-semibold">{initialsOf(names.get(t.owner_id) ?? '?')}</span>
                              {t.owner_id === me?.id ? 'Me' : names.get(t.owner_id) ?? 'Someone'}
                            </span>
                          )}
                          {t.created_by && t.created_by !== t.owner_id && <span className="text-[12px] text-muted-foreground">from {t.created_by === me?.id ? 'me' : names.get(t.created_by) ?? 'someone'}</span>}
                        </div>
                        {t.note && <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{t.note}</p>}
                        {files.length > 0 && (
                          <ul className="flex flex-wrap gap-2">
                            {files.map(f => (
                              <li key={f.url} className="flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-1.5 pr-2 text-[12px]">
                                {isImage(f)
                                  // eslint-disable-next-line @next/next/no-img-element -- the person's own upload
                                  ? <img src={f.url} alt="" className="h-7 w-7 rounded-full object-cover" />
                                  : <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                                <span className="max-w-[160px] truncate" title={f.name}>{f.name}</span>
                                <a href={f.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${f.name}`} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"><ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
                                <a href={downloadHref(f) ?? f.url} download={f.name} aria-label={`Download ${f.name}`} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"><Download className="h-3.5 w-3.5" aria-hidden /></a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {editable && (
                        <button type="button" aria-label={`Edit ${t.title}`} onClick={() => setDraft({ id: t.id, title: t.title, note: t.note ?? '', due: t.due_date ?? '', owner: t.owner_id ?? '', client: t.client_id ?? '', files })}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {draft && viewer && (
        <TodoDialog draft={draft} onChange={setDraft} onClose={() => setDraft(null)} onSave={save} busy={busy}
          people={people} meId={me?.id ?? ''} clients={clients.filter(c => ((c as { status?: string | null }).status ?? 'active') === 'active').map(c => ({ id: c.id, name: c.name }))}
          onDelete={draft.id && mayDeleteTodo(viewer, (raw as TodoRow[]).find(r => r.id === draft.id) ?? {}) ? () => { const t = (raw as TodoRow[]).find(r => r.id === draft.id); if (t) void remove(t) } : undefined} />
      )}
    </div>
  )
}

function TodoDialog({ draft, onChange, onClose, onSave, onDelete, busy, people, meId, clients }: {
  draft: Draft
  onChange: (d: Draft) => void
  onClose: () => void
  onSave: () => void
  onDelete?: () => void
  busy: boolean
  people: { id: string; name: string }[]
  meId: string
  clients: { id: string; name: string }[]
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const uploading = useUploadGroup(group)
  const stillUploading = uploading.some(u => !u.url && !u.error)
  const add = async (picked: File[]) => {
    if (picked.length === 0) return
    const up = uploadFiles(picked, { purpose: 'social' })
    setGroup(up.group)
    try {
      const landed = await up.done
      onChange({ ...draft, files: [...draft.files, ...landed.map(({ file, url }) => ({ url, name: file.name, mime: file.type || null, size: file.size }))] })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not upload that') }
    finally { setGroup(null) }
  }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-card bg-popover sm:max-w-lg" data-todo-dialog>
        <DialogHeader>
          <DialogTitle>{draft.id ? 'Edit the to-do' : 'New to-do'}</DialogTitle>
          <DialogDescription>{draft.id ? 'Change what you need to; the rest stays.' : 'One thing to do — for you, or for somebody else on the team.'}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="todo-title">What</Label>
            <Input id="todo-title" value={draft.title} onChange={e => onChange({ ...draft, title: e.target.value })} placeholder="Send Capila the October captions" className={field} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="todo-note">Notes (optional)</Label>
            <Textarea id="todo-note" rows={3} value={draft.note} onChange={e => onChange({ ...draft, note: e.target.value })} placeholder="Anything the person needs to know" className="rounded-[20px] border-border bg-surface px-4 py-3" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Who</Label>
              <Select value={draft.owner || meId} onValueChange={v => v && onChange({ ...draft, owner: v })}>
                <SelectTrigger className={field}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {people.map(p => <SelectItem key={p.id} value={p.id}>{p.id === meId ? 'Me' : p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="todo-due">Due (optional)</Label>
              <Input id="todo-due" type="date" value={draft.due} onChange={e => onChange({ ...draft, due: e.target.value })} className={field} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Client (optional)</Label>
            <Select value={draft.client || 'none'} onValueChange={v => onChange({ ...draft, client: v === 'none' ? '' : v })}>
              <SelectTrigger className={field}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not about a client</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 rounded-[20px] border border-border p-3">
            <Label>Files (optional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="h-11 rounded-full px-4 text-[13px] font-semibold" disabled={busy || stillUploading} onClick={() => input.current?.click()}>
                <Paperclip className="h-4 w-4" aria-hidden /> Add files
              </Button>
              <input ref={input} type="file" multiple className="hidden" aria-label="Files for this to-do" onChange={e => { void add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              {draft.files.length > 0 && <span className="text-[13px] text-muted-foreground">{draft.files.length} {draft.files.length === 1 ? 'file' : 'files'}</span>}
            </div>
            {uploading.length > 0 && <UploadRows uploads={uploading} compact />}
            {draft.files.length > 0 && (
              <ul className="flex flex-col gap-1">
                {draft.files.map(f => (
                  <li key={f.url} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate">{f.name}</span>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange({ ...draft, files: draft.files.filter(x => x.url !== f.url) })}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {onDelete ? (
              <Button type="button" variant="ghost" className="h-11 rounded-full px-3 text-[13px] font-semibold text-muted-foreground" disabled={busy} onClick={onDelete}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </Button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" className="h-11 rounded-full px-4 text-[13px] font-semibold" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="button" className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90" disabled={busy || stillUploading || !draft.title.trim()} onClick={onSave}>
                {busy ? 'Saving…' : stillUploading ? 'Uploading…' : draft.id ? 'Save' : 'Add the to-do'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
