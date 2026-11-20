'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, FileText } from 'lucide-react'
import Chip from '../../ui/Chip'
import type { DiscoveryState } from '../../../lib/lead-discovery-core'

/**
 * WHAT THEY ANSWERED ON THE DISCOVERY FORM (the owner, 20 Nov 2026: "make sure answers are filled right in the leads
 * page"). The form is sent cold from one general link and makes this lead when it is sent in, so there is nothing to
 * make or send here: the card is the lead's own answers, question by question, under the form's headings. A lead that
 * did not come from the form has no card at all.
 */
type View = {
  form: { id: string } | null
  state: DiscoveryState
  answers?: { section: string; rows: { label: string; value: string }[] }[]
  files?: { filename: string; url: string }[]
  client_id?: string | null
}

const H = 'font-mono text-[11px] uppercase tracking-widest text-muted-foreground'

export default function LeadDiscovery({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null)
  useEffect(() => {
    let live = true
    void fetch(`/api/leads/${id}/discovery`).then(r => (r.ok ? r.json() : null)).then(j => { if (live && j) setView(j as View) }).catch(() => {})
    return () => { live = false }
  }, [id])

  if (!view?.form) return null
  const answers = view.answers ?? []
  return (
    <section aria-label="Discovery form answers" className="rounded-card border border-border bg-card" data-lead-discovery>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 className={H}>Discovery form answers</h2>
        <Chip tone={view.state.tone}>{view.state.answered} of {view.state.total} answered</Chip>
        {view.client_id && (
          <Link href={`/dashboard/clients/${view.client_id}`} className="ml-auto inline-flex min-h-9 items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
            Open them in Clients <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-5 p-4">
        {answers.length === 0 && <p className="text-[13px] text-muted-foreground">They sent the form in without answering anything.</p>}
        {(view.files ?? []).length > 0 && (
          <div>
            <h3 className={`mb-2 ${H}`}>Files they uploaded</h3>
            <ul className="flex flex-col gap-1.5">
              {view.files!.map(f => (
                <li key={f.url}>
                  <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 break-all text-[14px] font-medium underline-offset-4 hover:underline">
                    <FileText className="h-4 w-4 shrink-0" aria-hidden /> {f.filename}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {answers.map(s => (
          <div key={s.section}>
            <h3 className={`mb-2 ${H}`}>{s.section}</h3>
            <dl className="flex flex-col gap-3">
              {s.rows.map(r => (
                <div key={r.label}>
                  <dt className="text-[12px] text-muted-foreground">{r.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-[14px]">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}
