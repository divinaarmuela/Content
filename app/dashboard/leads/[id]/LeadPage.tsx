'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, Copy, Mail, Trash2, UserPlus } from 'lucide-react'
import { useRow, useTable } from '@/lib/db-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import PageTitle from '../../ui/PageTitle'
import Chip from '../../ui/Chip'
import { LoadFailed } from '../../NotSetUp'
import { useRole } from '../../useRole'
import { copyText } from '../../../lib/copy-text-client'
import { acqStageByKey } from '../../../lib/acquisition-core'
import {
  LEAD_FIELDS, enquiryEntries, leadBusiness, leadFromWords, leadName, leadPatch, prospectForLead, prospectPagePath,
  type LeadLike, type ProspectLink,
} from '../../../lib/lead-page-core'

/**
 * ONE LEAD, ON ITS OWN PAGE (the owner, 23 Sep 2026: "this page needs
 * fixing i think drawer and all"). The enquiry as it came in, every time
 * they wrote, the contact details a manager may correct, and the four
 * things to do with it: answer, bring into acquisition, make a client,
 * delete. Live off the row, so the scanner's "they wrote again" appears
 * without a reload.
 */
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const H = 'font-mono text-[11px] uppercase tracking-widest text-muted-foreground'

export default function LeadPage({ id }: { id: string }) {
  const router = useRouter()
  const { can } = useRole()
  const manager = can('account_manager')
  const scheduler = can('scheduler')
  const { row: lead, loading, error } = useRow<LeadLike & { id: string }>('leads', id)
  const { rows: prospects } = useTable<ProspectLink & { id: string }>('prospects')
  const [draft, setDraft] = useState<Partial<LeadLike>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setDraft({}) }, [lead?.id])

  const prospect = lead ? prospectForLead(lead, prospects) : null
  const patch = lead ? leadPatch(lead, draft) : {}
  const dirty = Object.keys(patch).length > 0

  const call = async (label: string, url: string, init: RequestInit, done: (json: Record<string, unknown>) => void) => {
    setBusy(label)
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `${label} failed`)
      done(json)
    } catch (e) { toast.error(e instanceof Error ? e.message : `${label} failed`) } finally { setBusy(null) }
  }

  const save = () => call('Save', `/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, () => { toast.success('Lead updated'); setDraft({}) })
  const bringIn = () => call('Bring in', '/api/leads/acquisition/from-lead', { method: 'POST', body: JSON.stringify({ lead_id: id }) }, json => {
    const p = json.prospect as { id?: string } | undefined
    toast.success('Brought into acquisition — it is a lead at Engaged now')
    if (p?.id) router.push(prospectPagePath(p.id))
  })
  const convert = () => call('Convert', '/api/website/clients/convert-lead', { method: 'POST', body: JSON.stringify({ lead_id: id }) }, json => {
    toast.success(`${json.name} added to clients`, { action: { label: 'Open clients', onClick: () => router.push('/dashboard/clients') } })
  })
  const remove = () => call('Delete', `/api/leads/${id}`, { method: 'DELETE' }, () => { toast.success('Lead deleted'); router.push('/dashboard/leads') })

  if (loading) return <p className="text-[13px] text-muted-foreground">Reading the lead…</p>
  if (error) return <LoadFailed what="this lead" detail={error} onRetry={() => window.location.reload()} />
  if (!lead) return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/leads" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Leads</Link>
      <PageTitle title="No such lead" summary="It may have been deleted, or the link is wrong." />
    </div>
  )

  const entries = enquiryEntries(lead.need)
  const value = (k: keyof LeadLike & string) => (k in draft ? draft[k] : lead[k]) ?? ''

  return (
    <div className="flex flex-col gap-4" data-lead-page>
      <Link href="/dashboard/leads" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Leads</Link>
      <PageTitle
        title={leadBusiness(lead)}
        summary={`${leadName(lead)} · ${leadFromWords(lead.source)} · ${when(lead.created_at)}`}
        actions={<div className="flex flex-wrap items-center gap-2">
          {lead.email && (
            <Button variant="outline" asChild className="h-11 rounded-full px-4 text-[13px] font-semibold">
              <a href={`mailto:${lead.email}`}><Mail className="mr-1.5 h-4 w-4" aria-hidden /> Email them</a>
            </Button>
          )}
          {prospect ? (
            <Button asChild className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
              <Link href={prospectPagePath(prospect.id)}>Open in acquisition <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden /></Link>
            </Button>
          ) : scheduler && (
            <Button onClick={bringIn} disabled={busy !== null} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
              <ArrowRight className="mr-1.5 h-4 w-4" aria-hidden /> Bring into acquisition
            </Button>
          )}
        </div>}
      />

      {lead.next_action && (
        <div role="status" className="rounded-card border border-border bg-tint-amber px-4 py-3 text-[14px]">
          <span className="font-semibold">{lead.next_action}</span>
        </div>
      )}

      {prospect && (
        <p className="text-[13px] text-muted-foreground">
          In acquisition as <Link href={prospectPagePath(prospect.id)} className="font-semibold text-foreground underline-offset-4 hover:underline">{prospect.business ?? leadBusiness(lead)}</Link>
          {prospect.stage ? ` · ${acqStageByKey(prospect.stage).n}. ${acqStageByKey(prospect.stage).label}` : ''}
        </p>
      )}

      <section aria-label="What they wrote" className="rounded-card border border-border bg-card">
        <h2 className={`border-b border-border px-4 py-3 ${H}`}>What they wrote</h2>
        {entries.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted-foreground">No message came with this enquiry.</p> : (
          <ol className="divide-y divide-border">
            {entries.map((e, i) => (
              <li key={i} className="px-4 py-3">
                <p className="mb-1 text-[12px] text-muted-foreground">{e.when ? `Wrote again · ${e.when}` : `${leadFromWords(lead.source)} · ${when(lead.created_at)}`}</p>
                <p className="whitespace-pre-wrap text-[14px]">{e.text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Contact details" className="rounded-card border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className={H}>Contact details</h2>
          {!manager && <Chip tone="muted">Read only — a manager edits these</Chip>}
          {lead.email && (
            <button type="button" onClick={() => void copyText(Promise.resolve(lead.email ?? '')).then(ok => { if (ok) toast.success(`${lead.email} copied`) })}
              className="ml-auto inline-flex min-h-9 items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
              <Copy className="h-3.5 w-3.5" aria-hidden /> Copy email
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LEAD_FIELDS.map(f => (
            <div key={f.key} className={f.long ? 'sm:col-span-2' : ''}>
              <Label htmlFor={`lead-${f.key}`} className="text-[12px] text-muted-foreground">{f.label}</Label>
              {f.long ? (
                <Textarea id={`lead-${f.key}`} value={String(value(f.key))} readOnly={!manager} rows={4}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))} className="mt-1 bg-surface" />
              ) : (
                <Input id={`lead-${f.key}`} value={String(value(f.key))} readOnly={!manager}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))} className="mt-1 bg-surface" />
              )}
            </div>
          ))}
        </div>
        {manager && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={!dirty || busy !== null} className="h-10 rounded-full px-4 text-[13px] font-semibold">{busy === 'Save' ? 'Saving…' : 'Save changes'}</Button>
            {dirty && <Button variant="outline" onClick={() => setDraft({})} className="h-10 rounded-full px-4 text-[13px] font-semibold">Undo</Button>}
          </div>
        )}
      </section>

      {manager && (
        <section aria-label="More" className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={convert} disabled={busy !== null} className="h-10 rounded-full px-4 text-[13px] font-semibold"><UserPlus className="mr-1.5 h-4 w-4" aria-hidden /> Make a client</Button>
          <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy !== null} className="h-10 rounded-full px-4 text-[13px] font-semibold text-accent-red hover:text-accent-red"><Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete</Button>
        </section>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>The enquiry from {leadName(lead)} is removed for good. If they were brought into acquisition, that prospect stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmDelete(false); void remove() }} className="bg-accent-red text-white hover:bg-accent-red/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
