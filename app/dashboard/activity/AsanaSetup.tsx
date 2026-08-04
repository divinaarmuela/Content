'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Plug, RefreshCw, Link2, CheckCircle2, AlertTriangle, ExternalLink, Radio,
} from 'lucide-react'

type Mapped = { project_gid: string; project_name: string; tracked: boolean; client_id: string | null }
type Hook = { project_gid: string; webhook_gid: string | null; last_heartbeat_at: string | null; last_error: string | null }
type State = {
  configured: boolean
  workspaceGid: string | null
  reachable: boolean
  reachError: string | null
  projects: { gid: string; name: string }[]
  mapped: Mapped[]
  webhooks: Hook[]
  team: { id: string; name: string; email: string; asana_user_gid: string | null }[]
}

/**
 * Admin connection panel.
 *
 * Deliberately shows the *setup path* rather than an error when Asana is not
 * configured — an integration whose unconfigured state is a red toast tells an
 * admin nothing about what to do next.
 */
export default function AsanaSetup() {
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

  const act = async (action: string, extra: Record<string, unknown> = {}, label = action) => {
    setBusy(label)
    try {
      const res = await fetch('/api/team/asana', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
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

  if (!state) return <Skeleton className="h-40 w-full" />

  // ── Not configured: show what is actually needed ──
  if (!state.configured || !state.workspaceGid) {
    const steps = [
      { done: state.configured, label: 'ASANA_PAT', detail: 'Personal access token for a service account that is a member of every tracked project.' },
      { done: !!state.workspaceGid, label: 'ASANA_WORKSPACE_GID', detail: 'From GET /workspaces — the "Find workspace" action below lists them once the token is set.' },
    ]
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex flex-col gap-4 py-6">
          <div className="flex items-start gap-3">
            <Plug className="mt-0.5 h-5 w-5 text-zinc-400" />
            <div>
              <p className="text-sm font-medium">Asana isn’t connected yet</p>
              <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                Two environment variables, then this page fills itself in.
              </p>
            </div>
          </div>

          <ul className="flex flex-col gap-2">
            {steps.map(s => (
              <li key={s.label} className="flex items-start gap-2.5 rounded-md border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                {s.done
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  : <span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />}
                <div className="min-w-0">
                  <code className="font-mono text-[11px] text-zinc-900 dark:text-zinc-100">{s.label}</code>
                  <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          {state.configured && !state.workspaceGid && (
            <Button
              variant="outline" size="sm" className="self-start"
              disabled={busy === 'workspaces'}
              onClick={async () => {
                const r = await act('workspaces')
                if (r?.workspaces?.length) {
                  toast.success('Workspaces found', {
                    description: r.workspaces.map((w: { gid: string; name: string }) => `${w.name} — ${w.gid}`).join('\n'),
                    duration: 30000,
                  })
                }
              }}
            >
              Find workspace GID
            </Button>
          )}

          <a
            href="https://developers.asana.com/docs/personal-access-token"
            target="_blank" rel="noreferrer noopener"
            className="inline-flex items-center gap-1 self-start text-[12px] text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            How to create a personal access token <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    )
  }

  // ── Configured ──
  const hookFor = (gid: string) => state.webhooks.find(h => h.project_gid === gid)
  const trackedGids = new Set(state.mapped.filter(m => m.tracked).map(m => m.project_gid))
  const unlinked = state.team.filter(t => !t.asana_user_gid)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${state.reachable ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-sm font-medium">
              {state.reachable ? 'Connected to Asana' : 'Token set, but Asana is unreachable'}
            </span>
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            workspace {state.workspaceGid}
          </span>

          <div className="ml-auto flex gap-2">
            <Button
              variant="outline" size="sm" disabled={busy === 'link-users'}
              onClick={async () => {
                const r = await act('link-users')
                if (r) {
                  toast.success(`${r.linked.length} linked`, {
                    description: r.unmatched.length
                      ? `No Asana account for: ${r.unmatched.join(', ')}`
                      : 'Everyone is matched.',
                  })
                  load()
                }
              }}
            >
              <Link2 className="h-3.5 w-3.5" /> Match people
            </Button>
            <Button
              size="sm" disabled={busy === 'sync'}
              onClick={async () => {
                const r = await act('sync')
                if (r) {
                  toast.success(`Synced ${r.projects} project${r.projects === 1 ? '' : 's'}`, {
                    description: [
                      `${r.newEvents} new events`,
                      `${r.tasksMirrored} tasks mirrored`,
                      r.baselined.length ? `${r.baselined.length} baselined (first sync)` : '',
                      r.errors.length ? `${r.errors.length} failed` : '',
                    ].filter(Boolean).join(' · '),
                  })
                  load()
                }
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sync now
            </Button>
          </div>
        </div>

        {state.reachError && (
          <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {state.reachError}
          </p>
        )}

        {unlinked.length > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {unlinked.length} team member{unlinked.length === 1 ? ' has' : 's have'} no Asana account matched
            ({unlinked.map(u => u.name || u.email).join(', ')}). Their rows stay empty until matched.
          </p>
        )}

        {state.projects.length > 0 && (
          <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                  <TableHead>Project</TableHead>
                  <TableHead className="w-32">Tracked</TableHead>
                  <TableHead className="w-44">Live updates</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.projects.map(p => {
                  const tracked = trackedGids.has(p.gid)
                  const hook = hookFor(p.gid)
                  return (
                    <TableRow key={p.gid}>
                      <TableCell className="text-sm">{p.name}</TableCell>
                      <TableCell>
                        <Button
                          variant={tracked ? 'secondary' : 'ghost'} size="sm"
                          disabled={busy === `track-${p.gid}`}
                          onClick={async () => {
                            const r = await act('track',
                              { projectGid: p.gid, projectName: p.name, tracked: !tracked },
                              `track-${p.gid}`)
                            if (r) load()
                          }}
                        >
                          {tracked ? 'Tracked' : 'Track'}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {hook?.webhook_gid ? (
                          <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 font-normal text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <Radio className="h-3 w-3" /> live
                          </Badge>
                        ) : (
                          <span className="text-xs text-zinc-400">polling only</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {tracked && !hook?.webhook_gid && (
                          <Button
                            variant="outline" size="sm"
                            disabled={busy === `register-${p.gid}`}
                            onClick={async () => {
                              const r = await act('register', { projectGid: p.gid }, `register-${p.gid}`)
                              if (r) { toast.success('Webhook registered'); load() }
                            }}
                          >
                            Go live
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Tracked projects are polled on every sync. “Go live” additionally registers a webhook so
          changes arrive within seconds — it needs this app deployed at a public URL, because Asana
          holds the request open until it can call back.
        </p>
      </CardContent>
    </Card>
  )
}
