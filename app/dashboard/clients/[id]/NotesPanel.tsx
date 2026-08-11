'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { MessageSquare, Trash2, Users, ShieldCheck, Lock } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Visibility = 'team' | 'admins' | 'private'

type Note = {
  id: string
  body: string
  author_name: string
  created_at: string
  visibility: Visibility
}

// Who each level reaches. Enforced server-side; this is just the label.
const VISIBILITY: Record<Visibility, { label: string; hint: string; icon: typeof Users }> = {
  team:    { label: 'Whole team',  hint: 'Anyone who can open this client', icon: Users },
  admins:  { label: 'Admins only', hint: 'Super admins only',               icon: ShieldCheck },
  private: { label: 'Only me',     hint: 'Nobody else, including admins',   icon: Lock },
}

/** Exact timestamp on hover, human distance at a glance. */
function when(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?'

export default function NotesPanel({ clientId }: { clientId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [draft, setDraft] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('team')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/website/clients/${clientId}/notes`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load notes')
      setNotes(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load notes')
      setNotes([])
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const add = async () => {
    const body = draft.trim()
    if (!body) return
    setSaving(true)
    try {
      const res = await fetch(`/api/website/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, visibility }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save note')
      setDraft('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <Textarea
            rows={3}
            value={draft}
            placeholder="What happened? Decisions, calls, things the next person needs to know."
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              // long notes are normal here, so Enter must not submit —
              // ⌘/Ctrl+Enter is the deliberate send
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add() }
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Select value={visibility} onValueChange={v => setVisibility(v as Visibility)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(VISIBILITY) as Visibility[]).map(key => {
                  const Icon = VISIBILITY[key].icon
                  return (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" /> {VISIBILITY[key].label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {VISIBILITY[visibility].hint}. Saved with your name and the time.
            </p>

            <Button size="sm" className="ml-auto" onClick={add} disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : 'Add note'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {notes === null ? (
        <Skeleton className="h-40 w-full" />
      ) : notes.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <MessageSquare className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No notes yet. Anything written here is attributed and timestamped.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ol className="flex flex-col">
          {notes.map(n => (
            <li key={n.id} className="group flex gap-3 border-b border-zinc-100 py-4 last:border-b-0 dark:border-zinc-800">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {initials(n.author_name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{n.author_name || 'Unknown'}</span>
                  <span
                    className="font-mono text-[11px] text-zinc-400"
                    title={new Date(n.created_at).toLocaleString('en-AU')}
                  >
                    {when(n.created_at)}
                  </span>
                  {/* Only mark the restricted ones — badging every note "team"
                      would be noise on the default case. */}
                  {n.visibility && n.visibility !== 'team' && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      title={VISIBILITY[n.visibility].hint}
                    >
                      {(() => { const I = VISIBILITY[n.visibility].icon; return <I className="h-2.5 w-2.5" /> })()}
                      {VISIBILITY[n.visibility].label}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      const res = await fetch(`/api/website/clients/${clientId}/notes?noteId=${n.id}`, { method: 'DELETE' })
                      if (!res.ok) return toast.error((await res.json()).error ?? 'Delete failed')
                      load()
                    }}
                    aria-label="Delete note"
                    className="ml-auto text-zinc-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* whitespace-pre-wrap so paragraphs survive as typed */}
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {n.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
