'use client'

import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { InboundCandidate } from '../../../lib/acq-inbound-core'

/**
 * FROM AN INBOUND LEAD (the blueprint: an enquiry is the signal that makes
 * a lead). The website-form and inbox leads not yet in the system, newest
 * first, each with one press that makes it a prospect at New lead /
 * Engaged. Read from /api/leads/acquisition/from-lead; the live Leads page
 * keeps its rows.
 */
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function InboundSheet({ open, busy, onClose, onBring }: {
  open: boolean
  busy: boolean
  onClose: () => void
  /** make this lead a prospect; true when it landed */
  onBring: (leadId: string) => Promise<boolean>
}) {
  const [rows, setRows] = useState<InboundCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    setError(null)
    try {
      const res = await fetch('/api/leads/acquisition/from-lead', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Could not read the leads')
      setRows(json.candidates ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the leads'); setRows([]) }
  }
  useEffect(() => { if (open) { setRows(null); void load() } }, [open])

  return (
    <Sheet open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-popover sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Inbox className="h-4 w-4" aria-hidden /> From an inbound lead</SheetTitle>
          <SheetDescription>Enquiries through the website form and the inbox that are not in the acquisition system yet. Bringing one in makes it a lead at New lead / Engaged, owned by you, dated from when they wrote.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-2" data-inbound-leads>
          {rows === null && <p className="text-[13px] text-muted-foreground">Reading the leads…</p>}
          {error && <p role="alert" className="text-[13px] font-medium text-accent-red-deep">{error}</p>}
          {rows && rows.length === 0 && !error && <p className="text-[13px] text-muted-foreground">Every inbound lead is already in the system.</p>}
          {rows?.map(c => (
            <div key={c.lead_id} className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-inner border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{c.business}</p>
                <p className="text-[12px] text-muted-foreground">{[c.who, c.email].filter(Boolean).join(' · ') || '—'}</p>
                <p className="text-[12px] text-muted-foreground">{c.from} · {when(c.when)}</p>
                {c.need && <p className="mt-1 text-[13px]">{c.need}</p>}
              </div>
              <Button type="button" disabled={busy} onClick={() => void onBring(c.lead_id).then(ok => { if (ok) setRows(r => (r ?? []).filter(x => x.lead_id !== c.lead_id)) })}
                className="h-9 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background hover:bg-foreground/90">
                Bring in as a lead
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
