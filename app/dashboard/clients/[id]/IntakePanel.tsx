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
import { ClipboardList, Copy, ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import EmptyState from '../../EmptyState'
import type { Answers, Completion, TemplateDefinition } from '@/app/lib/intake-core'
import { publicUrl } from '@/app/lib/public-url'
import ManagersCard from './ManagersCard'
import IntakeEditor from './IntakeEditor'

type Status = 'draft' | 'sent' | 'in_progress' | 'submitted'

/** Someone who can be picked to receive submission notifications. */
type TeamMember = { name: string; email: string }

type Form = {
  id: string
  title: string
  token: string
  status: Status
  template_key: string
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  notify_emails: string[] | null
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
  const [team, setTeam] = useState<TeamMember[]>([])
  const [defaults, setDefaults] = useState<string[]>([])
  const [recipientsFor, setRecipientsFor] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [applyAll, setApplyAll] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newType, setNewType] = useState('ongoing')
  const [newTitle, setNewTitle] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  // every form across every client, for "start from an existing form"
  const [copySources, setCopySources] = useState<
    { id: string; title: string; client: string; questions: number }[]
  >([])
  const [editing, setEditing] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Form | null>(null)

  const load = useCallback(async (quiet = false) => {
    const res = await fetch(`/api/clients/${clientId}/intake`)
    if (!res.ok) { if (!quiet) toast.error('Could not load intake forms'); return }
    const json = await res.json()
    setForms(json.forms ?? [])
    setCanManage(Boolean(json.can_manage))
    setTeam(json.team ?? [])
    setDefaults(json.default_recipients ?? [])
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
  const { messages, connectionStatus, error: rtError } = useRealtime({
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

  // a websocket that never connects looks identical to one that connects and
  // receives nothing — the poll below covers the difference. Only a real
  // error is worth a line in the console; the status chatter is gone.
  useEffect(() => {
    if (rtError) console.error('[intake realtime]', connectionStatus, rtError)
  }, [connectionStatus, rtError])

  /**
   * Fallback poll, active only while the socket is NOT open.
   *
   * Realtime is the mechanism; this exists so that a subscription which fails
   * to connect degrades to "a few seconds behind" rather than to "nothing
   * updates until you switch tabs" — which is what shipping realtime and
   * deleting the poll in the same change actually produced.
   *
   * Costs nothing when realtime is healthy: `connectionStatus === 'open'`
   * tears the interval down.
   */
  useEffect(() => {
    if (editing || connectionStatus === 'open') return
    const tick = () => { if (!document.hidden) void load(true) }
    const id = window.setInterval(tick, 8_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load, editing, connectionStatus])

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
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      toast.error('Couldn’t copy the link', {
        description: `Select it and copy it by hand: ${url}`, duration: 15_000,
      })
      return
    }
    // copying is how the link actually gets sent — a status nobody remembers
    // to set is a status that lies. One toast for the one click: the second
    // ("Marked as sent") reported a change the person never asked for.
    if (form.status === 'draft') {
      await patch({ form_id: form.id, action: 'mark_sent' }, 'Link copied — the form is now marked as sent')
    } else {
      toast.success('Link copied')
    }
  }

  const startCreating = () => {
    setCreating(true)
    // fetched on open, not on mount — most visits never create
    fetch(`/api/clients/${clientId}/intake?copy_sources=1`)
      .then(r => r.ok ? r.json() : { sources: [] })
      .then(j => setCopySources(j.sources ?? []))
      .catch(() => {})
  }

  if (!forms) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex flex-col gap-4">
      {/* the moment after a brief lands: give the client an owner */}
      <ManagersCard clientId={clientId} hideWhenIdle intakeComplete={forms.some(f => f.status === 'submitted')} />

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
              <Button size="sm" className="ml-auto" onClick={startCreating}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New form
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">New intake form</h3>

              {/* start from an existing form — any client's — or a blank template */}
              {copySources.length > 0 && (
                <select
                  value={copyFrom}
                  onChange={e => setCopyFrom(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Start from a blank template ↓</option>
                  {copySources.map(s => (
                    <option key={s.id} value={s.id}>
                      Duplicate: {s.client} — {s.title} ({s.questions} questions)
                    </option>
                  ))}
                </select>
              )}

              {!copyFrom && (
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
              )}
              <Input
                value={newTitle} placeholder="Name it (optional), e.g. Rebuild campaign brief"
                onChange={e => setNewTitle(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy}
                  onClick={async () => {
                    await post(
                      { template_key: newType, title: newTitle, copy_from_form_id: copyFrom || undefined },
                      'Form created',
                    )
                    setCreating(false); setNewTitle(''); setCopyFrom('')
                  }}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {forms.length === 0 && !creating && (
        <EmptyState
          icon={ClipboardList}
          title="No intake forms yet"
          body={canManage
            ? 'An intake form is the questionnaire a new client fills in after the kickoff call — their answers become the starting brief for all their work. Create one, then copy its link into an email.'
            : 'An intake form is the questionnaire a new client fills in after the kickoff call. An account manager creates it; their answers then appear here.'}
          actionLabel={canManage ? 'New form' : undefined}
          onAction={canManage ? startCreating : undefined}
        />
      )}

      {/* ── one card per form ── */}
      {forms.map(form => {
        const url = publicUrl(`/intake/${form.token}`)
        // editable until submitted: answers key off stable block ids, so a
        // mid-fill edit never touches what the client already typed
        const editable = form.status !== 'submitted'
        const isEditing = editing === form.id

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
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${STATUS_STYLE[form.status]}`}>
                {form.status.replace('_', ' ')}
              </span>
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${TYPE_STYLE}`}>
                {form.template_key.replace('_', ' ')}
              </span>
              <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
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

            <p className="font-mono text-xs text-muted-foreground">
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
                    Questions are locked — the form is submitted. Reopen to edit.
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

            {isEditing && form.status === 'in_progress' && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                The client has this form open or started — saved answers are safe, and
                your changes appear next time they load the link.
              </p>
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

            {/* ── who hears about it ── */}
            {canManage && !isEditing && (
              recipientsFor === form.id ? (
                <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-4">
                  <div>
                    <p className="text-sm font-medium">Notify when this is submitted</p>
                    <p className="text-xs text-muted-foreground">
                      Pick from the team. Nobody selected means nobody is emailed.
                    </p>
                  </div>
                  <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded border border-border bg-background p-2">
                    {team.map(m => {
                      const on = picked.includes(m.email)
                      return (
                        <button
                          key={m.email} type="button"
                          onClick={() => setPicked(p =>
                            on ? p.filter(e => e !== m.email) : [...p, m.email])}
                          className={
                            'flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition ' +
                            (on ? 'bg-primary/10 text-foreground' : 'hover:bg-muted')
                          }
                        >
                          <span className={
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ' +
                            (on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')
                          }>{on ? '✓' : ''}</span>
                          <span className="font-medium">{m.name || m.email}</span>
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{m.email}</span>
                        </button>
                      )
                    })}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={applyAll}
                      onChange={e => setApplyAll(e.target.checked)} />
                    Use this list for all intake forms, not just this one
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy}
                      onClick={async () => {
                        await patch({ form_id: form.id, action: 'set_recipients', emails: picked, apply_to_all: applyAll }, 'Recipients saved')
                        setRecipientsFor(null); setApplyAll(false)
                      }}>Save</Button>
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={async () => {
                        await patch({ form_id: form.id, action: 'set_recipients', emails: null }, 'Back to the default list')
                        setRecipientsFor(null); setApplyAll(false)
                      }}>Use the default</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setRecipientsFor(null); setApplyAll(false) }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPicked(form.notify_emails ?? defaults)
                    setRecipientsFor(form.id)
                  }}
                  className="-mt-1 self-start text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {(() => {
                    const list = form.notify_emails ?? defaults
                    const who = list.length === 0
                      ? (form.notify_emails ? 'nobody' : 'nobody set')
                      : list.length <= 2 ? list.join(', ') : `${list.length} people`
                    return `Notifies ${who}${form.notify_emails ? '' : ' (default)'} · change`
                  })()}
                </button>
              )
            )}

            {/* ── answers live on their own page ── */}
            {form.completion.answered > 0 && !isEditing && (
              <div className="border-t border-border pt-3">
                <Button size="sm" variant="secondary" asChild>
                  <a href={`/dashboard/clients/${clientId}/intake/${form.id}`}>
                    Read the {form.completion.answered} answers
                    {form.files.length > 0 && ` · ${form.files.length} file${form.files.length === 1 ? '' : 's'}`}
                  </a>
                </Button>
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
