'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CalendarCheck } from 'lucide-react'
import { META_URL_PARAMS } from '@/app/lib/calendly-core'

/** Calendly bookings → the Leads page (9 Nov 2026). One button; pressing it again is safe. */
export default function CalendlyCard() {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  async function connect() {
    setBusy(true)
    try {
      const r = await fetch('/api/calendly/connect', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Could not connect')
      setDone(true); toast.success('Calendly connected. New bookings will show on the Leads page.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not connect') } finally { setBusy(false) }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarCheck className="size-4" /> Calendly bookings</CardTitle>
        <CardDescription>Every call booked or cancelled in Calendly updates the Leads page: name, email, phone, status and which ad it came from.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div><Button onClick={connect} disabled={busy}>{busy ? 'Connecting…' : done ? 'Connected — press again to refresh' : 'Connect Calendly'}</Button></div>
        <div className="text-muted-foreground">
          For ad details (campaign, ad set, ad, placement), paste this into each Meta ad&apos;s <b>URL parameters</b> box:
          <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">{META_URL_PARAMS}</code>
        </div>
      </CardContent>
    </Card>
  )
}
