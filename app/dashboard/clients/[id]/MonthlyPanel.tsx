'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLive } from '@/lib/db-client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CalendarDays, Copy, ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import EmptyState from '../../EmptyState'
import type { Answers, Completion, TemplateDefinition } from '@/app/lib/intake-core'
import { MONTH_NAMES } from '@/app/lib/monthly-core'
import { publicUrl } from '@/app/lib/public-url'
import IntakeEditor from './IntakeEditor'

type Status = 'draft' | 'sent' | 'in_progress' | 'submitted'
type TeamMember = { name: string; email: string }

type Form = {
  id: string
  title: string
  month: number
  year: number
  period: string
  token: string
  status: Status
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  notify_emails: string[] | null
  definition: TemplateDefinition
  answers: Answers
  completion: Completion
}

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

function relative(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

/** A checklist of team members to notify — the same control used at creation and
 *  when editing an existing form's recipients. */
function RecipientPicker({
  team, picked, onToggle,
}: { team: TeamMember[]; picked: string[]; onToggle: (email: string) => void }) {
  return (
    <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded border border-border bg-background p-2">
      {team.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">No team members found.</p>
      )}
      {team.map(m => {
        const on = picked.includes(m.email)
        return (
          <button
            key={m.email} type="button" onClick={() => onToggle(m.email)}
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
  )
}

export default function MonthlyPanel({ clientId }: { clientId: string }) {
  const [forms, setForms] = useState<Form[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [previous, setPrevious] = useState<{ label: string; recipients: string[] } | null>(null)

  // create dialog state
  const [creating, setCreating] = useState(false)
  const now = new Date()
  const [newMonth, setNewMonth] = useState(now.getMonth() + 1)
  const [newYear, setNewYear] = useState(now.getFullYear())
  const [newTitle, setNewTitle] = useState('')
  const [copyPrev, setCopyPrev] = useState(false)
  const [picked, setPicked] = useState<string[]>([])

  // per-form recipients editing
  const [recipientsFor, setRecipientsFor] = useState<string | null>(null)
  const [editPicked, setEditPicked] = useState<string[]>([])

  const [editing, setEditing] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Form | null>(null)

  const load = useCallback(async (quiet = false) => {
    const res = await fetch(`/api/clients/${clientId}/monthly`)
    if (!res.ok) { if (!quiet) toast.error('Could not load monthly forms'); return }
    const json = await res.json()
    setForms(json.forms ?? [])
    setCanManage(Boolean(json.can_manage))
    setTeam(json.team ?? [])
    setPrevious(json.previous ?? null)
    if (json.default_month) setNewMonth(json.default_month)
    if (json.default_year) setNewYear(json.default_year)
  }, [clientId])

  useEffect(() => { void load() }, [load])

  // ── watch the client fill it in, live (same wiring as IntakePanel) ──
  const onMonthlyChange = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    if (editing) return
    const d = hint as { client_id?: string }
    if (d.client_id && d.client_id !== clientId) return
    void load(true)
  }, [clientId, editing, load])
  useLive('monthly', onMonthlyChange, { pollMs: 8_000 })

  const patch = async (body: unknown, ok: string) => {
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/monthly`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error ?? 'That did not work')
    else toast.success(ok)
    await load(); setBusy(false)
    return res.ok
  }

  const create = async () => {
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/monthly`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: newMonth, year: newYear, title: newTitle || undefined,
        notify_emails: picked, copy_previous: copyPrev,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error ?? 'That did not work')
    else if (json.existed) toast.info(json.message ?? 'That month already had a form — opened it')
    else toast.success('Monthly form created')
    setCreating(false); setNewTitle(''); setCopyPrev(false); setPicked([])
    await load(); setBusy(false)
  }

  const remove = async (form: Form, confirmed: boolean) => {
    setBusy(true)
    const qs = new URLSearchParams({ form_id: form.id })
    if (confirmed) qs.set('confirm', 'answers')
    const res = await fetch(`/api/clients/${clientId}/monthly?${qs}`, { method: 'DELETE' })
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
    const url = publicUrl(`/monthly/${form.token}`)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      toast.error('Couldn’t copy the link', {
        description: `Select it and copy it by hand: ${url}`, duration: 15_000,
      })
      return
    }
    if (form.status === 'draft') {
      await patch({ form_id: form.id, action: 'mark_sent' }, 'Link copied — the form is now marked as sent')
    } else {
      toast.success('Link copied')
    }
  }

  const startCreating = () => {
    setCreating(true)
    setPicked([])
    setCopyPrev(false)
    setNewTitle('')
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
                <h3 className="text-sm font-semibold">Monthly updates</h3>
                <p className="text-xs text-muted-foreground">
                  A 5-minute check-in the client fills in before each monthly planning call. One per month.
                </p>
              </div>
              <Button size="sm" className="ml-auto" onClick={startCreating}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New month
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold">New monthly update</h3>

              {/* which month */}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Month
                  <select
                    value={newMonth}
                    onChange={e => setNewMonth(Number(e.target.value))}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {MONTH_NAMES.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Year
                  <Input
                    type="number" value={newYear} min={2000} max={2100}
                    onChange={e => setNewYear(Number(e.target.value))}
                    className="h-10 w-28"
                  />
                </label>
              </div>

              <p className="-mt-1 text-xs text-muted-foreground">
                Only one form per client-month. If this month already has one, we&apos;ll just open it.
              </p>

              {previous && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox" checked={copyPrev}
                    onChange={e => {
                      setCopyPrev(e.target.checked)
                      // copying carries last month's recipients forward too
                      if (e.target.checked && picked.length === 0) setPicked(previous.recipients)
                    }}
                  />
                  Copy questions &amp; recipients from {previous.label}
                </label>
              )}

              {/* who gets emailed on submission */}
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-medium">Who receives it when they submit?</p>
                  <p className="text-xs text-muted-foreground">
                    Pick the team members to email the answers &amp; PDF. The client is never emailed.
                    Nobody selected means nobody is emailed.
                  </p>
                </div>
                <RecipientPicker
                  team={team} picked={picked}
                  onToggle={email => setPicked(p =>
                    p.includes(email) ? p.filter(e => e !== email) : [...p, email])}
                />
              </div>

              <Input
                value={newTitle} placeholder="Name it (optional) — defaults to “Monthly update — Month Year”"
                onChange={e => setNewTitle(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void create()}>Create</Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {forms.length === 0 && !creating && (
        <EmptyState
          icon={CalendarDays}
          title="No monthly updates yet"
          body={canManage
            ? 'A monthly update is a short check-in the client fills in before each planning call — last month’s results, what’s coming up, and content ideas. Create one for this month, then copy its link into an email.'
            : 'A monthly update is a short check-in the client fills in before each planning call. An account manager creates it; their answers then appear here.'}
          actionLabel={canManage ? 'New month' : undefined}
          onAction={canManage ? startCreating : undefined}
        />
      )}

      {/* ── one card per month ── */}
      {forms.map(form => {
        const url = publicUrl(`/monthly/${form.token}`)
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
                <h3 className="text-sm font-semibold">{form.title || form.period}</h3>
              )}
              {canManage && renaming !== form.id && (
                <Button size="icon" variant="ghost" className="h-6 w-6"
                  onClick={() => setRenaming(form.id)}>
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {form.period}
              </span>
              <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${STATUS_STYLE[form.status]}`}>
                {form.status.replace('_', ' ')}
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
                      Pick from the team. Nobody selected means nobody is emailed. The client is never emailed.
                    </p>
                  </div>
                  <RecipientPicker
                    team={team} picked={editPicked}
                    onToggle={email => setEditPicked(p =>
                      p.includes(email) ? p.filter(e => e !== email) : [...p, email])}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy}
                      onClick={async () => {
                        await patch({ form_id: form.id, action: 'set_recipients', emails: editPicked }, 'Recipients saved')
                        setRecipientsFor(null)
                      }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRecipientsFor(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditPicked(form.notify_emails ?? [])
                    setRecipientsFor(form.id)
                  }}
                  className="-mt-1 self-start text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {(() => {
                    const list = form.notify_emails ?? []
                    const who = list.length === 0 ? 'nobody'
                      : list.length <= 2 ? list.join(', ') : `${list.length} people`
                    return `Notifies ${who} · change`
                  })()}
                </button>
              )
            )}

            {/* ── answers live on their own page ── */}
            {form.completion.answered > 0 && !isEditing && (
              <div className="border-t border-border pt-3">
                <Button size="sm" variant="secondary" asChild>
                  <a href={`/dashboard/clients/${clientId}/monthly/${form.id}`}>
                    Read the {form.completion.answered} answers
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
            <AlertDialogTitle>Delete this month and the client&apos;s answers?</AlertDialogTitle>
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
