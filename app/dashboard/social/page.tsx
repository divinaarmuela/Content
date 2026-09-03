'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { AlertTriangle, BarChart3, MessageSquare, PenLine, Search, Share2 , Zap } from 'lucide-react'
import EmptyState from '../EmptyState'
import SocialChannels from '../clients/SocialChannels'
import { needsAttention, timeLeftWords } from '../../lib/token-health-core'
import PlatformIcon from './PlatformIcon'
import ComposeDialog from './ComposeDialog'
import PageTitle from '../ui/PageTitle'

type Client = {
  id: string
  name: string
  status: 'prospect' | 'active' | 'paused' | 'archived'
}

type Account = {
  id: string
  client_id: string | null
  platform: string
  provider_account_id: string
  username: string | null
  name: string | null
  active: boolean
}
type Health = {
  valid: boolean; expiresAt: string | null; expiresIn: string | null; needsRefresh: boolean
}

/**
 * Social channels, per client.
 *
 * Connecting an account belongs on its own page rather than buried in a client
 * edit form — it is a standing part of running an account, not a detail of the
 * client record.
 */
export default function SocialPage() {
  const [clients, setClients] = useState<Client[] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [health, setHealth] = useState<Record<string, Health>>({})
  const [configured, setConfigured] = useState(true)
  const [search, setSearch] = useState('')
  /** null = closed; '' = open with no client chosen; id = open for that client */
  const [composeFor, setComposeFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [cRes, aRes] = await Promise.all([
        fetch('/api/website/clients'),
        fetch('/api/social/accounts?health=1'),
      ])
      if (cRes.ok) setClients(await cRes.json())
      else { setClients([]); throw new Error('Could not load clients') }

      if (aRes.ok) {
        const json = await aRes.json()
        setAccounts(json.accounts ?? [])
        setHealth(json.health ?? {})
        setConfigured(json.provider?.configured ?? false)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load channels')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = (clients ?? [])
    .filter(c => c.status !== 'archived')
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))

  const clientName = (id: string | null) =>
    (clients ?? []).find(c => c.id === id)?.name ?? 'Unassigned'

  // What the PROVIDER says needs a person, not what a countdown guesses.
  // The old rule was `days <= 14`, which put every TikTok and YouTube account
  // in here permanently: their access tokens last a day by design and renew
  // themselves, so they are always one day from expiry and never in trouble.
  const expiring = needsAttention(
    accounts.filter(a => a.active).map(account => ({ row: account, status: health[account.id] })),
    Date.now(),
  )

  const countFor = (id: string) => accounts.filter(a => a.client_id === id && a.active).length
  const platformsFor = (id: string) =>
    [...new Set(accounts.filter(a => a.client_id === id && a.active).map(a => a.platform))]

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Social channels"
        summary="Connect each client’s accounts. Scheduled posts can only go to the channels linked to that client."
        actions={<>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Find a client…"
                className="w-56 bg-surface pl-8"
              />
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/social/inbox"><MessageSquare className="h-4 w-4" /> Inbox</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/social/analytics"><BarChart3 className="h-4 w-4" /> Analytics</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/social/automations"><Zap className="h-4 w-4" /> Automations</Link>
            </Button>
            <Button size="sm" onClick={() => setComposeFor('')} disabled={!configured}>
              <PenLine className="h-4 w-4" /> New post
            </Button>
          </div>
        </>}
      />

      {!configured && (
        <div className="flex items-start gap-2 rounded-inner border border-accent-amber/35 bg-tint-amber px-3 py-2 text-secondary-13 text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Posting isn&apos;t switched on yet — nobody can schedule or publish from here until someone on our side turns it on.</span>
        </div>
      )}

      {/* Expiring tokens are the failure nobody notices: the scheduler keeps
          queueing, the provider keeps rejecting, and it surfaces as "why has
          nothing posted". So it is called out here, not only on the detail page. */}
      {expiring.length > 0 && (
        <div className="flex items-start gap-2 rounded-inner border border-accent-amber/35 bg-tint-amber px-3 py-2 text-secondary-13 text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <strong>
              {expiring.length} channel{expiring.length > 1 ? 's need' : ' needs'} reconnecting.
            </strong>{' '}
            Until they are, scheduled posts for them will not go out.
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {expiring.map(({ row: account, notice }) => (
                <li key={account.id}>
                  <Link href={`/dashboard/social/${account.id}`} className="underline decoration-dotted">
                    {clientName(account.client_id)} · {account.platform}
                  </Link>
                  {' — '}
                  {notice.level === 'act' ? 'disconnected' : timeLeftWords(notice.daysLeft)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}


      {clients === null ? (
        <Card><CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent></Card>
      ) : visible.length === 0 ? (
        search ? (
          <EmptyState
            icon={Share2}
            title={`No client matches “${search}”`}
            body="Clear the search to see every client with connected accounts."
          />
        ) : (
          <EmptyState
            icon={Share2}
            title="No clients to post for yet"
            body="Social accounts hang off a client, so add the client first — then connect their Instagram, Facebook or TikTok here."
            actionLabel="Go to Clients"
            actionHref="/dashboard/clients"
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(c => (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-card-title">{c.name}</span>
                  <span className="rounded-full bg-foreground/[0.06] px-2.5 py-1.5 text-chip-12 text-muted-foreground">
                    {c.status}
                  </span>

                  {/* what is connected, readable without expanding anything */}
                  <div className="ml-auto flex items-center gap-2">
                    {platformsFor(c.id).length > 0 && (
                      <div className="flex -space-x-1">
                        {platformsFor(c.id).map(p => (
                          <PlatformIcon
                            key={p} platform={p} size={20}
                            className="ring-2 ring-white"
                          />
                        ))}
                      </div>
                    )}
                    <span className="text-secondary-13 text-muted-foreground">
                      {countFor(c.id) === 0
                        ? 'not connected'
                        : `${countFor(c.id)} channel${countFor(c.id) === 1 ? '' : 's'}`}
                    </span>
                    {/* contextual compose: skips choosing the client again.
                        Kept small and in the header row so it does not compete
                        with the primary action above. */}
                    {countFor(c.id) > 0 && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => setComposeFor(c.id)}
                        title={`New post for ${c.name}`}
                      >
                        <PenLine className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <SocialChannels clientId={c.id} onChanged={load} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ComposeDialog
        open={composeFor !== null}
        onOpenChange={o => setComposeFor(o ? (composeFor ?? '') : null)}
        clients={(clients ?? []).filter(c => c.status !== 'archived')}
        accounts={accounts}
        defaultClientId={composeFor ?? undefined}
        onPublished={load}
      />
    </div>
  )
}
