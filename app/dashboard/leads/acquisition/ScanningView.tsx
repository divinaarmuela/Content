'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Chip from '../../ui/Chip'
import type { AgentSummary, Finding, MailboxSummary, RecentRead } from '../../../lib/acq-scanning-core'

/**
 * SCANNING (the acquisition blueprint's Scanning page; 22 Sep 2026): what
 * was read, when, from which inbox, and what came of it. Four blocks —
 * the mailboxes, the agent's last pass, the last messages the email scanner
 * looked at, and the findings the agent and the scanner put on prospects.
 * Reads /api/leads/acquisition/scanning; the rules are acq-scanning-core's.
 */
type Answer = { words: string; mailboxes: MailboxSummary[]; recent: RecentRead[]; agent: AgentSummary; findings: Finding[] }

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'
const STATE_TONE: Record<Finding['state'], 'green' | 'amber' | 'muted'> = { recorded: 'green', unsure: 'amber', dismissed: 'muted' }
const STATE_WORD: Record<Finding['state'], string> = { recorded: 'Recorded', unsure: 'Waiting on a Confirm', dismissed: 'Dismissed' }

export default function ScanningView({ onOpen }: { onOpen: (prospectId: string) => void }) {
  const [data, setData] = useState<Answer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/leads/acquisition/scanning', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Could not read the scanners')
      setData(json)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the scanners') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  return (
    <div className="flex flex-col gap-4" data-acq-scanning>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-muted-foreground">{data?.words ?? ''}</p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void load()} className="ml-auto h-9 rounded-full px-3 text-[12px] font-semibold"><RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Read again</Button>
      </div>
      {error && <p role="alert" className="text-[13px] font-medium text-accent-red-deep">{error}</p>}
      {!data && !error && <p className="text-[13px] text-muted-foreground">Reading…</p>}
      {data && (
        <>
          <section aria-label="Mailboxes" className="rounded-card border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Mailboxes read</h2>
            {data.mailboxes.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted-foreground">No mailbox is connected yet — Settings → Inbox scanner.</p> : (
              <ul className="divide-y divide-border">
                {data.mailboxes.map(m => (
                  <li key={m.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                    <span className="font-semibold">{m.email}</span>
                    <Chip tone={m.enabled ? 'green' : 'muted'}>{m.enabled ? 'Read' : 'Switched off'}</Chip>
                    <span className="text-muted-foreground">Last looked {when(m.last_read_at)}</span>
                    <span className="text-muted-foreground">Today: {m.today.read} read · {m.today.skipped} skipped · {m.today.leads} {m.today.leads === 1 ? 'lead' : 'leads'}{m.today.errors ? ` · ${m.today.errors} could not be read` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="The agent" className="rounded-card border border-border bg-card px-4 py-3 text-[13px]">
            <h2 className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">The agent</h2>
            <p>Last pass {when(data.agent.last_pass_at)} · {data.agent.prospects_checked} of {data.agent.prospects_total} prospects looked at so far.</p>
          </section>

          <section aria-label="Findings" className="rounded-card border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">What the agent and the scanner found</h2>
            {data.findings.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted-foreground">Nothing found yet.</p> : (
              <ul className="divide-y divide-border">
                {data.findings.map(f => (
                  <li key={f.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpen(f.prospect_id)} className="font-semibold underline-offset-4 hover:underline">{f.business}</button>
                      <span className="text-muted-foreground"> · {f.label}{f.confidence !== null ? ` · ${Math.round(f.confidence * 100)}% sure` : ''} · by the {f.source}</span>
                      {f.detail && <p className="whitespace-pre-wrap text-muted-foreground">{f.detail}</p>}
                    </div>
                    <div className="flex items-center gap-2"><Chip tone={STATE_TONE[f.state]}>{STATE_WORD[f.state]}</Chip><span className="text-[12px] text-muted-foreground">{when(f.at)}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Messages read" className="rounded-card border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">The last messages the email scanner looked at</h2>
            {data.recent.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted-foreground">Nothing read yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[13px]">
                  <thead className="bg-foreground/[0.04] font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>{['When', 'Inbox', 'From', 'Subject', 'What happened'].map(h => <th key={h} scope="col" className="px-4 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.recent.map(r => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{when(r.at)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{r.mailbox}</td>
                        <td className="px-4 py-2">{r.from}</td>
                        <td className="max-w-[320px] truncate px-4 py-2" title={r.subject}>{r.subject}</td>
                        <td className="px-4 py-2"><Chip tone={r.status === 'lead_created' ? 'green' : r.status === 'error' ? 'red' : 'muted'}>{r.words}</Chip>{r.why && <span className="ml-2 text-muted-foreground">{r.why}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
