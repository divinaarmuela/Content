'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { FileDown, Send, X, Plus, CalendarClock, Mail } from 'lucide-react'
import { useRole } from '../useRole'

type Settings = {
  enabled: boolean
  /** absent on a row written before the field existed */
  recipients?: string[]
  send_day: number
  data_from: string | null
  last_sent_for: string | null
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Month options: current + previous 11. */
function monthOptions(): { label: string; month: number; year: number }[] {
  const out = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, month: d.getMonth() + 1, year: d.getFullYear() })
  }
  return out
}

export default function LeadsReportCard() {
  // account managers view settings and download; changing settings and
  // emailing the report stay super_admin (matching the API)
  const { can } = useRole()
  const canEdit = can('super_admin')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [visible, setVisible] = useState(true)
  const [newRecipient, setNewRecipient] = useState('')
  const [period, setPeriod] = useState('0') // index into monthOptions
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  const options = monthOptions()

  const load = useCallback(async () => {
    const res = await fetch('/api/reports/leads')
    if (res.status === 403) { setVisible(false); return }
    if (!res.ok) {
      toast.error((await res.json()).error ?? 'Could not load report settings')
      setVisible(false)
      return
    }
    setSettings(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (patch: Partial<Settings>) => {
    const res = await fetch('/api/reports/leads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? 'Save failed')
    setSettings(json)
  }

  const addRecipient = () => {
    const email = newRecipient.trim().toLowerCase()
    if (!email || !settings) return
    const current = settings.recipients ?? []
    if (current.includes(email)) return setNewRecipient('')
    save({ recipients: [...current, email] })
    setNewRecipient('')
  }

  const generate = async (action: 'download' | 'send') => {
    const opt = options[Number(period)]
    setBusy(action)
    try {
      const res = await fetch('/api/reports/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: opt.month, year: opt.year, action }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Report failed')
      if (action === 'download') {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `md-media-leads-report-${opt.year}-${String(opt.month).padStart(2, '0')}.pdf`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Report for ${opt.label} downloaded`)
      } else {
        const json = await res.json()
        toast.success(`Report for ${opt.label} sent`, {
          description: `To: ${json.recipients.join(', ')}`,
        })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Report failed')
    } finally {
      setBusy(null)
    }
  }

  if (!visible) return null
  if (!settings) {
    return (
      <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
    )
  }

  /* A settings row written before recipients existed has no array at all.
     The server reads it the same way (report-send.ts), and a report card that
     throws is worse than one with nobody on the list. */
  const recipients = settings.recipients ?? []

  return (
    <Card className="border-accent-blue/25">
      <CardHeader className="flex-row items-center">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-accent-blue-deep" />
          Monthly leads report
        </CardTitle>
        <label className="ml-auto flex items-center gap-2 text-secondary-13 text-muted-foreground">
          <Switch checked={settings.enabled} disabled={!canEdit} onCheckedChange={v => canEdit && save({ enabled: v })} />
          {settings.enabled ? 'Automatic sending on' : 'Automatic sending off'}
        </label>
      </CardHeader>
      <CardContent className="grid gap-5 pt-0 lg:grid-cols-2">
        {/* Settings */}
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label className="text-secondary-13">Recipients</Label>
            <div className="flex flex-wrap gap-1.5">
              {recipients.map(r => (
                <Badge key={r} variant="secondary" className="gap-1 font-normal">
                  {r}
                  {canEdit && (
                    <button
                      aria-label={`Remove ${r}`}
                      onClick={() => save({ recipients: recipients.filter(x => x !== r) })}
                      className="text-muted-foreground hover:text-accent-red"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
              {recipients.length === 0 && (
                <span className="text-secondary-13 text-muted-foreground">No recipients yet</span>
              )}
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <Input
                  value={newRecipient}
                  placeholder="name@mdmmarketing.com.au"
                  onChange={e => setNewRecipient(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addRecipient()}
                  className="text-body-15"
                />
                <Button size="sm" variant="outline" onClick={addRecipient}><Plus className="h-4 w-4" /></Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-secondary-13">Send on day</Label>
              <Select value={String(settings.send_day)} disabled={!canEdit} onValueChange={v => v && canEdit && save({ send_day: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <SelectItem key={d} value={String(d)}>
                      {d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'} of the month
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-secondary-13">Count data from</Label>
              <Input
                type="date"
                value={settings.data_from ?? ''}
                disabled={!canEdit}
                onChange={e => canEdit && save({ data_from: e.target.value || null })}
                className="font-mono text-secondary-13"
              />
            </div>
          </div>
          <p className="text-secondary-13 text-muted-foreground">
            Each month&apos;s report covers the previous calendar month and goes out automatically on the chosen day.
            {settings.last_sent_for && <> Last sent: <span className="font-mono">{settings.last_sent_for}</span>.</>}
          </p>
        </div>

        {/* Manual generation */}
        <div className="flex flex-col gap-3 rounded-inner border border-border p-4">
          <Label className="text-secondary-13">Generate a report now</Label>
          <Select value={period} onValueChange={v => v && setPeriod(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.map((o, i) => (
                <SelectItem key={o.label} value={String(i)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => generate('download')}>
              <FileDown className="h-4 w-4" /> {busy === 'download' ? 'Building…' : 'Download PDF'}
            </Button>
            {canEdit && (
              <Button size="sm" disabled={busy !== null || recipients.length === 0} onClick={() => setConfirmSend(true)}>
                <Send className="h-4 w-4" /> {busy === 'send' ? 'Sending…' : 'Email to recipients'}
              </Button>
            )}
          </div>
          <p className="text-secondary-13 text-muted-foreground">
            Includes lead totals, source split, service interest, inbox scanner stats, and the full lead register.
          </p>
        </div>
      </CardContent>

      {/* Confirm before an outbound send — names exactly who receives it */}
      <AlertDialog open={confirmSend} onOpenChange={o => !busy && setConfirmSend(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send the {options[Number(period)].label} report?</AlertDialogTitle>
            <AlertDialogDescription>
              This emails the PDF immediately. It will be delivered to{' '}
              {recipients.length === 1 ? 'this recipient' : `these ${recipients.length} recipients`}:
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-1.5 rounded-inner border border-border bg-foreground/[0.04] p-3">
            {recipients.map(r => (
              <span key={r} className="flex items-center gap-2 font-mono text-secondary-13 text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0 text-accent-blue-deep" />
                {r}
              </span>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); setConfirmSend(false); generate('send') }}
              disabled={busy !== null}
            >
              <Send className="h-4 w-4" /> Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
