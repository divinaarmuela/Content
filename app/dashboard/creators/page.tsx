'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import PageTitle from '../ui/PageTitle'
import Chip from '../ui/Chip'
import EmptyState from '../EmptyState'
import { CAMPAIGN_STATUSES, seatWords, type Campaign, type CampaignStatus, type SeatCount } from '../../lib/creator-campaign-core'
import { FIELD, LABEL, STATUS_TONE, STATUS_WORDS, whenWords } from './stageWords'

/**
 * CREATOR CAMPAIGNS — the list (the owner, 25 Nov 2026: "a page where we can build this portal … super admins can
 * create for any client and AM can join in … or AM create theirs"). One card per campaign this person may see; the
 * routes decide which those are. A new campaign is a draft the client cannot see until somebody opens it to them.
 */

type Card = Campaign & { client_name: string; counts: SeatCount; with_client: number; creators: number }
type Named = { id: string; name: string }
type Loaded = { campaigns: Card[]; clients: Named[]; me: { id: string; name: string; role: string; mayCreate: boolean } }

export default function CreatorCampaignsPage() {
  const [data, setData] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [client, setClient] = useState('all')
  const [status, setStatus] = useState<'all' | CampaignStatus>('all')
  const [making, setMaking] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/creators', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(json?.error ?? 'The campaigns could not be loaded'); return }
      setProblem(null); setData(json as Loaded)
    } catch {
      setProblem('The campaigns could not be loaded. Check the connection and reload.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const clientsOnList = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of data?.campaigns ?? []) seen.set(c.client_id, c.client_name)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])
  const shown = useMemo(() => (data?.campaigns ?? []).filter(c => (client === 'all' || c.client_id === client) && (status === 'all' || c.status === status)), [data, client, status])

  if (problem) return <div><PageTitle title="Creator campaigns" /><p role="alert" className="rounded-card border border-border bg-surface p-5 text-[14px]">{problem}</p></div>
  if (!data) return <div><PageTitle title="Creator campaigns" /><div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[150px] rounded-card" />)}</div></div>

  const { me } = data
  return (
    <div className="flex flex-col gap-5" data-creator-campaigns>
      <PageTitle
        title="Creator campaigns"
        summary="An event or a content push with creators: who you are thinking of, who the client has said yes to, who is coming."
        actions={me.mayCreate ? (
          <Button className="h-11 rounded-full px-5 text-[14px] font-semibold" onClick={() => setMaking(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New campaign
          </Button>
        ) : undefined}
      />

      {data.campaigns.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {clientsOnList.length > 1 && (
            <label className="flex min-w-[180px] flex-col gap-1">
              <span className={LABEL}>Client</span>
              <select className={FIELD} value={client} onChange={e => setClient(e.target.value)}>
                <option value="all">All clients</option>
                {clientsOnList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex min-w-[160px] flex-col gap-1">
            <span className={LABEL}>Status</span>
            <select className={FIELD} value={status} onChange={e => setStatus(e.target.value as 'all' | CampaignStatus)}>
              <option value="all">Every status</option>
              {CAMPAIGN_STATUSES.map(s => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
            </select>
          </label>
        </div>
      )}

      {data.campaigns.length === 0 ? (
        <EmptyState icon={UsersRound} title="No campaigns yet"
          body={me.mayCreate ? 'Make one for a client, add the creators you are thinking of, then show the client the ones to choose from.' : 'A campaign shows here once somebody adds you to it.'}
          actionLabel={me.mayCreate ? 'New campaign' : undefined} onAction={me.mayCreate ? () => setMaking(true) : undefined} />
      ) : shown.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-5 text-[14px] text-muted-foreground">Nothing matches. Change Client or Status above to see the rest.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map(c => (
            <li key={c.id}>
              <Link href={`/dashboard/creators/${c.id}`} className="flex h-full min-h-[150px] flex-col gap-2 rounded-card border border-border bg-surface p-4 transition-colors hover:border-foreground focus-visible:border-foreground focus-visible:outline-none" data-campaign-card>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{c.client_name}</span>
                  <Chip tone={STATUS_TONE[c.status]}>{STATUS_WORDS[c.status]}</Chip>
                </div>
                <span className="text-[17px] font-semibold leading-snug">{c.title}</span>
                <span className="text-[13px] text-muted-foreground">{[whenWords(c.starts_at), c.place].filter(Boolean).join(' · ') || 'No date yet'}</span>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <Chip tone="surface">{seatWords(c.counts)}</Chip>
                  {c.counts.over && <Chip tone="red">More confirmed than seats</Chip>}
                  {c.with_client > 0 && <Chip tone="amber">{c.with_client} with the client</Chip>}
                  {c.creators === 0 && <Chip tone="muted">No creators yet</Chip>}
                  {c.status === 'live' && !c.client_visible && <Chip tone="muted">Hidden from client</Chip>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {making && <NewCampaign clients={data.clients} onClose={() => setMaking(false)} />}
    </div>
  )
}

/** A new campaign: the client and a name are enough; the rest is filled in on the campaign's own page. */
function NewCampaign({ clients, onClose }: { clients: Named[]; onClose: () => void }) {
  const router = useRouter()
  const [clientId, setClientId] = useState(clients.length === 1 ? clients[0].id : '')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'event' | 'content'>('event')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = async () => {
    setProblem(null)
    if (!clientId) { setProblem('Choose the client'); return }
    if (!title.trim()) { setProblem('Give the campaign a name'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/creators', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, title, kind }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(json?.error ?? 'That did not save'); return }
      router.push(`/dashboard/creators/${json.campaign.id}`)
    } catch {
      setProblem('That did not save. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-popover sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>It starts as a draft. The client sees nothing until you open it to them.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Client</span>
            <select className={FIELD} value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">Choose a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name</span>
            <Input className="h-11" value={title} maxLength={140} onChange={e => setTitle(e.target.value)} placeholder="Creator lunch, summer launch…" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>What it is</span>
            <select className={FIELD} value={kind} onChange={e => setKind(e.target.value as 'event' | 'content')}>
              <option value="event">An event creators come to</option>
              <option value="content">Content creators make</option>
            </select>
          </label>
          {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px] font-medium">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 rounded-full px-4" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button className="h-11 rounded-full px-5 font-semibold" disabled={busy} onClick={() => void save()}>{busy ? 'Making it…' : 'Make it'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
