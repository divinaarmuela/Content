'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Plus, Workflow } from 'lucide-react'
import PageTitle from '../../../ui/PageTitle'
import EmptyState from '../../../EmptyState'
import PlatformIcon from '../../PlatformIcon'
import {
  COMMENT_PLATFORMS, isFlowPlatform, starterFlow,
  type Flow, type FlowIssue, type FlowPlatform, type WorkflowStatus,
} from '@/app/lib/flow-core'
import type { EditorAccount } from './FlowEditor'

// the canvas measures the window; it is drawn in the browser only
const FlowEditor = dynamic(() => import('./FlowEditor'), { ssr: false, loading: () => <Skeleton className="h-[65vh] w-full" /> })

type SetupClient = { id: string; name: string; problem: string | null; accounts: EditorAccount[] }
type Row = {
  id: string; name: string; status: WorkflowStatus; platform: string
  account: EditorAccount | null; updated_at: string | null; runs: number | null; completed: number | null
}
type Open = {
  id: string | null; status: WorkflowStatus | 'new'; editable: boolean; flow: Flow
  client: { id: string; name: string }; account: EditorAccount
}

const STATUS: Record<WorkflowStatus, { text: string; cls: string }> = {
  draft: { text: 'Draft · off', cls: 'bg-foreground/[0.06]' },
  paused: { text: 'Paused · off', cls: 'bg-tint-amber' },
  active: { text: 'On', cls: 'bg-tint-green' },
  unknown: { text: 'Unknown', cls: 'bg-tint-amber' },
}

const day = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function FlowsPage() {
  const [clients, setClients] = useState<SetupClient[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [clientId, setClientId] = useState<string>('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [read, setRead] = useState(true)
  const [newAccount, setNewAccount] = useState<string>('')
  const [open, setOpen] = useState<Open | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/social/flows').then(r => r.json()).then(b => {
      if (b.error) { toast.error(b.error); setClients([]); return }
      setClients(b.clients ?? [])
      setCanManage(!!b.can_manage)
      if (b.clients?.length === 1) setClientId(b.clients[0].id)
    }).catch(() => setClients([]))
  }, [])

  const loadRows = useCallback(async (cid: string) => {
    setRows(null)
    try {
      const r = await fetch(`/api/social/flows?client_id=${encodeURIComponent(cid)}`)
      const b = await r.json()
      if (!r.ok) { toast.error(b.error ?? 'Could not load the flows'); setRows([]); return }
      setRows(b.rows ?? [])
      setRead(b.read !== false)
    } catch { setRows([]) }
  }, [])

  useEffect(() => { if (clientId) void loadRows(clientId) }, [clientId, loadRows])

  const client = clients?.find(c => c.id === clientId) ?? null

  const openFlow = async (id: string) => {
    setOpening(id)
    try {
      const r = await fetch(`/api/social/flows/${encodeURIComponent(id)}`)
      const b = await r.json() as { error?: string; id: string; status: WorkflowStatus; editable: boolean; flow: Flow; issues: FlowIssue[]; client: { id: string; name: string }; account: EditorAccount }
      if (!r.ok) { toast.error(b.error ?? 'Could not open the flow'); return }
      setOpen({ id: b.id, status: b.status, editable: b.editable, flow: b.flow, client: b.client, account: b.account })
    } catch { toast.error('Could not reach the server') } finally { setOpening(null) }
  }

  const startNew = () => {
    const acc = client?.accounts.find(a => a.id === newAccount)
    if (!client || !acc) return
    const platform = (isFlowPlatform(acc.platform) ? acc.platform : 'instagram') as FlowPlatform
    setOpen({ id: null, status: 'new', editable: true, flow: starterFlow(platform), client: { id: client.id, name: client.name }, account: acc })
  }

  if (open) {
    return (
      <div className="flex flex-col gap-4">
        <FlowEditor
          initial={open.flow} id={open.id} status={open.status} editable={open.editable} canManage={canManage}
          clientId={open.client.id} clientName={open.client.name} account={open.account}
          onBack={() => { setOpen(null); if (clientId) void loadRows(clientId) }}
          onSaved={() => {}}
        />
      </div>
    )
  }

  // a flow starts from a comment automation's button, so new flows go on Instagram or Facebook
  const newChoices = client?.accounts.filter(a => (COMMENT_PLATFORMS as readonly string[]).includes(a.platform)) ?? []

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Flows"
        summary="What happens after someone taps an automation's button: messages, waits, questions and branches, drawn as cards. Saved at Zernio as drafts — switching one on waits for the owner."
        actions={
          <Button size="sm" variant="ghost" asChild>
            <Link href="/dashboard/social/automations"><ArrowLeft className="h-4 w-4" /> Automations</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
          <label className="grid gap-1.5">
            <span className="text-secondary-13 font-medium">Client</span>
            {clients === null ? <Skeleton className="h-10" /> : (
              <Select value={clientId} onValueChange={v => { setClientId(v); setNewAccount('') }}>
                <SelectTrigger><SelectValue placeholder="Pick a client" /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </label>
          {canManage && client && !client.problem && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid min-w-[220px] gap-1.5">
                <span className="text-secondary-13 font-medium">New flow on</span>
                <Select value={newAccount} onValueChange={setNewAccount}>
                  <SelectTrigger><SelectValue placeholder={newChoices.length ? 'Pick an account' : 'No Instagram or Facebook account'} /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    {newChoices.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.username ? `@${a.username}` : a.name ?? a.id} · {a.platform}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <Button size="sm" onClick={startNew} disabled={!newAccount}><Plus className="h-4 w-4" /> New flow</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {client?.problem && (
        <p className="rounded-inner bg-tint-amber px-3 py-2 text-secondary-13">{client.problem}</p>
      )}
      {!read && (
        <p className="rounded-inner bg-tint-amber px-3 py-2 text-secondary-13">Zernio did not answer, so this list may be missing flows.</p>
      )}

      {clients !== null && clients.length === 0 && (
        <EmptyState icon={Workflow} title="No accounts can hold a flow" body="Connect a client's Instagram or Facebook account first." />
      )}

      {clientId && rows === null && <Skeleton className="h-32 w-full" />}
      {clientId && rows !== null && rows.length === 0 && read && (
        <EmptyState icon={Workflow} title="No flows yet" body={canManage ? 'Pick an account above and start one.' : 'An account manager has not made one for this client.'} />
      )}
      {rows && rows.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(r => {
            const st = STATUS[r.status]
            return (
              <button
                key={r.id} onClick={() => openFlow(r.id)} disabled={opening !== null}
                className="grid gap-2 rounded-card border border-border bg-card p-4 text-left transition hover:border-foreground/40 disabled:opacity-60"
              >
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={r.platform} size={18} />
                  <span className="truncate text-card-title">{r.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-secondary-13 text-muted-foreground">
                  <span className={`rounded-full px-2 py-0.5 text-chip-12 text-foreground ${st.cls}`}>{st.text}</span>
                  {r.account?.username && <span>@{r.account.username}</span>}
                  {r.runs !== null && <span>{r.runs} started{r.completed !== null ? ` · ${r.completed} completed` : ''}</span>}
                  {r.updated_at && <span>changed {day(r.updated_at)}</span>}
                  {opening === r.id && <span>Opening…</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
