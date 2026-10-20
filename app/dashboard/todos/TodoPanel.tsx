'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRightToLine, Bold, Check, ChevronLeft, Hourglass, Italic, List, ListOrdered, Download, ExternalLink, Link2, Maximize2, Minimize2, Paperclip, Plus, ThumbsUp, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTable } from '@/lib/db-client'
import type { Todo as TodoRow, TodoComment } from '@/lib/db-types'
import MentionBox from '../MentionBox'
import { initialsOf } from '../../lib/board-view-core'
import { downloadHref } from '../../lib/download-core'
import { extractMentions } from '../../lib/mention-core'
import { uploadFiles } from '../uploadQueue'
import { UploadRows, useUploadGroup } from '../UploadRows'
import { activityWords, idsOf, mayCommentOnTodo, mayDependOn, mayEditTodo, openBlockers, parseNote, todoFilesOf, type NoteSpan, type TodoFile, linkParts } from '../../lib/todo-core'
import { dueTone, shortDue } from './todo-words'
import DuePicker from './DuePicker'
import { normaliseRepeat } from '../../lib/todo-repeat-core'

/**
 * THE TASK PANEL, Asana's (measured 18 Oct 2026 from the owner's own Asana:
 * ~700px, over the list from the right). Top bar: Mark complete, like,
 * attach, copy link, delete, close. Then the title, the field rows
 * (Assignee · Due date · Linked to · Created by), Description, Subtasks,
 * Attachments, and at the foot the Comments / All activity feed with the
 * comment box and the collaborators. Every field saves as it is left.
 */
export type Person = { id: string; name: string; email?: string }
type Viewer = { id: string; role: string }
type Activity = { id: string; created_at: string; actor_id: string | null; action: string; old_value: string | null; new_value: string | null; detail: string | null }

const isImage = (f: TodoFile) => (f.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(f.name)

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] font-semibold ring-2 ring-card ${size === 'md' ? 'h-7 w-7 text-[11px]' : 'h-6 w-6 text-[10px]'}`} title={name} aria-hidden>
      {initialsOf(name)}
    </span>
  )
}

export function CheckCircle({ done, label, disabled, onClick }: { done: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} disabled={disabled} onClick={e => { e.stopPropagation(); onClick() }}
      className="group/check flex h-9 w-8 shrink-0 items-center justify-center disabled:opacity-50">
      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${done
        ? 'border-accent-green-deep bg-accent-green-deep text-background'
        : 'border-muted-foreground/60 text-transparent group-hover/check:border-accent-green-deep group-hover/check:text-accent-green-deep'}`}>
        <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />
      </span>
    </button>
  )
}

const when = (iso: string) => {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function TodoPanel({
  t, all, today, viewer, people, clients, names, clientNames, onClose, onOpen, onDeleted, onTick,
}: {
  t: TodoRow
  /** every to-do this viewer may see: subtasks are read from here */
  all: TodoRow[]
  today: string
  viewer: Viewer
  people: Person[]
  clients: { id: string; name: string }[]
  names: Map<string, string>
  clientNames: Map<string, string>
  onClose: () => void
  onOpen: (id: string) => void
  onDeleted: () => void
  /** complete / reopen through the page: the dependency warning and the celebration live there */
  onTick: (done: boolean) => void
}) {
  const parent = t.parent_id ? all.find(x => x.id === t.parent_id) ?? null : null
  const editable = mayEditTodo(viewer, t as never)
  const deletable = viewer.role === 'super_admin' || t.created_by === viewer.id
  const mayTalk = mayCommentOnTodo(viewer, t as never, parent as never)
  const done = t.status === 'done'
  const nameOf = useCallback((id: string | null) => (id ? (id === viewer.id ? 'You' : names.get(id) ?? 'Someone') : 'Someone'), [names, viewer.id])

  const [title, setTitle] = useState(t.title)
  const [note, setNote] = useState(t.note ?? '')
  useEffect(() => { setTitle(t.title) }, [t.title])
  useEffect(() => { setNote(t.note ?? '') }, [t.note])
  const [sure, setSure] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  /** **bold**, *italic*, "- " and "1. " — wraps the selection or starts the lines */
  const format = (k: 'bold' | 'italic' | 'ul' | 'ol') => {
    const el = noteRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value: v } = el
    let next = v, caretA = a, caretB = b
    if (k === 'bold' || k === 'italic') {
      const mark = k === 'bold' ? '**' : '*'
      next = v.slice(0, a) + mark + v.slice(a, b) + mark + v.slice(b)
      caretA = a + mark.length; caretB = b + mark.length
    } else {
      const start = v.lastIndexOf('\n', a - 1) + 1
      const lines = v.slice(start, b).split('\n')
      const made = lines.map((l, i) => (k === 'ul' ? `- ${l}` : `${i + 1}. ${l}`)).join('\n')
      next = v.slice(0, start) + made + v.slice(b)
      caretA = caretB = start + made.length
    }
    setNote(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caretA, caretB) })
  }
  const files = todoFilesOf(t.files)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const uploading = useUploadGroup(group)
  const likes = idsOf(t.likes)
  const followers = idsOf(t.followers)
  const iLike = likes.includes(viewer.id)
  const onIt = t.owner_id === viewer.id || t.created_by === viewer.id || followers.includes(viewer.id)

  const send = useCallback(async (path: string, init: RequestInit, said?: string) => {
    try {
      const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
      if (said) toast.success(said)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that'); return false }
  }, [])
  const patch = (body: Record<string, unknown>, said?: string) => send(`/api/todos/${t.id}`, { method: 'PATCH', body: JSON.stringify(body) }, said).then(ok => { if (ok) void loadActivity() })

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input,textarea,[role=listbox]')) onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const add = async (picked: File[]) => {
    if (picked.length === 0) return
    const up = uploadFiles(picked, { purpose: 'social' })
    setGroup(up.group)
    try {
      const landed = await up.done
      await patch({ files: [...files, ...landed.map(({ file, url }) => ({ url, name: file.name, mime: file.type || null, size: file.size }))] }, 'Attached')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not upload that') }
    finally { setGroup(null) }
  }

  // SUBTASKS — rows of the same table under this one
  const blockers = useMemo(() => { const ids = idsOf(t.blocked_by); return all.filter(x => ids.includes(x.id)) }, [all, t.blocked_by])
  const waiting = openBlockers(t, all)
  const subtasks = useMemo(() => all.filter(x => x.parent_id === t.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))), [all, t.id])
  const [subDraft, setSubDraft] = useState<string | null>(null)
  const addSub = async (name: string) => {
    if (!name.trim()) return
    await send('/api/todos', { method: 'POST', body: JSON.stringify({ title: name.trim(), parent_id: t.id, owner_id: viewer.id, files: [] }) })
    void loadActivity()
  }

  // COMMENTS (live) and ACTIVITY (read on open, and after each change)
  const { rows: commentRows } = useTable<TodoComment>('todo_comments', { by: { todo_id: t.id } as never, enabled: mayTalk })
  const comments = useMemo(() => [...commentRows].filter(c => c.todo_id === t.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))), [commentRows, t.id])
  const [activity, setActivity] = useState<Activity[]>([])
  const loadActivity = useCallback(async () => {
    const res = await fetch(`/api/todos/${t.id}/activity`).catch(() => null)
    if (res?.ok) setActivity(((await res.json()) as { activity: Activity[] }).activity)
  }, [t.id])
  useEffect(() => { if (mayTalk) void loadActivity() }, [loadActivity, mayTalk])
  const [feedTab, setFeedTab] = useState<'comments' | 'all'>('comments')
  const feed = useMemo(() => {
    const cs = comments.map(c => ({ kind: 'comment' as const, at: String(c.created_at), c }))
    if (feedTab === 'comments') return cs
    return [...cs, ...activity.map(a => ({ kind: 'activity' as const, at: a.created_at, a }))].sort((x, y) => x.at.localeCompare(y.at))
  }, [comments, activity, feedTab])
  const created = activity.find(a => a.action === 'todo_made')

  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const members = useMemo(() => people.filter(p => p.id !== viewer.id), [people, viewer.id])
  const post = async () => {
    if (!draft.trim() || posting) return
    setPosting(true)
    const mention_ids = extractMentions(draft, members).map(m => m.id)
    const ok = await send(`/api/todos/${t.id}/comments`, { method: 'POST', body: JSON.stringify({ body: draft, mention_ids }) })
    if (ok) setDraft('')
    setPosting(false)
  }
  const feedEnd = useRef<HTMLDivElement | null>(null)

  const [adding, setAdding] = useState(false)
  // FULL SCREEN (Asana's expand button, the owner 18 Oct 2026): the panel takes the whole window, the content centred
  const [full, setFull] = useState(false)
  const wrap = full ? 'mx-auto w-full max-w-3xl' : ''
  const label = 'w-28 shrink-0 text-[12px] text-muted-foreground'

  return (
    <aside role="dialog" aria-label={`To-do: ${t.title}`} data-todo-panel
      className={`fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-card ${full ? 'left-0 max-w-none' : 'max-w-[700px] border-l border-border shadow-[-8px_0_24px_rgba(0,0,0,0.08)] motion-safe:animate-sheet-in-right'}`}>
      {/* TOP BAR */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
        <button type="button" disabled={!editable} onClick={() => { onTick(!done); setTimeout(() => void loadActivity(), 800) }}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium disabled:opacity-50 ${done
            ? 'border-accent-green-deep bg-accent-green-deep/10 text-accent-green-deep'
            : 'border-border hover:border-accent-green-deep hover:text-accent-green-deep'}`}>
          <Check className="h-4 w-4" aria-hidden /> {done ? 'Completed' : 'Mark complete'}
        </button>
        <div className="flex items-center gap-0.5">
          {mayTalk && (
            <button type="button" aria-pressed={iLike} aria-label={iLike ? 'Take back your like' : 'Like this to-do'} title={likes.length ? likes.map(nameOf).join(', ') : 'Like'}
              onClick={() => void send(`/api/todos/${t.id}/like`, { method: 'POST', body: JSON.stringify({ on: !iLike }) })}
              className={`inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2 text-[12px] hover:bg-muted ${iLike ? 'text-accent-blue-deep' : 'text-muted-foreground'}`}>
              <ThumbsUp className="h-4 w-4" aria-hidden fill={iLike ? 'currentColor' : 'none'} />{likes.length > 0 && likes.length}
            </button>
          )}
          {editable && <button type="button" aria-label="Attach a file" title="Attach" onClick={() => fileInput.current?.click()} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><Paperclip className="h-4 w-4" aria-hidden /></button>}
          <button type="button" aria-label="Copy the link to this to-do" title="Copy link"
            onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/dashboard/todos?task=${t.id}`).then(() => toast.success('Link copied')) }}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><Link2 className="h-4 w-4" aria-hidden /></button>
          {deletable && <button type="button" aria-label="Delete this to-do" title="Delete" onClick={() => setSure(true)} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><Trash2 className="h-4 w-4" aria-hidden /></button>}
          <button type="button" aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen'} aria-pressed={full} onClick={() => setFull(f => !f)}
            className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:flex">{full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}</button>
          <button type="button" aria-label="Close the panel" title="Close" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><ArrowRightToLine className="h-4 w-4" aria-hidden /></button>
        </div>
      </div>
      {sure && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-accent-red-deep/10 px-5 py-2 text-[13px]">
          <span>Delete this to-do{subtasks.length > 0 ? ` and its ${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}` : ''} for everyone?</span>
          <span className="flex gap-1">
            <button type="button" onClick={() => setSure(false)} className="h-8 rounded-md px-3 font-medium hover:bg-muted">Keep it</button>
            <button type="button" onClick={() => void send(`/api/todos/${t.id}`, { method: 'DELETE' }, 'Deleted').then(ok => { if (ok) onDeleted() })} className="h-8 rounded-md bg-accent-red-deep px-3 font-semibold text-background">Delete</button>
          </span>
        </div>
      )}
      {waiting.length > 0 && !done && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent-red-deep/10 px-5 py-2 text-[13px] text-accent-red-deep">
          <Hourglass className="h-4 w-4" aria-hidden /> Waiting on {waiting.length} task{waiting.length === 1 ? '' : 's'}: {waiting.map(w => w.title).join(', ')}
        </div>
      )}
      <input ref={fileInput} type="file" multiple className="hidden" aria-label="Files for this to-do" onChange={e => { void add(Array.from(e.target.files ?? [])); e.target.value = '' }} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className={`flex flex-col gap-5 px-6 pb-6 pt-4 ${wrap}`}>
          {parent && (
            <button type="button" onClick={() => onOpen(parent.id)} className="-mb-3 inline-flex items-center gap-1 self-start text-[12px] text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> {parent.title}
            </button>
          )}
          <textarea value={title} rows={1} readOnly={!editable} aria-label="Task name" onChange={e => setTitle(e.target.value)}
            onBlur={() => { const v = title.trim(); if (v && v !== t.title) void patch({ title: v }); else setTitle(t.title) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
            className={`-mx-1.5 resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[24px] font-semibold leading-tight outline-none [field-sizing:content] hover:border-border focus:border-foreground/30 ${done ? 'text-muted-foreground' : ''}`} />

          <dl className="flex flex-col gap-1">
            <div className="flex min-h-9 items-center gap-3">
              <dt className={label}>Assignee</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <Avatar name={names.get(t.owner_id ?? '') ?? '?'} />
                <Select disabled={!editable} value={t.owner_id ?? viewer.id} onValueChange={v => void patch({ owner_id: v }, 'Reassigned')}>
                  <SelectTrigger className="h-8 w-56 rounded-md border-transparent px-2 text-[14px] hover:border-border" aria-label="Assignee"><SelectValue /></SelectTrigger>
                  <SelectContent>{people.map(p => <SelectItem key={p.id} value={p.id}>{p.id === viewer.id ? 'Me' : p.name}</SelectItem>)}</SelectContent>
                </Select>
              </dd>
            </div>
            <div className="flex min-h-9 items-center gap-3">
              <dt className={label}>Due date</dt>
              <dd className="flex items-center gap-1">
                {/* Asana's due date and "Repeats" (20 Oct 2026) */}
                <DuePicker due={t.due_date} repeat={normaliseRepeat((t as { repeat?: unknown }).repeat)} today={today} done={done} editable={editable}
                  onChange={p => void patch(p as never)} />
              </dd>
            </div>
            {/* CLIENT — Asana's "Projects" row: the client this is for */}
            <div className="flex min-h-9 items-center gap-3">
              <dt className={label}>Client</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-2">
                <Select disabled={!editable} value={t.client_id ?? 'none'} onValueChange={v => void patch({ client_id: v === 'none' ? null : v })}>
                  <SelectTrigger className="h-8 w-56 rounded-md border-transparent px-2 text-[14px] hover:border-border" aria-label="Client"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No client</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </dd>
            </div>
            {/* DEPENDENCIES — Asana's "waiting on": tasks that must be done first */}
            <div className="flex min-h-9 items-start gap-3">
              <dt className={`${label} pt-2`}>Dependencies</dt>
              <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1">
                {blockers.map(b => (
                  <span key={b.id} className={`inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-[13px] ${b.status === 'done' ? 'bg-accent-green-deep/10 text-accent-green-deep line-through' : 'bg-accent-red-deep/10 text-accent-red-deep'}`}>
                    <Hourglass className="h-3 w-3 shrink-0" aria-hidden />
                    <button type="button" onClick={() => onOpen(b.id)} className="truncate hover:underline">{b.title}</button>
                    {editable && <button type="button" aria-label={`Stop waiting on ${b.title}`} onClick={() => void patch({ blocked_by: idsOf(t.blocked_by).filter(x => x !== b.id) })} className="flex h-5 w-5 items-center justify-center rounded hover:bg-foreground/10"><X className="h-3 w-3" aria-hidden /></button>}
                  </span>
                ))}
                {editable && (
                  <Select value="" onValueChange={v => void patch({ blocked_by: [...idsOf(t.blocked_by), v] }, 'Dependency added')}>
                    <SelectTrigger className="h-8 w-48 rounded-md border-transparent px-2 text-[13px] text-muted-foreground hover:border-border" aria-label="Add a dependency"><SelectValue placeholder="Add dependencies" /></SelectTrigger>
                    <SelectContent>
                      {all.filter(x => !x.parent_id && x.status !== 'done' && !idsOf(t.blocked_by).includes(x.id) && mayDependOn(t.id, x.id, all as never)).slice(0, 60).map(x => <SelectItem key={x.id} value={x.id}>{x.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {!editable && blockers.length === 0 && <span className="text-[13px] text-muted-foreground">None</span>}
              </dd>
            </div>
            {t.created_by && names.has(t.created_by) && (
              <div className="flex min-h-9 items-center gap-3">
                <dt className={label}>Created by</dt>
                <dd className="flex items-center gap-2 text-[14px]"><Avatar name={names.get(t.created_by) ?? '?'} />{nameOf(t.created_by)}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-col gap-1.5">
            <h3 className="text-[14px] font-medium">Description</h3>
            {editingNote ? (
              <>
                <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
                  {([['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['ul', List, 'Bulleted list'], ['ol', ListOrdered, 'Numbered list']] as const).map(([k, Icon, name]) => (
                    <button key={k} type="button" aria-label={name} title={name} onMouseDown={e => { e.preventDefault(); format(k) }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><Icon className="h-4 w-4" aria-hidden /></button>
                  ))}
                </div>
                <textarea ref={noteRef} autoFocus value={note} rows={4} placeholder="What is this to-do about?" aria-label="Description"
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); format('bold') } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); format('italic') } }}
                  onBlur={() => { setEditingNote(false); if (note.trim() !== (t.note ?? '').trim()) void patch({ note }) }}
                  className="-mx-2 min-h-24 resize-none rounded-md border border-foreground/30 bg-transparent px-2 py-1.5 text-[14px] outline-none [field-sizing:content]" />
              </>
            ) : (
              <div role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined} aria-label={editable ? 'Edit the description' : undefined}
                onClick={() => editable && setEditingNote(true)} onKeyDown={e => { if (editable && e.key === 'Enter') setEditingNote(true) }}
                className={`-mx-2 min-h-12 rounded-md border border-transparent px-2 py-1.5 text-[14px] ${editable ? 'cursor-text hover:border-border' : ''}`}>
                {note.trim() ? <NoteView text={note} /> : <span className="text-muted-foreground">{editable ? 'What is this to-do about?' : 'No description'}</span>}
              </div>
            )}
          </div>

          {/* SUBTASKS — not on a subtask (one level, as Asana shows by default) */}
          {!t.parent_id && (
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <h3 className="text-[14px] font-medium">Subtasks</h3>
                {mayTalk && <button type="button" aria-label="Add a subtask" onClick={() => setSubDraft('')} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><Plus className="h-4 w-4" aria-hidden /></button>}
              </div>
              {subtasks.length > 0 && (
                <ul className="mt-1 border-t border-border">
                  {subtasks.map(s => {
                    const sDone = s.status === 'done'
                    return (
                      <li key={s.id} className="group flex h-[37px] cursor-pointer items-center border-b border-border hover:bg-muted/60" onClick={() => onOpen(s.id)}>
                        <CheckCircle done={sDone} disabled={!mayEditTodo(viewer, s as never)} label={sDone ? `Mark ${s.title} incomplete` : `Mark ${s.title} complete`}
                          onClick={() => void send(`/api/todos/${s.id}`, { method: 'PATCH', body: JSON.stringify({ status: sDone ? 'open' : 'done' }) })} />
                        <span className={`min-w-0 flex-1 truncate text-[14px] ${sDone ? 'text-muted-foreground' : ''}`}>{s.title}</span>
                        {s.due_date && <span className={`mr-2 text-[12px] ${dueTone(s.due_date, today, sDone)}`}>{shortDue(s.due_date, today)}</span>}
                        {s.owner_id && <span className="mr-2"><Avatar name={names.get(s.owner_id) ?? '?'} /></span>}
                      </li>
                    )
                  })}
                </ul>
              )}
              {subDraft !== null && (
                <div className={`flex h-[37px] items-center border-b border-border ${subtasks.length === 0 ? 'mt-1 border-t' : ''}`}>
                  <span className="flex h-9 w-8 items-center justify-center"><span className="h-4 w-4 rounded-full border border-muted-foreground/60" /></span>
                  <input autoFocus value={subDraft} placeholder="Write a subtask name" aria-label="New subtask name" onChange={e => setSubDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && subDraft.trim()) { void addSub(subDraft); setSubDraft('') } if (e.key === 'Escape') setSubDraft(null) }}
                    onBlur={() => { if (subDraft.trim()) void addSub(subDraft); setSubDraft(null) }}
                    className="h-7 min-w-0 flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-muted-foreground" />
                </div>
              )}
              {mayTalk && subDraft === null && (
                <button type="button" onClick={() => setSubDraft('')} className="mt-1 inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add subtask
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <h3 className="text-[14px] font-medium">Attachments</h3>
              {editable && <button type="button" aria-label="Add an attachment" onClick={() => fileInput.current?.click()} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><Plus className="h-4 w-4" aria-hidden /></button>}
            </div>
            {uploading.length > 0 && <UploadRows uploads={uploading} compact />}
            {files.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {files.map(f => (
                  <li key={f.url} className="flex items-center gap-2 rounded-md border border-border p-1.5 text-[13px]">
                    {isImage(f)
                      // eslint-disable-next-line @next/next/no-img-element -- the person's own upload
                      ? <img src={f.url} alt="" className="h-9 w-9 rounded object-cover" />
                      : <span className="flex h-9 w-9 items-center justify-center rounded bg-muted"><Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden /></span>}
                    <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                    <a href={f.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${f.name}`} className="flex h-8 w-8 items-center justify-center rounded hover:bg-muted"><ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
                    <a href={downloadHref(f) ?? f.url} download={f.name} aria-label={`Download ${f.name}`} className="flex h-8 w-8 items-center justify-center rounded hover:bg-muted"><Download className="h-3.5 w-3.5" aria-hidden /></a>
                    {editable && <button type="button" aria-label={`Remove ${f.name}`} onClick={() => void patch({ files: files.filter(x => x.url !== f.url) })} className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" aria-hidden /></button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* THE FEED — Asana's grey band: Comments / All activity */}
        {mayTalk && (
          <div className="flex flex-1 flex-col border-t border-border bg-muted/40 px-6 py-4"><div className={`flex flex-col gap-3 ${wrap}`}>
            <div className="flex items-center gap-1" role="tablist" aria-label="Comments or all activity">
              {(['comments', 'all'] as const).map(k => (
                <button key={k} type="button" role="tab" aria-selected={feedTab === k} onClick={() => setFeedTab(k)}
                  className={`h-8 rounded-md px-2.5 text-[12px] font-medium ${feedTab === k ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                  {k === 'comments' ? `Comments${comments.length ? ` · ${comments.length}` : ''}` : 'All activity'}
                </button>
              ))}
            </div>
            {created && (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground"><Avatar name={names.get(created.actor_id ?? '') ?? '?'} /><span><strong className="font-medium text-foreground">{nameOf(created.actor_id)}</strong> created this task · {when(created.created_at)}</span></p>
            )}
            <ul className="flex flex-col gap-3">
              {feed.map(item => item.kind === 'comment' ? (
                <CommentItem key={item.c.id} c={item.c} viewer={viewer} names={names} nameOf={nameOf} when={when} send={send} />
              ) : item.a.action === 'todo_made' ? null : (
                <li key={item.a.id} className="pl-8 text-[12px] text-muted-foreground">
                  <strong className="font-medium text-foreground">{nameOf(item.a.actor_id)}</strong> {activityWords(item.a, id => nameOf(id), id => (id ? clientNames.get(id) ?? 'a client' : ''))} · {when(item.a.created_at)}
                </li>
              ))}
              {feedTab === 'comments' && comments.length === 0 && <li className="text-[13px] text-muted-foreground">No comments yet. Ask a question or give an update below — type @ to tag someone.</li>}
            </ul>
            <div ref={feedEnd} />
          </div></div>
        )}
      </div>

      {/* FOOTER — the comment box and the collaborators, always in reach */}
      {mayTalk && (
        <div className="shrink-0 border-t border-border bg-card px-6 py-3"><div className={wrap}>
          <div className="flex gap-2">
            <span className="pt-1"><Avatar name={names.get(viewer.id) ?? 'Me'} size="md" /></span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <MentionBox value={draft} onChange={setDraft} members={members} rows={2} placeholder="Add a comment — type @ to tag someone" onSubmit={() => void post()} id={`todo-comment-${t.id}`} openUp />
              {draft.trim() && (
                <button type="button" disabled={posting} onClick={() => void post()} className="h-8 self-end rounded-md bg-foreground px-3 text-[13px] font-semibold text-background disabled:opacity-60">
                  {posting ? 'Sending…' : 'Comment'}
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span>Collaborators</span>
            <span className="flex -space-x-1.5">
              {[t.owner_id, t.created_by, ...followers].filter((x, i, a): x is string => !!x && a.indexOf(x) === i && names.has(x)).map(id => <Avatar key={id} name={names.get(id) ?? '?'} />)}
            </span>
            {adding ? (
              <Select onValueChange={v => { setAdding(false); void send(`/api/todos/${t.id}/follow`, { method: 'POST', body: JSON.stringify({ on: true, person_id: v }) }, 'Collaborator added').then(() => loadActivity()) }}>
                <SelectTrigger className="h-8 w-48 rounded-md text-[13px]" aria-label="Add a collaborator"><SelectValue placeholder="Pick a person" /></SelectTrigger>
                <SelectContent>{people.filter(p => !followers.includes(p.id) && p.id !== t.owner_id && p.id !== t.created_by).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <button type="button" aria-label="Add a collaborator" onClick={() => setAdding(true)} className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border hover:bg-muted"><Plus className="h-3.5 w-3.5" aria-hidden /></button>
            )}
            <span className="ml-auto">
              {followers.includes(viewer.id) ? (
                <button type="button" onClick={() => void send(`/api/todos/${t.id}/follow`, { method: 'POST', body: JSON.stringify({ on: false }) }, 'You left this to-do')} className="h-8 rounded-md px-2 font-medium hover:bg-muted">Leave task</button>
              ) : !onIt ? (
                <button type="button" onClick={() => void send(`/api/todos/${t.id}/follow`, { method: 'POST', body: JSON.stringify({ on: true }) }, 'You joined this to-do')} className="h-8 rounded-md px-2 font-medium hover:bg-muted">Join task</button>
              ) : null}
            </span>
          </div>
        </div></div>
      )}
    </aside>
  )
}

function CommentItem({ c, viewer, names, nameOf, when, send }: {
  c: TodoComment; viewer: Viewer; names: Map<string, string>; nameOf: (id: string | null) => string; when: (iso: string) => string
  send: (path: string, init: RequestInit, said?: string) => Promise<boolean>
}) {
  const likes = idsOf(c.likes)
  const iLike = likes.includes(viewer.id)
  const mine = c.author_id === viewer.id
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.body)
  return (
    <li className="group flex gap-2" data-todo-comment>
      <Avatar name={names.get(c.author_id ?? '') ?? '?'} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[12px]">
          <strong className="text-[13px] font-semibold">{nameOf(c.author_id)}</strong>
          <span className="text-muted-foreground">{when(String(c.created_at))}{c.edited_at ? ' · edited' : ''}</span>
          <span className="ml-auto flex items-center gap-0.5">
            {mine && !editing && <button type="button" onClick={() => setEditing(true)} className="h-7 rounded px-1.5 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100">Edit</button>}
            {(mine || viewer.role === 'super_admin') && !editing && <button type="button" onClick={() => void send(`/api/todo-comments/${c.id}`, { method: 'DELETE' }, 'Comment deleted')} className="h-7 rounded px-1.5 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus:opacity-100">Delete</button>}
            <button type="button" aria-pressed={iLike} aria-label={iLike ? 'Take back your like' : 'Like this comment'} title={likes.length ? likes.map(nameOf).join(', ') : 'Like'}
              onClick={() => void send(`/api/todo-comments/${c.id}/like`, { method: 'POST', body: JSON.stringify({ on: !iLike }) })}
              className={`inline-flex h-7 items-center gap-1 rounded px-1.5 hover:bg-muted ${iLike ? 'text-accent-blue-deep' : 'text-muted-foreground'} ${likes.length ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden fill={iLike ? 'currentColor' : 'none'} />{likes.length > 0 && likes.length}
            </button>
          </span>
        </div>
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={2} aria-label="Edit your comment"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[14px] outline-none [field-sizing:content]" />
            <span className="flex gap-1 self-end">
              <button type="button" onClick={() => { setText(c.body); setEditing(false) }} className="h-8 rounded-md px-3 text-[13px] hover:bg-muted">Cancel</button>
              <button type="button" onClick={() => void send(`/api/todo-comments/${c.id}`, { method: 'PATCH', body: JSON.stringify({ body: text }) }).then(ok => { if (ok) setEditing(false) })} className="h-8 rounded-md bg-foreground px-3 text-[13px] font-semibold text-background">Save</button>
            </span>
          </div>
        ) : (
          <div className="text-[14px]"><NoteView text={c.body} /></div>
        )}
      </div>
    </li>
  )
}

/** the words, with every address in them a link that opens in a new tab (20 Oct 2026) — a press on one opens it,
 *  it does not start editing the description */
function Linked({ text }: { text: string }) {
  return <>{linkParts(text).map((p, i) => p.href
    ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
        className="break-all text-accent-blue-deep underline underline-offset-2 hover:text-accent-blue">{p.text}</a>
    : <span key={i}>{p.text}</span>)}</>
}

function Spans({ spans }: { spans: NoteSpan[] }) {
  return <>{spans.map((sp, i) => sp.bold ? <strong key={i} className="font-semibold"><Linked text={sp.text} /></strong> : sp.italic ? <em key={i}><Linked text={sp.text} /></em> : <Linked key={i} text={sp.text} />)}</>
}

/** the description as it reads: paragraphs, bullets, numbers, bold, italic — built as elements, never as HTML */
function NoteView({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1.5 break-words">
      {parseNote(text).map((b, i) => b.kind === 'p'
        ? <p key={i}><Spans spans={b.spans} /></p>
        : b.kind === 'ul'
          ? <ul key={i} className="list-disc pl-5">{b.items.map((it, j) => <li key={j}><Spans spans={it} /></li>)}</ul>
          : <ol key={i} className="list-decimal pl-5">{b.items.map((it, j) => <li key={j}><Spans spans={it} /></li>)}</ol>)}
    </div>
  )
}
