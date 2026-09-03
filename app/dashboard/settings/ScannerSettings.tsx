'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
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
import { techMailto } from '@/app/lib/support-core'

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
  source: 'shared' | 'connected' | 'self'
  connected_by?: string | null
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
  const { user } = useUser()
  const myEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? ''
  const [mailboxes, setMailboxes] = useState<MailboxEntry[]>([])
  /**
   * Raw text of the block lists while they are being typed.
   *
   * These cannot be driven straight from the array. Splitting on every
   * keystroke and rendering the joined result back means the newline you just
   * pressed is removed before it reaches the screen, so a second line is
   * impossible to type. Parsed on blur instead.
   */
  const [listDraft, setListDraft] = useState<{ domains?: string; senders?: string }>({})
  /** Result of the connect round-trip, read once from the URL Google sent us
   *  back to. Cleared from the address bar so a refresh does not re-announce
   *  something that happened five minutes ago. */
  const [connectResult, setConnectResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const r = p.get('inbox')
    if (!r) return
    const detail = p.get('detail')
    const messages: Record<string, { ok: boolean; text: string }> = {
      connected:       { ok: true,  text: `Connected${detail ? ` — ${detail}` : ''}. It will be scanned on the next pass.` },
      denied:          { ok: false, text: 'You cancelled, so nothing was connected.' },
      wrong_domain:    { ok: false, text: 'Only @mdmmarketing.com.au mailboxes can be connected.' },
      no_refresh_token:{ ok: false, text: 'Google did not return a refresh token. Remove this app from that account’s permissions and try again.' },
      no_email:        { ok: false, text: 'Google did not tell us which mailbox that was.' },
      exchange_failed: { ok: false, text: 'Google refused the exchange. Check the redirect URI on the OAuth client.' },
      unauthorised:    { ok: false, text: 'Your session expired during the redirect. Sign in and try again.' },
    }
    setConnectResult(messages[r] ?? { ok: false, text: `Could not connect (${r}).` })
    p.delete('inbox'); p.delete('detail')
    const qs = p.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [denied, setDenied] = useState(false)
  /**
   * ONE save model for the whole page.
   *
   * The Mailboxes switches used to save the moment you flipped them, while
   * everything in Scanning behaviour and both block-lists only changed local
   * state and needed a Save button at the bottom of a THIRD, unrelated card.
   * A person flipped a switch (which took), changed a threshold (which did
   * not), and left. Now nothing saves until the bar at the bottom says so:
   * a flipped switch is a pending change like any other, and Save writes
   * settings and mailboxes together.
   */
  const [saved, setSaved] = useState<Settings | null>(null)
  /** switches flipped but not yet saved, by mailbox address */
  const [mailboxDraft, setMailboxDraft] = useState<Record<string, boolean>>({})
  const settingsDirty = !!settings && !!saved && JSON.stringify(settings) !== JSON.stringify(saved)
  const mailboxChanges = mailboxes.filter(m => m.email in mailboxDraft && mailboxDraft[m.email] !== m.enabled)
  const dirty = settingsDirty || mailboxChanges.length > 0
  const pendingCount = (settingsDirty ? 1 : 0) + mailboxChanges.length

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ingest/settings')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load settings')
      const json = await res.json()
      setSettings(json.settings)
      setSaved(json.settings)
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

  const put = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/ingest/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) {
      if (res.status === 403) setDenied(true)
      throw new Error(json.error ?? 'Could not save')
    }
    return json
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    // the server takes settings and mailboxes as separate writes; the page
    // makes them one action, and reports what actually landed
    const done: string[] = []
    try {
      if (settingsDirty) {
        const json = await put({ settings })
        setSettings(json.settings)
        setSaved(json.settings)
        done.push('scanning settings')
      }
      for (const m of mailboxChanges) {
        const enabled = mailboxDraft[m.email]
        const json = await put({ mailbox: m.email, enabled })
        setMailboxes(json.mailboxes)
        setMailboxDraft(d => { const next = { ...d }; delete next[m.email]; return next })
        done.push(`${m.email} ${enabled ? 'will be scanned' : 'will no longer be scanned'}`)
      }
      toast.success(done.length === 1 && !settingsDirty
        ? `Saved — ${done[0]}`
        : `Saved — ${done.join(', ')}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save', {
        description: done.length > 0 ? `Already saved: ${done.join(', ')}. The rest is still pending.` : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (saved) setSettings(saved)
    setMailboxDraft({})
    setListDraft({})
  }

  /** what a mailbox switch shows: the pending flip if there is one, else the truth */
  const mailboxEnabled = (m: MailboxEntry) => mailboxDraft[m.email] ?? m.enabled

  if (loading) {
    return (
      <Card className="border-border bg-surface">
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
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle>Mailboxes</CardTitle>
          <CardDescription>
            Which addresses the scanner reads. Shared mailboxes come from the server
            configuration; connected ones are team members who signed in with Google.
            Turning one off stops it being scanned without disconnecting it — press
            Save at the bottom of the page for it to take.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {mailboxes.length === 0 && (
            <p className="py-2 text-body-15 text-muted-foreground">
              No mailboxes yet. Connect a Google account above — or ask us to
              connect the shared agency inbox for you.
            </p>
          )}
          {mailboxes.map((m, i) => (
            <div key={m.email}>
              {i > 0 && <Separator />}
              <div className="flex flex-wrap items-center gap-3 py-3">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-body-15">{m.email}</span>
                    <span className="rounded-full bg-foreground/[0.06] px-2.5 py-1.5 text-chip-12 text-muted-foreground">
                      {/* "self" means connected through the dashboard by its
                          owner — not by whoever happens to be reading this */}
                      {m.source === 'shared' ? 'shared'
                        : m.source === 'self'
                          ? (m.connected_by === myEmail ? 'you connected this' : 'connected')
                          : 'connected'}
                    </span>
                    {m.source === 'self' && m.connected_by && m.connected_by !== myEmail && (
                      <span className="text-[12px] text-muted-foreground">
                        by {m.connected_by}
                      </span>
                    )}
                    {m.last_status === 'error' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-tint-red px-2.5 py-1.5 text-chip-12 text-foreground">
                        <AlertTriangle className="h-3 w-3" /> failing
                      </span>
                    )}
                    {m.last_status === 'success' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-tint-green px-2.5 py-1.5 text-chip-12 text-foreground">
                        <CheckCircle2 className="h-3 w-3" /> healthy
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-secondary-13 text-muted-foreground">
                    Last scanned {relative(m.last_run_at)}
                    {typeof m.last_leads_created === 'number' && m.last_leads_created > 0 &&
                      ` · ${m.last_leads_created} lead${m.last_leads_created === 1 ? '' : 's'}`}
                    {m.last_error && (
                      <span className="block truncate text-accent-red">{m.last_error}</span>
                    )}
                  </p>
                </div>
                {mailboxDraft[m.email] !== undefined && mailboxDraft[m.email] !== m.enabled && (
                  <span className="text-[12px] font-medium text-foreground">not saved yet</span>
                )}
                <Switch
                  checked={mailboxEnabled(m)}
                  onCheckedChange={v => setMailboxDraft(d => ({ ...d, [m.email]: v }))}
                  aria-label={`Scan ${m.email}`}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── how it scans ─────────────────────────────────────────────── */}
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle>Scanning behaviour</CardTitle>
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
            <p className="text-secondary-13 text-muted-foreground">
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
            <p className="text-secondary-13 text-muted-foreground">
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
              className="w-full accent-zinc-900"
            />
            <p className="text-secondary-13 text-muted-foreground">
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
            <p className="text-secondary-13 text-muted-foreground">
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
              <p className="text-secondary-13 text-muted-foreground">
                Each person grants read access to their own mailbox, once. Only
                @mdmmarketing.com.au accounts can — Google refuses the rest.
                Switching this off hides the button; inboxes already connected
                keep scanning until someone disconnects them.
              </p>
              {connectResult && (
                <p className={
                  'mt-2 rounded-tile border px-2 py-1.5 text-secondary-13 ' +
                  (connectResult.ok
                    ? 'border-accent-green/30 bg-tint-green text-foreground'
                    : 'border-accent-amber/35 bg-tint-amber text-foreground')
                }>
                  {connectResult.text}
                </p>
              )}
              {settings.allow_self_connect && (() => {
                const mine = mailboxes.filter(m => m.source === 'self')
                // Your own mailbox may already be scanned by another route —
                // hello@ runs on a refresh token set on the server. Offering
                // "Connect my inbox" to someone whose inbox is already covered
                // invites a pointless consent screen.
                const already = mailboxes.find(m => m.email === myEmail)
                return (
                  <div className="mt-2 flex flex-col gap-2">
                    {already && already.source !== 'self' && (
                      <p className="text-secondary-13 text-foreground">
                        Your inbox ({already.email}) is already being scanned
                        {already.source === 'shared'
                          ? ' — configured on the server, nothing to do here.'
                          : ' through your Google account.'}
                      </p>
                    )}
                    {mine.map(m => (
                      <p key={m.email} className="flex flex-wrap items-center gap-2 text-secondary-13 text-foreground">
                        <span>Connected: {m.email}</span>
                        <button
                          type="button"
                          className="text-muted-foreground underline-offset-2 hover:underline"
                          onClick={async () => {
                            const res = await fetch('/api/inbox/disconnect', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ email: m.email }),
                            })
                            const json = await res.json().catch(() => ({}))
                            setConnectResult(res.ok
                              ? { ok: true, text: `${m.email} disconnected. ${json.note ?? ''}` }
                              : { ok: false, text: json.error ?? 'Could not disconnect.' })
                            void load()
                          }}
                        >
                          disconnect
                        </button>
                      </p>
                    ))}
                    <a
                      href="/api/inbox/connect"
                      className="inline-flex w-fit items-center gap-1.5 rounded-tile border border-border px-3 py-1.5 text-secondary-13 font-medium transition hover:border-border"
                    >
                      {mine.length > 0 || already ? 'Connect another mailbox' : 'Connect my inbox'}
                    </a>
                  </div>
                )
              })()}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="sched" checked={settings.schedule_enabled}
              onCheckedChange={v => patch({ schedule_enabled: v })}
            />
            <div className="min-w-0">
              <Label htmlFor="sched">Scan automatically</Label>
              <p className="text-secondary-13 text-muted-foreground">
                {schedule?.window ?? 'every 5 minutes, around the clock'}.
                Off means the scanner only runs when someone presses the button.
              </p>

              {/* the toggle is an intention; Inngest is what makes it a fact */}
              {settings.schedule_enabled && schedule && !schedule.connected && (
                <p className="mt-2 flex items-start gap-1.5 rounded-tile border border-accent-amber/35 bg-tint-amber px-2 py-1.5 text-secondary-13 text-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>Not running on its own yet.</strong> Automatic scanning
                    has not been switched on for this workspace, so no scheduled
                    scan has ever run. Until it is, press <strong>Scan now</strong> on
                    the Leads page. <a className="underline" href={techMailto({ subject: 'Automatic inbox scanning is not running' })}>Tell MD Media tech</a>.
                  </span>
                </p>
              )}
              {settings.schedule_enabled && schedule?.connected && (
                <p className="mt-2 text-secondary-13 text-foreground">
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
              <p className="text-secondary-13 text-muted-foreground">
                Skip classification entirely. Mail surviving the spam and newsletter
                filters is flagged “needs review” instead of becoming a lead
                automatically. Use this if the automatic sorting is down —
                enquiries are still captured, just not sorted.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── never a lead ─────────────────────────────────────────────── */}
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
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
              onChange={e => setListDraft(d => ({ ...d, domains: e.target.value }))}
              onBlur={e => {
                patch({ blocked_domains: e.target.value.split(/[\s,]+/).filter(Boolean) })
                setListDraft(d => ({ ...d, domains: undefined }))
              }}
            />
            <p className="text-secondary-13 text-muted-foreground">
              One per line. Subdomains are included automatically.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bs">Blocked senders</Label>
            <Textarea
              id="bs" rows={4}
              placeholder={'noreply@example.com\nsales@vendor.com'}
              value={settings.blocked_senders.join('\n')}
              onChange={e => setListDraft(d => ({ ...d, senders: e.target.value }))}
              onBlur={e => {
                patch({ blocked_senders: e.target.value.split(/[\s,]+/).filter(Boolean) })
                setListDraft(d => ({ ...d, senders: undefined }))
              }}
            />
            <p className="text-secondary-13 text-muted-foreground">
              Full addresses, one per line.
            </p>
          </div>
        </CardContent>

        {denied && (
          <CardFooter className="border-t border-border">
            <p className="text-secondary-13 text-foreground">
              Only a super admin can change scanner settings.
            </p>
          </CardFooter>
        )}
      </Card>

      {/* ── the one Save for the whole page ─────────────────────────── */}
      {/* Sticky, so it is in view whichever of the three cards you changed.
          Before, the button lived at the foot of the LAST card and the
          mailbox switches did not use it at all. */}
      <div className={`sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-inner border px-4 py-3 shadow-lg backdrop-blur ${
        dirty
          ? 'border-accent-amber/35 bg-tint-amber'
          : 'border-border bg-surface/95'
      }`}>
        <p className={`text-body-15 ${dirty ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          {dirty
            ? `You have ${pendingCount === 1 ? 'an unsaved change' : `${pendingCount} unsaved changes`}`
            : 'Everything on this page is saved'}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" onClick={discard} disabled={saving}>Discard</Button>
          )}
          <Button onClick={save} disabled={saving || !dirty}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              : dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>
    </div>
  )
}
