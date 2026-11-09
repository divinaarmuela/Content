'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Mail, Phone, ExternalLink, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Lead, LeadForm } from '@/app/lib/md-app-leads-core'

/**
 * THE META CARD'S LEADS TAB (9 Nov 2026). The client Page's instant forms and the leads people sent through them —
 * name, email, phone and every other answer — read through the client's own MD App connection. What Meta's App
 * Review watches for leads_retrieval (with pages_manage_ads).
 */

const when = (t: string | null) => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const TESTING_TOOL = 'https://developers.facebook.com/tools/lead-ads-testing'

export default function MdAppLeads({ clientId }: { clientId: string }) {
  const api = `/api/meta/md-app/leads?clientId=${encodeURIComponent(clientId)}`
  const [forms, setForms] = useState<LeadForm[] | null>(null)
  const [formId, setFormId] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadForms = useCallback(async () => {
    try {
      const res = await fetch(`${api}&view=forms`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Could not read the forms'); setForms([]); return }
      setError(null); setForms(json.forms)
      setFormId(cur => cur ?? json.forms[0]?.id ?? null)
    } catch { setError('Could not reach the server'); setForms([]) }
  }, [api])
  const loadLeads = useCallback(async () => {
    if (!formId) { setLeads(null); return }
    setLeads(null)
    const res = await fetch(`${api}&view=leads&formId=${encodeURIComponent(formId)}`).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { setError(json.error ?? 'Could not read the leads'); setLeads([]); return }
    setError(null); setLeads(json.leads)
  }, [api, formId])
  useEffect(() => { void loadForms() }, [loadForms])
  useEffect(() => { void loadLeads() }, [loadLeads])

  const form = forms?.find(f => f.id === formId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">People who filled in an instant form on this client&apos;s Facebook Page or its ads.</p>
        <Button size="sm" variant="outline" onClick={() => void Promise.all([loadForms(), loadLeads()])}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>
      {error && <p className="rounded-inner bg-tint-red px-3 py-2 text-sm">{error}</p>}

      {!forms ? <p className="text-sm text-muted-foreground">Reading the forms…</p>
        : forms.length === 0 ? (
          <div className="rounded-inner border border-dashed border-border p-6 text-center">
            <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-[14px] font-medium">No instant forms on this Page yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Create one in Meta Business Suite → All tools → Instant Forms. No ad is needed to test it.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            <ul className="divide-y divide-border self-start overflow-hidden rounded-inner border border-border bg-surface">
              {forms.map(f => (
                <li key={f.id}>
                  <button type="button" onClick={() => setFormId(f.id)}
                    className={`flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${formId === f.id ? 'bg-tint-blue' : 'hover:bg-muted/60'}`}>
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{f.name}</span>
                      <span className="text-[11px] capitalize text-muted-foreground">{f.status.toLowerCase()}</span>
                    </span>
                    {f.leads != null && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${f.leads ? 'bg-tint-green' : 'bg-paper text-muted-foreground'}`}>{f.leads}</span>}
                  </button>
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[14px] font-semibold">{form?.name ?? 'Leads'}</h4>
                <a href={TESTING_TOOL} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline"><ExternalLink className="h-3 w-3" /> Send a test lead (Meta)</a>
              </div>
              {!leads ? <p className="text-sm text-muted-foreground">Reading the leads…</p>
                : leads.length === 0 ? <p className="rounded-inner border border-border bg-surface p-4 text-sm text-muted-foreground">No leads on this form yet.</p>
                : (
                  <ul className="space-y-2">
                    {leads.map(l => (
                      <li key={l.id} className="rounded-inner border border-border bg-surface p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-[15px] font-semibold">{l.name ?? 'No name given'}</p>
                          <p className="text-[11px] text-muted-foreground">{when(l.time)} · {l.source}</p>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                          {l.email && <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1.5 hover:underline"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{l.email}</a>}
                          {l.phone && <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1.5 hover:underline"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{l.phone}</a>}
                        </div>
                        {l.other.length > 0 && (
                          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
                            {l.other.map(o => <div key={o.label}><dt className="text-muted-foreground">{o.label}</dt><dd>{o.value}</dd></div>)}
                          </dl>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>
        )}
    </div>
  )
}
