'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Answers, Completion, TemplateDefinition } from '@/app/lib/intake-core'

type Form = {
  id: string
  token: string
  status: 'draft' | 'sent' | 'in_progress' | 'submitted'
  template_key: string
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
}

type Payload = {
  can_manage: boolean
  form: Form | null
  definition?: TemplateDefinition
  answers?: Answers
  completion?: Completion
  files?: { block_id: string; filename: string; url: string }[]
}

const TYPES = [
  { key: 'ongoing', label: 'Ongoing retainer' },
  { key: 'rebrand', label: 'Rebrand / rebuild' },
  { key: 'launch', label: 'Launch' },
  { key: 'one_off', label: 'One-off project' },
]

const STATUS: Record<Form['status'], string> = {
  draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  sent: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  in_progress: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  submitted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
}

/** "sent 6 days ago · never opened" is the signal that a client has gone quiet.
 *  Absolute dates bury it; a relative one makes it obvious at a glance. */
function relative(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export default function IntakePanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [key, setKey] = useState('ongoing')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/intake`)
    if (!res.ok) { toast.error('Could not load the intake form'); return }
    setData(await res.json())
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const create = async () => {
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_key: key }),
    })
    if (!res.ok) toast.error((await res.json()).error ?? 'Could not create the form')
    else toast.success('Intake form created')
    await load()
    setBusy(false)
  }

  const act = async (action: string, done: string) => {
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/intake`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!res.ok) toast.error((await res.json()).error ?? 'That did not work')
    else toast.success(done)
    await load()
    setBusy(false)
  }

  if (!data) return <Skeleton className="h-40 w-full" />

  // ── no form yet ──
  if (!data.form) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">Intake form</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Sent once, after the kickoff call. Pick the kind of work this is — it
          decides which questions the client is asked.
        </p>
        {data.can_manage ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {TYPES.map(t => (
              <button
                key={t.key} type="button" onClick={() => setKey(t.key)}
                className={
                  'rounded-full border px-3 py-1.5 text-xs transition ' +
                  (key === t.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:border-foreground')
                }
              >
                {t.label}
              </button>
            ))}
            <Button size="sm" disabled={busy} onClick={() => void create()}>
              Create intake form
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No form yet. A super admin can create one.
          </p>
        )}
      </div>
    )
  }

  const form = data.form
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/intake/${form.token}`
  const copy = async () => {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied')
    // copying is how the link actually gets sent, so treat it as the send
    if (form.status === 'draft') await act('mark_sent', 'Marked as sent')
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">Intake form</h3>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS[form.status]}`}>
          {form.status.replace('_', ' ')}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">
          {form.template_key.replace('_', ' ')}
        </span>
        {data.completion && (
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
            {data.completion.answered}/{data.completion.total} answered
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          readOnly value={url} onFocus={e => e.currentTarget.select()}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
        />
        <Button size="sm" variant="secondary" onClick={() => void copy()}>Copy link</Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Sent {relative(form.sent_at)} · opened {relative(form.first_opened_at)}
        {form.submitted_at ? ` · submitted ${relative(form.submitted_at)}` : ''}
      </p>

      {data.can_manage && (
        <div className="flex flex-wrap gap-2">
          {form.status === 'submitted' && (
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => void act('reopen', 'Reopened for edits')}>
              Reopen for edits
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => void act('rotate', 'Link rotated — the old one no longer works')}>
            Rotate link
          </Button>
        </div>
      )}

      {data.completion && data.completion.answered > 0 && data.definition && (
        <div className="flex flex-col gap-5 border-t border-border pt-4">
          {data.definition.sections.map(section => {
            const rows = section.blocks
              .filter(b => b.type !== 'guidance')
              .map(b => {
                const v = data.answers?.[b.id]
                const text = Array.isArray(v) ? v.join(', ') : (v ?? '')
                return text ? { id: b.id, label: b.label, text } : null
              })
              .filter((r): r is { id: string; label: string; text: string } => r !== null)
            const files = (data.files ?? []).filter(f =>
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
  )
}
