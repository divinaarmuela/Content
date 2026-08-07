'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRealtime } from 'inngest/react'
import { intakeChannel } from '@/app/inngest/channels'
import { fetchIntakeSubscriptionToken } from './actions'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Copy, ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import type { Answers, Completion, TemplateDefinition } from '@/app/lib/intake-core'
import { publicUrl } from '@/app/lib/public-url'
import IntakeEditor from './IntakeEditor'

type Status = 'draft' | 'sent' | 'in_progress' | 'submitted'

type Form = {
  id: string
  title: string
  token: string
  status: Status
  template_key: string
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  definition: TemplateDefinition
  answers: Answers
  completion: Completion
  files: { block_id: string; filename: string; url: string }[]
}

const TYPES = [
  { key: 'ongoing', label: 'Ongoing retainer' },
  { key: 'rebrand', label: 'Rebrand / rebuild' },
  { key: 'launch', label: 'Launch' },
  { key: 'one_off', label: 'One-off project' },
]

/** Each pill sets its own text colour AND border. Without an explicit colour a
 *  pill inherits the card foreground, which in dark mode is near-white — so
 *  every status read as the same white text on a faint tint, which is exactly
 *  the thing a status pill exists to prevent. */
const STATUS_STYLE: Record<Status, string> = {
  draft:
    'border-zinc-300 bg-zinc-100 text-zinc-700 ' +
    'dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  sent:
    'border-blue-300 bg-blue-50 text-blue-700 ' +
    'dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300',
  in_progress:
    'border-amber-300 bg-amber-50 text-amber-800 ' +
    'dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
  submitted:
    'border-emerald-300 bg-emerald-50 text-emerald-700 ' +
    'dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
}

const TYPE_STYLE =
  'border-border bg-muted text-muted-foreground'

/** "sent 6 days ago · never opened" is the signal a client has gone quiet.
 *  An absolute date buries it; a relative one makes it obvious at a glance. */
function relative(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export default function IntakePanel({ clientId }: { clientId: string }) {
  const [forms, setForms] = useState<Form[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newType, setNewType] = useState('ongoing')
  const [newTitle, setNewTitle] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Form | null>(null)

  const load = useCallback(async (quiet = false) => {
    const res = await fetch(`/api/clients/${clientId}/intake`)
    if (!res.ok) { if (!quiet) toast.error('Could not load intake forms'); return }
    const json = await res.json()
    setForms(json.forms ?? [])
    setCanManage(Boolean(json.can_manage))
  }, [clientId])

  useEffect(() => { void load() }, [load])

  /**
   * Watch the client fill it in, live. Every autosaved field publishes a
   * progress message; this refetches on the ones for this client.
   *
   * Never while editing — a refetch mid-edit would replace the draft you are
   * typing into with whatever the server last saw, which is a good way to lose
   * a rewritten question.
   */
  const { messages } = useRealtime({
    channel: intakeChannel,
    topics: ['progress'] as const,
    token: () => fetchIntakeSubscriptionToken(),
    // a fan-out channel never "completes"
    autoCloseOnTerminal: false,
    // a client typing produces a message per field; batch so the panel
    // re-renders a few times a second at most, not per keystroke burst
    bufferInterval: 1_000,
    historyLimit: 10,
  })

  useEffect(() => {
    if (editing) return
    const latest = messages.last
    if (!latest) return
    const d = latest.data as { client_id?: string }
    if (d?.client_id !== clientId) return
    void load(true)
  }, [messages.last, clientId, editing, load])

  const post = async (body: unknown, ok: string) => {
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/intake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) toast.error((await res.json()).error ?? 'That did not work')
    else toast.success(ok)
    await load(); setBusy(false)
  }

  const patch = async (body: unknown, ok: string) => {
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/intake`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error ?? 'That did not work')
    else toast.success(ok)
    await load(); setBusy(false)
    return res.ok
  }

  const remove = async (form: Form, confirmed: boolean) => {
    setBusy(true)
    const qs = new URLSearchParams({ form_id: form.id })
    if (confirmed) qs.set('confirm', 'answers')
    const res = await fetch(`/api/clients/${clientId}/intake?${qs}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (res.status === 409 && json.needs_confirmation) {
      setConfirmDelete(form)
    } else if (!res.ok) {
      toast.error(json.error ?? 'Could not delete')
    } else {
      toast.success('Form deleted')
      setConfirmDelete(null)
    }
    await load(); setBusy(false)
  }

  const copy = async (form: Form) => {
    const url = publicUrl(`/intake/${form.token}`)
    await navigator.clipboard.writeText(url)
    toast.success('Link copied')
    // copying is how the link actually gets sent — a status nobody remembers
    // to set is a status that lies
    if (form.status === 'draft') await patch({ form_id: form.id, action: 'mark_sent' }, 'Marked as sent')
  }

  if (!forms) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex flex-col gap-4">
      {/* ── create ── */}
      {canManage && (
        <div className="rounded-lg border border-border bg-card p-5">
          {!creating ? (
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h3 className="text-sm font-semibold">Intake forms</h3>
                <p className="text-xs text-muted-foreground">
                  A shareable link with no login. Start from a template, then tailor the questions.
                </p>
              </div>
              <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New form
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">New intake form</h3>
              <div className="flex flex-wrap gap-2">
                {TYPES.map(t => (
                  <button
                    key={t.key} type="button" onClick={() => setNewType(t.key)}
                    className={
                      'rounded-full border px-3 py-1.5 text-xs transition ' +
                      (newType === t.key
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-foreground')
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <Input
                value={newTitle} placeholder="Name it (optional), e.g. Rebuild campaign brief"
                onChange={e => setNewTitle(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy}
                  onClick={async () => {
                    await post({ template_key: newType, title: newTitle }, 'Form created')
                    setCreating(false); setNewTitle('')
                  }}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {forms.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No intake forms yet.{canManage ? ' Create one to send after the kickoff call.' : ''}
        </p>
      )}

      {/* ── one card per form ── */}
      {forms.map(form => {
        const url = publicUrl(`/intake/${form.token}`)
        const editable = form.status === 'draft' || form.status === 'sent'
        const isEditing = editing === form.id
        const isOpen = expanded === form.id

        return (
          <div key={form.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              {renaming === form.id ? (
                <Input
                  autoFocus defaultValue={form.title} className="h-8 max-w-xs text-sm"
                  onBlur={async e => {
                    await patch({ form_id: form.id, action: 'rename', title: e.target.value }, 'Renamed')
                    setRenaming(null)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
              ) : (
                <h3 className="text-sm font-semibold">{form.title || 'Intake form'}</h3>
              )}
              {canManage && renaming !== form.id && (
                <Button size="icon" variant="ghost" className="h-6 w-6"
                  onClick={() => setRenaming(form.id)}>
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLE[form.status]}`}>
                {form.status.replace('_', ' ')}
              </span>
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TYPE_STYLE}`}>
                {form.template_key.replace('_', ' ')}
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {form.completion.answered}/{form.completion.total}
              </span>
            </div>

            {/* progress hairline, the same signal the client sees */}
            <div className="h-0.5 w-full rounded bg-muted">
              <div
                className="h-0.5 rounded bg-primary transition-[width] duration-500"
                style={{
                  width: form.completion.total === 0 ? '0%'
                    : `${Math.round((form.completion.answered / form.completion.total) * 100)}%`,
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly value={url} onFocus={e => e.currentTarget.select()}
                className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              />
              <Button size="sm" variant="secondary" onClick={() => void copy(form)}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Preview
                </a>
              </Button>
            </div>

            <p className="font-mono text-[11px] text-muted-foreground">
              sent {relative(form.sent_at)} · opened {relative(form.first_opened_at)}
              {form.submitted_at ? ` · submitted ${relative(form.submitted_at)}` : ''}
            </p>

            {canManage && !isEditing && (
              <div className="flex flex-wrap gap-2">
                {editable ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(form.id)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit questions
                  </Button>
                ) : (
                  <span className="self-center text-xs text-muted-foreground">
                    Questions are locked, the client has started answering.
                  </span>
                )}
                {form.status === 'submitted' && (
                  <Button size="sm" variant="secondary" disabled={busy}
                    onClick={() => void patch({ form_id: form.id, action: 'reopen' }, 'Reopened for edits')}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reopen
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => void patch({ form_id: form.id, action: 'rotate' }, 'Link rotated, the old one is dead')}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Rotate link
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy}
                  onClick={() => void remove(form, false)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            )}

            {isEditing && (
              <IntakeEditor
                definition={form.definition}
                saving={busy}
                onCancel={() => setEditing(null)}
                onSave={async next => {
                  const ok = await patch(
                    { form_id: form.id, action: 'update_definition', definition: next },
                    'Questions saved',
                  )
                  if (ok) setEditing(null)
                }}
              />
            )}

            {/* ── answers ── */}
            {form.completion.answered > 0 && !isEditing && (
              <div className="border-t border-border pt-3">
                <Button size="sm" variant="ghost" className="-ml-2"
                  onClick={() => setExpanded(isOpen ? null : form.id)}>
                  {isOpen ? 'Hide answers' : `Read the ${form.completion.answered} answers`}
                </Button>
                {isOpen && (
                  <div className="mt-3 flex flex-col gap-5">
                    {form.definition.sections.map(section => {
                      const rows = section.blocks
                        .filter(b => b.type !== 'guidance')
                        .map(b => {
                          const v = form.answers[b.id]
                          const text = Array.isArray(v) ? v.join(', ') : (v ?? '')
                          return text ? { id: b.id, label: b.label, text } : null
                        })
                        .filter((r): r is { id: string; label: string; text: string } => r !== null)
                      const files = form.files.filter(f =>
                        section.blocks.some(b => b.id === f.block_id))
                      if (rows.length === 0 && files.length === 0) return null

                      return (
                        <div key={section.id}>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {section.title}
                          </h4>
                          <dl className="flex flex-col gap-3">
                            {rows.map(r => (
                              <div key={r.id}>
                                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                                <dd className="whitespace-pre-wrap text-sm leading-relaxed">{r.text}</dd>
                              </div>
                            ))}
                            {files.map(f => (
                              <div key={f.url}>
                                <dt className="text-xs text-muted-foreground">Attachment</dt>
                                <dd className="text-sm">
                                  <a href={f.url} target="_blank" rel="noreferrer noopener" className="underline">
                                    {f.filename}
                                  </a>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this form and the client&apos;s answers?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.completion.answered} answer
              {confirmDelete?.completion.answered === 1 ? '' : 's'} were written by the client.
              Deleting removes them permanently, there is no undo, and no copy elsewhere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && void remove(confirmDelete, true)}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
