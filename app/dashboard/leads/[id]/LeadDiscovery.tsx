'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ClipboardList, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Chip from '../../ui/Chip'
import { copyText } from '../../../lib/copy-text-client'
import type { DiscoveryState } from '../../../lib/lead-discovery-core'

/**
 * THE LEAD'S DISCOVERY FORM (the owner, 20 Nov 2026: "how about in leads page are we tracking client if they fill it
 * out … how can we keep track"). One card on the lead's own page: make the form, copy its link to send, and see where
 * it is up to — not sent, sent, opened, started, filled in — with their answers once there are any. No client record
 * is needed; if the lead becomes a client the form goes with them.
 */
type View = {
  form: { id: string; link: string; created_at: string | null; sent_at: string | null; first_opened_at: string | null; submitted_at: string | null } | null
  state: DiscoveryState
  answers?: { section: string; rows: { label: string; value: string }[] }[]
}

const H = 'font-mono text-[11px] uppercase tracking-widest text-muted-foreground'

export default function LeadDiscovery({ id, onChange }: { id: string; onChange?: () => void }) {
  const [view, setView] = useState<View | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const call = useCallback(async (label: string | null, init?: RequestInit): Promise<View | null> => {
    if (label) setBusy(label)
    try {
      const res = await fetch(`/api/leads/${id}/discovery`, { headers: { 'Content-Type': 'application/json' }, ...init })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Could not read the form')
      setView(json as View); setFailed(null)
      return json as View
    } catch (e) {
      const words = e instanceof Error ? e.message : 'Could not read the form'
      if (label) toast.error(words); else setFailed(words)
      return null
    } finally { if (label) setBusy(null) }
  }, [id])
  useEffect(() => { void call(null) }, [call])

  const copy = async (link: string) => {
    const ok = await copyText(Promise.resolve(link))
    if (!ok) { toast.error('Could not copy. Select the link and copy it yourself.'); return }
    toast.success('Link copied. Paste it into your email or message to them.')
    // copying the link is "sent": the form is marked once, and the timeline says so
    if (view?.state.step === 'made') { await call('Copy', { method: 'PATCH', body: JSON.stringify({ action: 'sent' }) }); onChange?.() }
  }
  const make = async () => {
    const made = await call('Make', { method: 'POST' })
    if (made?.form) { toast.success('Discovery form made. Copy its link to send it.'); onChange?.() }
  }

  return (
    <section aria-label="Discovery form" className="rounded-card border border-border bg-card" data-lead-discovery>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 className={H}>Discovery form</h2>
        {view && <Chip tone={view.state.tone}>{view.state.label}</Chip>}
        {view?.form && (
          <button type="button" onClick={() => void call('Refresh')} disabled={busy !== null}
            className="ml-auto inline-flex min-h-9 items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${busy === 'Refresh' ? 'animate-spin' : ''}`} aria-hidden /> Check again
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        {failed && <p role="alert" className="text-[13px] text-accent-red">{failed}</p>}
        {!view && !failed && <p className="text-[13px] text-muted-foreground">Reading the form…</p>}
        {view && !view.form && (
          <>
            <p className="text-[14px]">Twenty short questions for a potential client: who they are, their goals, what they use today, budget and timing. They fill it in from a link, with no login.</p>
            <div>
              <Button onClick={() => void make()} disabled={busy !== null} className="h-11 rounded-full px-5 text-[13px] font-semibold">
                <ClipboardList className="mr-1.5 h-4 w-4" aria-hidden /> {busy === 'Make' ? 'Making the form…' : 'Make the discovery form'}
              </Button>
            </div>
          </>
        )}
        {view?.form && (
          <>
            <p className="text-[14px]">{view.state.line}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly value={view.form.link} onFocus={e => e.currentTarget.select()} aria-label="The form's link"
                className="h-11 min-w-0 flex-1 basis-full rounded-full sm:basis-0 border border-border bg-surface px-4 text-[13px]" />
              <Button onClick={() => void copy(view.form!.link)} disabled={busy !== null} className="h-11 rounded-full px-5 text-[13px] font-semibold">
                <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Copy link
              </Button>
              <Button variant="outline" asChild className="h-11 rounded-full px-4 text-[13px] font-semibold">
                <a href={view.form.link} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> See the form</a>
              </Button>
            </div>
            {(view.answers ?? []).length > 0 && (
              <div className="mt-1 flex flex-col gap-4 border-t border-border pt-4">
                {view.answers!.map(s => (
                  <div key={s.section}>
                    <h3 className={`mb-2 ${H}`}>{s.section}</h3>
                    <dl className="flex flex-col gap-3">
                      {s.rows.map(r => (
                        <div key={r.label}>
                          <dt className="text-[12px] text-muted-foreground">{r.label}</dt>
                          <dd className="whitespace-pre-wrap text-[14px]">{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
