'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AlertTriangle, Link2, Loader2, Plus, RefreshCw, Unlink } from 'lucide-react'

type Account = {
  id: string
  platform: string
  provider_account_id: string
  name: string | null
  username: string | null
  avatar_url: string | null
  active: boolean
}

/** Platforms worth offering first for this agency. The API supports more;
 *  these are the ones MD Media actually publishes to. */
const OFFERED = [
  'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'threads', 'pinterest', 'twitter',
] as const

const LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
  linkedin: 'LinkedIn', youtube: 'YouTube', threads: 'Threads',
  pinterest: 'Pinterest', twitter: 'X (Twitter)',
}

export default function SocialChannels({ clientId }: { clientId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/social/accounts?clientId=${clientId}`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load channels')
      const json = await res.json()
      setAccounts((json.accounts ?? []).filter((a: Account) => a.active))
      setConfigured(json.provider?.configured ?? false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load channels')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  // If the user has just come back from an OAuth round trip, re-sync so the
  // newly authorised account appears without a manual refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) {
      sync().then(() => {
        params.delete('connected')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sync = async () => {
    setBusy('sync')
    try {
      const res = await fetch('/api/social/connect', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not refresh')
      await load()
      toast.success(json.synced > 0 ? `${json.synced} account${json.synced === 1 ? '' : 's'} linked` : 'No accounts found yet')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not refresh')
    } finally {
      setBusy(null)
    }
  }

  const connect = async (platform: string) => {
    setBusy(platform)
    try {
      const res = await fetch('/api/social/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, platform }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not start connection')
      // full navigation, not a popup — the platform's consent screens block
      // being framed, and popups get blocked by the browser
      window.location.href = json.authUrl
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start connection')
      setBusy(null)
    }
  }

  const disconnect = async (id: string) => {
    try {
      const res = await fetch('/api/social/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not disconnect')
      setAccounts(a => a.filter(x => x.id !== id))
      toast.success('Channel removed from this client')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disconnect')
    }
  }

  if (!configured && !loading) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Publishing is not configured — set ZERNIO_API_KEY on the server.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Channels</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {accounts.length} connected
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={sync} disabled={busy === 'sync'}>
            {busy === 'sync'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={Boolean(busy)}>
                <Plus className="h-3.5 w-3.5" /> Connect
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {OFFERED.map(p => (
                <DropdownMenuItem key={p} onClick={() => connect(p)} disabled={busy === p}>
                  {busy === p && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {LABEL[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : accounts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No channels yet. “Connect” opens the platform’s own login — the client’s
          password is never entered here, and posts scheduled for this client can
          only go to the accounts linked below.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {accounts.map(a => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm">{LABEL[a.platform] ?? a.platform}</span>
                {(a.username || a.name) && (
                  <span className="ml-2 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {a.username ? `@${a.username}` : a.name}
                  </span>
                )}
              </div>
              <Button
                variant="ghost" size="sm"
                onClick={() => disconnect(a.id)}
                title="Stop publishing to this account"
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
