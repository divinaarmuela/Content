'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Plug, RefreshCw, CheckCircle2, AlertTriangle, ExternalLink, Radio } from 'lucide-react'

type State = {
  configured: boolean
  workspaceGid: string | null
  reachable: boolean
  reachError: string | null
  projects: { gid: string; name: string }[]
  mapped: { project_gid: string; tracked: boolean }[]
  webhooks: { project_gid: string; webhook_gid: string | null; last_heartbeat_at: string | null }[]
  team: { id: string; name: string; email: string; asana_user_gid: string | null }[]
}

/**
 * Asana connection — one button.
 *
 * This replaced a per-project table with Track / Go live / Sync now as three
 * separate clicks. Nothing communicated that they had to happen in that order,
 * or that "Go live" only subscribes to *future* changes — so it was easy to
 * register healthy webhooks and still see an empty page, which reads as a
 * broken integration. Connect now does all of it in the order that works.
 */
export default function AsanaSetup({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/team/asana')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load connection')
      setState(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load connection')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (action: string) => {
    setBusy(action)
    try {
      const res = await fetch('/api/team/asana', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.hint ? `${json.error} — ${json.hint}` : json.error ?? 'Failed')
      return json
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
      return null
    } finally {
      setBusy(null)
    }
  }

  if (!state) return <Skeleton className="h-32 w-full" />

  // ── Not configured ──
  if (!state.configured || !state.workspaceGid) {
    const steps = [
      { done: state.configured, label: 'ASANA_PAT', detail: 'Token for a service account that is a member of every project.' },
      { done: !!state.workspaceGid, label: 'ASANA_WORKSPACE_GID', detail: 'The workspace to read from.' },
    ]
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex flex-col gap-4 py-6">
          <div className="flex items-start gap-3">
            <Plug className="mt-0.5 h-5 w-5 text-zinc-400" />
            <div>
              <p className="text-sm font-medium">Asana isn’t connected</p>
              <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                Two environment variables are needed first.
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {steps.map(s => (
              <li key={s.label} className="flex items-start gap-2.5 rounded-md border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                {s.done
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  : <span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />}
                <div>
                  <code className="font-mono text-[11px]">{s.label}</code>
                  <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <a href="https://developers.asana.com/docs/personal-access-token"
            target="_blank" rel="noreferrer noopener"
            className="inline-flex items-center gap-1 self-start text-[12px] text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400">
            How to create a token <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    )
  }

  const tracked = state.mapped.filter(m => m.tracked).length
  const live = state.webhooks.filter(w => w.webhook_gid).length
  const matched = state.team.filter(t => t.asana_user_gid).length
  const connected = tracked > 0 && matched > 0

  const runConnect = async () => {
    const r = await act('connect')
    if (!r) return
    toast.success('Asana connected', {
      description: [
        `${r.people.created + r.people.linked} people matched`,
        `${r.projects} projects tracked`,
        `${r.webhooks.registered} live`,
        `${r.tasks} tasks pulled`,
      ].join(' · '),
    })
    load(); onChanged?.()
  }

  // ── Never connected ──
  if (!connected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-6">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <p className="text-sm font-medium">Ready to connect</p>
          </div>
          <p className="max-w-2xl text-[13px] text-zinc-500 dark:text-zinc-400">
            One click matches your team to their Asana accounts, starts tracking every project,
            turns on live updates, and pulls everyone’s current tasks. Takes about a minute.
          </p>
          <Button onClick={runConnect} disabled={busy === 'connect'}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy === 'connect' ? 'animate-spin' : ''}`} />
            {busy === 'connect' ? 'Connecting…' : 'Connect Asana'}
          </Button>
          {state.reachError && (
            <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-950/40 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {state.reachError}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  // ── Connected ──
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 py-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium">Connected to Asana</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
          <span><span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{matched}</span> people</span>
          <span><span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{tracked}</span> projects</span>
          <span className="flex items-center gap-1">
            <Radio className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{live}</span> live
          </span>
        </div>

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={runConnect} disabled={busy === 'connect'}>
            Re-scan for new people &amp; projects
          </Button>
          <Button size="sm" disabled={busy === 'sync'}
            onClick={async () => {
              const r = await act('sync')
              if (r) {
                toast.success(`${r.tasksMirrored} tasks refreshed`, {
                  description: r.errors?.length ? `${r.errors.length} project(s) failed` : 'Up to date.',
                })
                load(); onChanged?.()
              }
            }}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>

        <p className="w-full text-[11px] text-zinc-500 dark:text-zinc-400">
          Updates arrive automatically — live for tracked projects, plus a safety sweep every 15 minutes.
          Refresh is only for when you don’t want to wait.
        </p>
      </CardContent>
    </Card>
  )
}
