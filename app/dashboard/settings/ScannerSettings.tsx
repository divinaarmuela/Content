'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AlertTriangle, CheckCircle2, Loader2, Mail, ShieldAlert } from 'lucide-react'

type Settings = {
  lookback_days: number
  max_messages: number
  min_confidence: number
  duplicate_window_days: number
  rules_only: boolean
  schedule_enabled: boolean
  allow_self_connect: boolean
  blocked_domains: string[]
  blocked_senders: string[]
}

type MailboxEntry = {
  email: string
  source: 'shared' | 'connected'
  enabled: boolean
  last_run_at: string | null
  last_status: 'running' | 'success' | 'error' | null
  last_error: string | null
  last_leads_created: number | null
}

function relative(iso: string | null): string {
  if (!iso) return 'never'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

type ScheduleStatus = {
  connected: boolean
  last_scheduled_run: string | null
  window: string
}

export default function ScannerSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [schedule, setSchedule] = useState<ScheduleStatus | null>(null)
  const [mailboxes, setMailboxes] = useState<MailboxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [denied, setDenied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ingest/settings')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load settings')
      const json = await res.json()
      setSettings(json.settings)
      setSchedule(json.schedule ?? null)
      setMailboxes(json.mailboxes ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load scanner settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const patch = (p: Partial<Settings>) =>
    setSettings(s => (s ? { ...s, ...p } : s))

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/ingest/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 403) setDenied(true)
        throw new Error(json.error ?? 'Could not save')
      }
      setSettings(json.settings)
      toast.success('Scanner settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const toggleMailbox = async (email: string, enabled: boolean) => {
    // optimistic — reverted from the server response if it is refused
    setMailboxes(ms => ms.map(m => (m.email === email ? { ...m, enabled } : m)))
    try {
      const res = await fetch('/api/ingest/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailbox: email, enabled }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 403) setDenied(true)
        throw new Error(json.error ?? 'Could not update mailbox')
      }
      setMailboxes(json.mailboxes)
      toast.success(`${email} ${enabled ? 'will be scanned' : 'will no longer be scanned'}`)
    } catch (e) {
      setMailboxes(ms => ms.map(m => (m.email === email ? { ...m, enabled: !enabled } : m)))
      toast.error(e instanceof Error ? e.message : 'Could not update mailbox')
    }
  }

  if (loading) {
    return (
      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardContent className="space-y-3 p-6">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    )
  }

  if (!settings) return null

  return (
    <div className="flex flex-col gap-4">

      {/* ── which mailboxes ──────────────────────────────────────────── */}
      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base">Mailboxes</CardTitle>
          <CardDescription>
            Which addresses the scanner reads. Shared mailboxes come from the server
            configuration; connected ones are team members who signed in with Google.
            Turning one off stops it being scanned without disconnecting it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {mailboxes.length === 0 && (
            <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">
              No mailboxes available yet. Connect a Google account, or set GMAIL_USER
              and GMAIL_REFRESH_TOKEN on the server.
            </p>
          )}
          {mailboxes.map((m, i) => (
            <div key={m.email}>
              {i > 0 && <Separator />}
              <div className="flex flex-wrap items-center gap-3 py-3">
                <Mail className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{m.email}</span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {m.source === 'shared' ? 'shared' : 'connected'}
                    </span>
                    {m.last_status === 'error' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-950/40 dark:text-red-400">
                        <AlertTriangle className="h-3 w-3" /> failing
                      </span>
                    )}
                    {m.last_status === 'success' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> healthy
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Last scanned {relative(m.last_run_at)}
                    {typeof m.last_leads_created === 'number' && m.last_leads_created > 0 &&
                      ` · ${m.last_leads_created} lead${m.last_leads_created === 1 ? '' : 's'}`}
                    {m.last_error && (
                      <span className="block truncate text-red-600 dark:text-red-400">{m.last_error}</span>
                    )}
                  </p>
                </div>
                <Switch
                  checked={m.enabled}
                  onCheckedChange={v => toggleMailbox(m.email, v)}
                  aria-label={`Scan ${m.email}`}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── how it scans ─────────────────────────────────────────────── */}
      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base">Scanning behaviour</CardTitle>
          <CardDescription>
            How far back each pass looks, and how confident the classifier must be
            before an email becomes a lead.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lookback">Look back (days)</Label>
            <Input
              id="lookback" type="number" min={1} max={30}
              value={settings.lookback_days}
              onChange={e => patch({ lookback_days: Number(e.target.value) })}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Mail older than this is ignored. 1–30.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max">Messages per pass</Label>
            <Input
              id="max" type="number" min={1} max={100}
              value={settings.max_messages}
              onChange={e => patch({ max_messages: Number(e.target.value) })}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Per mailbox, newest first. 1–100.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conf">
              Minimum confidence — {Math.round(settings.min_confidence * 100)}%
            </Label>
            <input
              id="conf" type="range" min={0} max={100} step={5}
              value={Math.round(settings.min_confidence * 100)}
              onChange={e => patch({ min_confidence: Number(e.target.value) / 100 })}
              className="w-full accent-zinc-900 dark:accent-zinc-100"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Below this, an email is logged as “not a lead”. Higher means fewer
              false leads and more missed ones.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dupe">Duplicate window (days)</Label>
            <Input
              id="dupe" type="number" min={0} max={365}
              value={settings.duplicate_window_days}
              onChange={e => patch({ duplicate_window_days: Number(e.target.value) })}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              A sender who already became a lead this recently is not duplicated.
              0 disables the check.
            </p>
          </div>
        </CardContent>

        <Separator />

        <CardContent className="flex flex-col gap-4 pt-6">
          {/* ── connect my inbox ── */}
          <div className="flex items-start gap-3">
            <Switch
              id="selfconnect" checked={settings.allow_self_connect}
              onCheckedChange={v => patch({ allow_self_connect: v })}
            />
            <div className="min-w-0 flex-1">
              <Label htmlFor="selfconnect">Let the team connect their own inbox</Label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Each person grants read access to their own mailbox, once. Only
                @mdmmarketing.com.au accounts can — Google refuses the rest.
                Switching this off hides the button; inboxes already connected
                keep scanning until someone disconnects them.
              </p>
              {settings.allow_self_connect && (
                <a
                  href="/api/inbox/connect"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
                >
                  Connect my inbox
                </a>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="sched" checked={settings.schedule_enabled}
              onCheckedChange={v => patch({ schedule_enabled: v })}
            />
            <div className="min-w-0">
              <Label htmlFor="sched">Scan automatically</Label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {schedule?.window ?? '6:00am – 10:45pm Melbourne, every 15 minutes'}.
                Off means the scanner only runs when someone presses the button.
              </p>

              {/* the toggle is an intention; Inngest is what makes it a fact */}
              {settings.schedule_enabled && schedule && !schedule.connected && (
                <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>Not running yet.</strong> The schedule lives in Inngest,
                    which is not connected — so no automatic scan has ever fired.
                    Sync the app at <code>/api/inngest</code> and set
                    INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY. Until then, use
                    “Scan now” on the Leads page.
                  </span>
                </p>
              )}
              {settings.schedule_enabled && schedule?.connected && (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                  Connected · last automatic scan {relative(schedule.last_scheduled_run)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="rules" checked={settings.rules_only}
              onCheckedChange={v => patch({ rules_only: v })}
            />
            <div>
              <Label htmlFor="rules">Rules-only mode (no AI)</Label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Skip classification entirely. Mail surviving the spam and newsletter
                filters is flagged “needs review” instead of becoming a lead
                automatically. Use this if the Anthropic account is unavailable —
                enquiries are still captured, just not sorted.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── never a lead ─────────────────────────────────────────────── */}
      <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            Never a lead
          </CardTitle>
          <CardDescription>
            Senders that are discarded before the classifier sees them. This overrides
            the AI, so it is the right place for a persistent vendor or an internal
            system address.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bd">Blocked domains</Label>
            <Textarea
              id="bd" rows={4}
              placeholder={'spammy-agency.com\nnewsletter.example.net'}
              value={settings.blocked_domains.join('\n')}
              onChange={e => patch({ blocked_domains: e.target.value.split(/[\s,]+/).filter(Boolean) })}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              One per line. Subdomains are included automatically.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bs">Blocked senders</Label>
            <Textarea
              id="bs" rows={4}
              placeholder={'noreply@example.com\nsales@vendor.com'}
              value={settings.blocked_senders.join('\n')}
              onChange={e => patch({ blocked_senders: e.target.value.split(/[\s,]+/).filter(Boolean) })}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Full addresses, one per line.
            </p>
          </div>
        </CardContent>

        <CardFooter className="justify-between border-t border-zinc-200 dark:border-zinc-800">
          {denied ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Only a super admin can change scanner settings.
            </p>
          ) : <span />}
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : 'Save settings'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
