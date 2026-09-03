'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLive } from '@/lib/db-client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Download, ExternalLink } from 'lucide-react'
import type { Answers, Completion, TemplateDefinition } from '@/app/lib/intake-core'
import { publicUrl } from '@/app/lib/public-url'

type Form = {
  id: string
  title: string
  period: string
  token: string
  status: string
  sent_at: string | null
  first_opened_at: string | null
  submitted_at: string | null
  notify_emails: string[] | null
  definition: TemplateDefinition
  answers: Answers
  completion: Completion
}

/**
 * One monthly update's answers, on their own page — the model is the intake
 * answers page. Live, because this is where someone sits watching the client
 * fill it in: every autosaved field publishes progress on the monthly channel,
 * and this refetches on the ones for this form. A poll covers a failed socket.
 */
export default function MonthlySubmissionPage() {
  const params = useParams<{ id: string; formId: string }>()
  const [form, setForm] = useState<Form | null>(null)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${params.id}/monthly`)
    if (!res.ok) { setMissing(true); return }
    const json = await res.json()
    const found = (json.forms ?? []).find((f: Form) => f.id === params.formId)
    if (!found) setMissing(true)
    else setForm(found)
  }, [params.id, params.formId])

  useEffect(() => { void load() }, [load])

  /** Same wiring as the intake submission page: refetch on hints for this
   *  form; useLive's own visibility-aware poll covers a dropped socket. */
  const onMonthlyChange = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    const d = hint as { form_id?: string }
    if (d.form_id && d.form_id !== params.formId) return
    void load()
  }, [params.formId, load])
  useLive('monthly', onMonthlyChange, { pollMs: 8_000 })

  if (missing) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link href={`/dashboard/clients/${params.id}/monthly`}>
            <ArrowLeft className="h-4 w-4" /> Back to client
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">That monthly update no longer exists.</p>
      </div>
    )
  }

  if (!form) return <Skeleton className="h-96 w-full" />

  const link = publicUrl(`/monthly/${form.token}`)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link href={`/dashboard/clients/${params.id}/monthly`}>
            <ArrowLeft className="h-4 w-4" /> Back to client
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{form.title || form.period}</h1>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {form.period}
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {form.status.replace('_', ' ')}
          </span>
          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
            {form.completion.answered}/{form.completion.total} answered
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          {(() => {
            const list = form.notify_emails ?? []
            return list.length > 0
              ? <>Notified on submission: <span className="text-foreground">{list.join(', ')}</span></>
              : 'Nobody is set to be notified when this is submitted.'
          })()}
          {form.sent_at && ` · sent ${form.sent_at.slice(0, 10)}`}
          {form.submitted_at && ` · submitted ${form.submitted_at.slice(0, 10)}`}
        </p>

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

      {/* Every section and every question, including the skipped ones — the
          gaps are what a planning call is for. */}
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
