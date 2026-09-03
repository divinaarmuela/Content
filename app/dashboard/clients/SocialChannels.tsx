'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import Link from 'next/link'
import { AlertTriangle, Check, ChevronRight, Loader2, Plus, RefreshCw, Unlink } from 'lucide-react'
import PlatformIcon, { brandFor } from '../social/PlatformIcon'

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

export default function SocialChannels(
  { clientId, onChanged }: { clientId: string; onChanged?: () => void }
) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Account | null>(null)
  /** true while we are waiting for the provider to finish attaching an account */
  const [linking, setLinking] = useState(false)
  /** has this client ever had a provider profile created for it? */
  const hasProfileRef = useRef(false)

  const load = useCallback(async (): Promise<number> => {
    try {
      const res = await fetch(`/api/social/accounts?clientId=${clientId}`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load channels')
      const json = await res.json()
      const live = (json.accounts ?? []).filter((a: Account) => a.active)
      setAccounts(live)
      setConfigured(json.provider?.configured ?? false)
      hasProfileRef.current = Boolean(json.hasProfile)
      return live.length
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load channels')
      return 0
    } finally {
      setLoading(false)
    }
  }, [clientId])

  /**
   * Reconcile with the provider whenever we hold no channels for this client.
   *
   * The OAuth return is not a reliable signal — a hung dev server, a provider
   * TLS blip or a closed tab all lose it, and the account then exists at the
   * provider while our table stays empty until somebody happens to press
   * refresh. Checking upstream when we believe there is nothing costs one call
   * and makes that drift self-correcting.
   */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const count = await load()
      // a client that never connected has nothing upstream to reconcile with
      if (cancelled || count > 0 || !hasProfileRef.current) return
      const found = await sync({ quiet: true })
      if (found > 0 && !cancelled) setLinking(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  /**
   * Returning from an OAuth round trip.
   *
   * The provider finishes attaching the account a moment after it redirects
   * us, so an immediate sync can legitimately come back empty. Retrying a few
   * times with a short gap turns "connected but shows nothing until you
   * refresh" into it simply appearing.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // every client's panel is mounted on the channels page, so only the one
    // that was actually being connected should re-sync
    if (!params.get('connected') || params.get('clientId') !== clientId) return

    let cancelled = false
    const clearQuery = () => {
      params.delete('connected')
      params.delete('clientId')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }

    ;(async () => {
      setLinking(true)
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        const count = await sync({ quiet: true })
        if (count > 0) break
        await new Promise(r => setTimeout(r, 1500))
      }
      if (cancelled) return
      setLinking(false)
      clearQuery()
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Pull the provider's account list into ours. Returns how many it found,
   *  so the post-OAuth retry can tell "not yet" from "nothing there". */
  const sync = async ({ quiet = false }: { quiet?: boolean } = {}): Promise<number> => {
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
      onChanged?.()
      const count = Number(json.synced ?? 0)
      if (!quiet) {
        toast.success(count > 0
          ? `${count} account${count === 1 ? '' : 's'} linked`
          : 'No accounts found yet')
      } else if (count > 0) {
        toast.success(`${count} channel${count === 1 ? '' : 's'} connected`)
      }
      return count
    } catch (e) {
      if (!quiet) toast.error(e instanceof Error ? e.message : 'Could not refresh')
      return 0
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
      onChanged?.()
      toast.success('Channel disconnected — reconnect to publish to it again')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disconnect')
    }
  }

  if (!configured && !loading) {
    return (
      <div className="flex items-start gap-2 rounded-inner border border-accent-amber/35 bg-tint-amber px-3 py-2 text-secondary-13 text-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Posting isn&apos;t switched on yet — nobody can schedule or publish from here until someone on our side turns it on.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-body-15 font-medium">Channels</span>
        <span className="text-secondary-13 text-muted-foreground">
          {accounts.length} connected
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => sync()} disabled={busy === 'sync'}>
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
            <DropdownMenuContent align="end" className="w-48">
              {OFFERED.map(p => {
                const already = accounts.some(a => a.platform === p)
                return (
                  <DropdownMenuItem
                    key={p}
                    onClick={() => connect(p)}
                    disabled={busy === p}
                    className="gap-2"
                  >
                    <PlatformIcon platform={p} size={18} />
                    <span className="flex-1">{brandFor(p).label}</span>
                    {busy === p
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : already && <Check className="h-3.5 w-3.5 text-accent-green" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading ? (
        <div className="flex gap-2">
          {[0, 1].map(i => <Skeleton key={i} className="h-14 flex-1" />)}
        </div>
      ) : linking && accounts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-inner border border-border px-3 py-3 text-secondary-13 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Finishing the connection — the platform can take a few seconds to hand
          the account over.
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex items-center gap-3 rounded-inner border border-dashed border-border px-3 py-3">
          {/* the platforms on offer, greyed out — shows what is possible here */}
          <div className="flex gap-1">
            {OFFERED.slice(0, 5).map(p => (
              <PlatformIcon key={p} platform={p} size={18} className="opacity-25 grayscale" />
            ))}
          </div>
          <p className="text-secondary-13 text-muted-foreground">
            No channels yet. “Connect” opens the platform’s own login — the client’s
            password is never entered here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {accounts.map(a => {
            const brand = brandFor(a.platform)
            return (
              <li
                key={a.id}
                className="group flex items-center gap-3 rounded-inner border border-border bg-surface px-3 py-2.5 transition-colors hover:border-foreground/25"
              >
                <Link
                  href={`/dashboard/social/${a.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <PlatformIcon platform={a.platform} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-body-15 font-medium">{brand.label}</span>
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-green"
                        title="Connected"
                      />
                    </div>
                    <span className="block truncate font-mono text-secondary-13 text-muted-foreground">
                      {a.username ? `@${a.username}` : a.name ?? '—'}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                </Link>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setConfirm(a)}
                  title="Disconnect this account"
                  className="opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Unlink className="h-3.5 w-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Disconnecting revokes access at the platform — reconnecting means
          another OAuth round trip, so it warrants a confirmation. */}
      <AlertDialog open={!!confirm} onOpenChange={o => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {confirm ? brandFor(confirm.platform).label : ''}
              {confirm?.username ? ` @${confirm.username}` : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This revokes access at the platform, not just here. Scheduled posts
              targeting this account will fail until it is reconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirm) disconnect(confirm.id); setConfirm(null) }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
