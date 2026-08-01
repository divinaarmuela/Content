'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { AlertTriangle, PenLine, Search, Share2 } from 'lucide-react'
import SocialChannels from '../clients/SocialChannels'
import PlatformIcon from './PlatformIcon'
import ComposeDialog from './ComposeDialog'

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
type Health = { valid: boolean; expiresAt: string | null; needsRefresh: boolean }

/** Days until a token dies, or null when it is not known. */
function daysLeft(h?: Health): number | null {
  if (!h?.expiresAt) return null
  return Math.ceil((new Date(h.expiresAt).getTime() - Date.now()) / 86400000)
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

  // anything inside a fortnight, already flagged by the provider, or invalid
  const expiring = accounts
    .filter(a => a.active)
    .map(account => ({ account, days: daysLeft(health[account.id]) }))
    .filter(({ account, days }) => {
      const h = health[account.id]
      if (!h) return false
      return !h.valid || h.needsRefresh || (days !== null && days <= 14)
    })
    .sort((a, b) => (a.days ?? -1) - (b.days ?? -1))

  const countFor = (id: string) => accounts.filter(a => a.client_id === id && a.active).length
  const platformsFor = (id: string) =>
    [...new Set(accounts.filter(a => a.client_id === id && a.active).map(a => a.platform))]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Social channels</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Connect each client’s accounts. Scheduled posts can only go to the
            channels linked to that client.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a client…"
              className="w-56 bg-white pl-8 dark:bg-zinc-900"
            />
          </div>
          <Button size="sm" onClick={() => setComposeFor('')} disabled={!configured}>
            <PenLine className="h-4 w-4" /> New post
          </Button>
        </div>
      </div>

      {!configured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Publishing is not configured — set ZERNIO_API_KEY on the server.</span>
        </div>
      )}

      {/* Expiring tokens are the failure nobody notices: the scheduler keeps
          queueing, the provider keeps rejecting, and it surfaces as "why has
          nothing posted". So it is called out here, not only on the detail page. */}
      {expiring.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <strong>
              {expiring.length} channel{expiring.length > 1 ? 's need' : ' needs'} reconnecting soon.
            </strong>{' '}
            Once a token expires, scheduled posts fail silently.
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {expiring.map(({ account, days }) => (
                <li key={account.id}>
                  <Link href={`/dashboard/social/${account.id}`} className="underline decoration-dotted">
                    {clientName(account.client_id)} · {account.platform}
                  </Link>
                  {' — '}
                  {days === null ? 'expired' : days <= 0 ? 'expired' : `${days} day${days === 1 ? '' : 's'} left`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
        <strong>Use a private window when connecting.</strong> The platform will use
        whichever account is already signed in on this browser — connect a client’s
        channel while signed into your own and their posts would publish to yours.
        Check the handle shown after connecting.
      </div>

      {clients === null ? (
        <Card><CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent></Card>
      ) : visible.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Share2 className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {search ? 'No client matches that search.' : 'Add a client first, then connect their channels here.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(c => (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-tight">{c.name}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {c.status}
                  </span>

                  {/* what is connected, readable without expanding anything */}
                  <div className="ml-auto flex items-center gap-2">
                    {platformsFor(c.id).length > 0 && (
                      <div className="flex -space-x-1">
                        {platformsFor(c.id).map(p => (
                          <PlatformIcon
                            key={p} platform={p} size={20}
                            className="ring-2 ring-white dark:ring-zinc-900"
                          />
                        ))}
                      </div>
                    )}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {countFor(c.id) === 0
                        ? 'not connected'
                        : `${countFor(c.id)} channel${countFor(c.id) === 1 ? '' : 's'}`}
                    </span>
                  </div>
                </div>
                <SocialChannels clientId={c.id} onChanged={load} />
                {countFor(c.id) > 0 && (
                  <Button
                    variant="outline" size="sm" className="w-fit"
                    onClick={() => setComposeFor(c.id)}
                  >
                    <PenLine className="h-3.5 w-3.5" /> Post for {c.name}
                  </Button>
                )}
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
