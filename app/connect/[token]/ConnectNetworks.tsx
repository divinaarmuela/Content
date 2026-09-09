'use client'

import { useEffect, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { Platform } from '@/app/lib/publish-core'
import { networkState, type ConnectedAccount as Connected } from '@/app/lib/connect-link-core'
import PlatformIcon, { brandFor } from '@/app/dashboard/social/PlatformIcon'

/**
 * The networks the manager ticked, each with what it is doing.
 *
 * A press asks our server for that network's sign-in URL (with the token —
 * no account of ours) and hands the whole tab over to the network, because
 * consent screens refuse to be framed and popups get blocked. On the way
 * back (`?connected=…`) the provider is still attaching the account for a
 * moment, so the re-read is retried a few times — the same short retry the
 * team's own pages run — and the row turns into a tick without a reload.
 */
export default function ConnectNetworks({ token, networks, networksParam, initial, justConnected }: {
  token: string
  networks: Platform[]
  /** the link's own `networks=` value, sent back so the server checks the
   *  press against the manager's ticks, not the button's */
  networksParam: string
  initial: Connected[]
  justConnected: string | null
}) {
  const [connected, setConnected] = useState<Connected[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [settling, setSettling] = useState(Boolean(justConnected))

  useEffect(() => {
    if (!justConnected) return
    let cancelled = false
    ;(async () => {
      let found = connected.some(a => a.platform === justConnected)
      for (let attempt = 0; attempt < 5 && !cancelled && !found; attempt++) {
        try {
          const res = await fetch(`/api/connect/${encodeURIComponent(token)}`, { method: 'PUT' })
          const json = await res.json().catch(() => ({}))
          if (Array.isArray(json?.connected)) {
            setConnected(json.connected)
            found = (json.connected as Connected[]).some(a => a.platform === justConnected)
          }
        } catch { /* try again */ }
        if (!found) await new Promise(r => setTimeout(r, 1500))
      }
      if (cancelled) return
      setSettling(false)
      // tidy the address so a refresh does not re-run the wait
      const url = new URL(window.location.href)
      url.searchParams.delete('connected'); url.searchParams.delete('clientId')
      window.history.replaceState({}, '', url.toString())
      const label = brandFor(justConnected).label
      if (found) toast.success(`${label} connected. Thank you!`)
      else toast.message(`${label} is not showing yet — give it a moment, then refresh this page.`)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connect = async (platform: Platform) => {
    setBusy(platform)
    try {
      const res = await fetch(`/api/connect/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, networks: networksParam }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not start the sign-in'))
      window.location.href = String(json.authUrl)
    } catch (e) {
      setBusy(null)
      toast.error(e instanceof Error ? e.message : 'Could not start the sign-in')
    }
  }

  return (
    <ul className="flex flex-col gap-3" aria-label="Networks to connect">
      {networks.map(platform => {
        const brand = brandFor(platform)
        const state = networkState(connected, platform)
        const waiting = settling && justConnected === platform && !state.connected
        return (
          <li key={platform} className="flex items-center gap-4 rounded-inner border border-border bg-surface px-4 py-3">
            <PlatformIcon platform={platform} size={40} className="shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold">{brand.label}</p>
              <p className="truncate text-[13px] text-muted-foreground">
                {state.connected
                  ? state.reconnect
                    ? `${state.who} — the connection has run out, please sign in again`
                    : `Connected — ${state.who}`
                  : waiting ? 'Finishing up…' : 'Not connected yet'}
              </p>
            </div>
            {state.connected && state.reconnect ? (
              /* the same press as a first connect: the network's sign-in,
                 back here after — this link is the reconnect link too */
              <button
                type="button"
                disabled={busy !== null || waiting}
                onClick={() => connect(platform)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-red px-5 text-[14px] font-semibold text-white disabled:opacity-60"
              >
                {busy === platform || waiting
                  ? <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> One moment…</>
                  : <><RefreshCw className="h-4 w-4" aria-hidden /> Reconnect {brand.label}</>}
              </button>
            ) : state.connected ? (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-tint-green px-4 text-[14px] font-semibold">
                <Check className="h-4 w-4" aria-hidden /> Connected
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null || waiting}
                onClick={() => connect(platform)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-60"
              >
                {busy === platform || waiting
                  ? <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> One moment…</>
                  : `Connect ${brand.label}`}
              </button>
            )}
          </li>
        )
      })}
      {networks.length === 0 && (
        <li className="text-[14px] text-muted-foreground">There is nothing to connect on this link.</li>
      )}
    </ul>
  )
}
