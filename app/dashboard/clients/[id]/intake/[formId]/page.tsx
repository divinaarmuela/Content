'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useRealtime } from 'inngest/react'
import { intakeChannel } from '@/app/inngest/channels'
import { fetchIntakeSubscriptionToken } from '../../actions'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Download, ExternalLink } from 'lucide-react'
import type { Answers, Completion, TemplateDefinition } from '@/app/lib/intake-core'
import { publicUrl } from '@/app/lib/public-url'

type Form = {
  id: string
  title: string
  token: string
  status: string
  template_key: string
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  /** null = inherits the agency default */
  notify_emails: string[] | null
  definition: TemplateDefinition
  answers: Answers
  completion: Completion
  files: { block_id: string; filename: string; url: string }[]
}

/**
 * One intake form's answers, on their own page.
 *
 * Eighty questions is a document, not a panel accessory. Read inline on the
 * client page it competed with contacts, credentials and notes; here it gets
 * the width and the quiet it needs, and can be sent to someone as a link.
 */
export default function IntakeSubmissionPage() {
  const params = useParams<{ id: string; formId: string }>()
  const [form, setForm] = useState<Form | null>(null)
  const [defaults, setDefaults] = useState<string[]>([])
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${params.id}/intake`)
    if (!res.ok) { setMissing(true); return }
    const json = await res.json()
    setDefaults(json.default_recipients ?? [])
    const found = (json.forms ?? []).find((f: Form) => f.id === params.formId)
    if (!found) setMissing(true)
    else setForm(found)
  }, [params.id, params.formId])

  useEffect(() => { void load() }, [load])

  /**
   * This page is where someone sits WATCHING a client fill the form in, so of
   * all places it must be live — yet it shipped as a fetch-once snapshot,
   * which is why answers only appeared after leaving and coming back. Same
   * wiring as IntakePanel: every autosaved field publishes a progress
   * message; refetch on the ones for this form.
   */
  const { messages, connectionStatus } = useRealtime({
    channel: intakeChannel,
    topics: ['progress'] as const,
    token: () => fetchIntakeSubscriptionToken(),
    autoCloseOnTerminal: false,
    // a typing client produces a message per field; batch so the page
    // refetches at most once a second, not per keystroke burst
    bufferInterval: 1_000,
    historyLimit: 10,
  })

  useEffect(() => {
    const latest = messages.last
    if (!latest) return
    const d = latest.data as { form_id?: string }
    if (d?.form_id !== params.formId) return
    void load()
  }, [messages.last, params.formId, load])

  /**
   * Fallback, active only while the socket is NOT open, plus a refetch when
   * the tab regains focus. Degrades a failed subscription to "a few seconds
   * behind" instead of "frozen until remount"; costs nothing while realtime
   * is healthy.
   */
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)
    if (connectionStatus === 'open') {
      return () => document.removeEventListener('visibilitychange', onVisible)
    }
    const id = window.setInterval(() => { if (!document.hidden) void load() }, 8_000)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, connectionStatus])

  if (missing) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link href={`/dashboard/clients/${params.id}/intake`}>
            <ArrowLeft className="h-4 w-4" /> Back to client
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">That intake form no longer exists.</p>
      </div>
    )
  }

  if (!form) return <Skeleton className="h-96 w-full" />

  const link = publicUrl(`/intake/${form.token}`)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link href={`/dashboard/clients/${params.id}/intake`}>
            <ArrowLeft className="h-4 w-4" /> Back to client
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{form.title || 'Intake form'}</h1>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {form.template_key.replace('_', ' ')}
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {form.status.replace('_', ' ')}
          </span>
          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
            {form.completion.answered}/{form.completion.total} answered
          </span>
        </div>

        {/* who heard about this, resolved the same way the submit route does:
            the form's own list, else the agency default, else nobody named */}
        {(() => {
          const list = form.notify_emails ?? defaults
          return (
            <p className="text-xs text-muted-foreground">
              {list.length > 0
                ? <>Notified on submission: <span className="text-foreground">{list.join(', ')}</span>
                    {form.notify_emails ? '' : ' (agency default)'}</>
                : 'Nobody is set to be notified when this is submitted.'}
              {form.sent_at && ` · sent ${form.sent_at.slice(0, 10)}`}
              {form.submitted_at && ` · submitted ${form.submitted_at.slice(0, 10)}`}
            </p>
          )
        })()}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" asChild>
            <a href={link} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open the client's view
            </a>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Print or save as PDF
          </Button>
        </div>
      </div>

      {form.files.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Files they sent
          </h2>
          <ul className="flex flex-col gap-1.5">
            {form.files.map(f => (
              <li key={f.url}>
                <a href={f.url} target="_blank" rel="noreferrer noopener"
                  className="text-sm underline underline-offset-2">
                  {f.filename}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Every section and every question, including the skipped ones — the
          gaps are what a kickoff call is for, so hiding them would hide the
          most useful thing on the page. */}
      {form.definition.sections.map((section, i) => {
        const blocks = section.blocks.filter(b => b.type !== 'guidance')
        if (blocks.length === 0) return null
        const done = form.completion.sections[i]

        return (
          <section key={section.id} className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-3">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h2 className="text-sm font-semibold">{section.title}</h2>
              {done && (
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                  {done.answered}/{done.total}
                </span>
              )}
            </div>

            <dl className="flex flex-col gap-5">
              {blocks.map(b => {
                const v = form.answers[b.id]
                const text = Array.isArray(v) ? v.join(', ') : (v ?? '')
                return (
                  <div key={b.id}>
                    <dt className="text-xs text-muted-foreground">{b.label}</dt>
                    <dd className={
                      'mt-1 whitespace-pre-wrap text-sm leading-relaxed ' +
                      (text ? '' : 'italic text-muted-foreground/60')
                    }>
                      {text || 'Not answered'}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )
      })}
    </div>
  )
}
