'use client'

import { useEffect, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { Platform } from '@/app/lib/publish-core'
import { networkState, returnErrorWords, type ConnectedAccount as Connected } from '@/app/lib/connect-link-core'
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
 *
 * The worst cases, each with a row that says what to do (the owner, 9 Sep
 * 2026: "think of worst case scenarios"):
 *   · the network sent them back with an error (they pressed Cancel) —
 *     said plainly, nothing changed, Connect again;
 *   · the connection has EXPIRED — a red Reconnect, same press;
 *   · it RUNS OUT SOON (TikTok and LinkedIn end a connection after a year)
 *     — an amber Reconnect, before a post is refused;
 *   · the WRONG account got connected — "Connect a different account"
 *     runs the sign-in again, and the network's own picker takes over.
 */
export default function ConnectNetworks({ token, networks, networksParam, initial, justConnected, returnError }: {
  token: string
  networks: Platform[]
  /** the link's own `networks=` value, sent back so the server checks the
   *  press against the manager's ticks, not the button's */
  networksParam: string
  initial: Connected[]
  justConnected: string | null
  /** the network's `?error=` on the way back, if it refused or was cancelled */
  returnError: string | null
}) {
  const [connected, setConnected] = useState<Connected[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [settling, setSettling] = useState(Boolean(justConnected) && !returnError)
  const [problem, setProblem] = useState<string | null>(() =>
    justConnected && returnError ? returnErrorWords(returnError, brandFor(justConnected).label) : null)

  useEffect(() => {
    if (!justConnected) return
    // tidy the address either way, so a refresh does not re-run the wait or
    // re-show a cancelled sign-in
    const tidy = () => {
      const url = new URL(window.location.href)
      for (const k of ['connected', 'clientId', 'error']) url.searchParams.delete(k)
      window.history.replaceState({}, '', url.toString())
    }
    if (returnError) { tidy(); return }
    let cancelled = false
    ;(async () => {
      let found = connected.some(a => a.platform === justConnected && !a.reconnect)
      for (let attempt = 0; attempt < 5 && !cancelled && !found; attempt++) {
        try {
          const res = await fetch(`/api/connect/${encodeURIComponent(token)}`, { method: 'PUT' })
          const json = await res.json().catch(() => ({}))
          if (Array.isArray(json?.connected)) {
            setConnected(json.connected)
            found = (json.connected as Connected[]).some(a => a.platform === justConnected && !a.reconnect)
          }
        } catch { /* try again */ }
        if (!found) await new Promise(r => setTimeout(r, 1500))
      }
      if (cancelled) return
      setSettling(false)
      tidy()
      const label = brandFor(justConnected).label
      if (found) toast.success(`${label} connected. Thank you!`)
      else toast.message(`${label} is not showing yet — give it a moment, then refresh this page.`)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connect = async (platform: Platform) => {
    setBusy(platform)
    setProblem(null)
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

  const spinner = <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> One moment…</>

  return (
    <div className="flex flex-col gap-3">
      {problem && (
        <p role="alert" className="rounded-inner border border-accent-amber/50 bg-tint-amber px-4 py-3 text-[14px]">
          {problem}
        </p>
      )}
      <ul className="flex flex-col gap-3" aria-label="Networks to connect">
        {networks.map(platform => {
          const brand = brandFor(platform)
          const state = networkState(connected, platform)
          const waiting = settling && justConnected === platform && (!state.connected || state.reconnect)
          const pressing = busy === platform || waiting
          const line = !state.connected
            ? (waiting ? 'Finishing up…' : 'Not connected yet')
            : state.reconnect
              ? `${state.who} — the connection has run out. Please sign in again.`
              : state.soon
                ? `${state.who} — ${state.reason ?? 'the connection runs out soon'}`
                : `Connected — ${state.who}`
          return (
            <li key={platform} className="flex flex-col gap-2 rounded-inner border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <PlatformIcon platform={platform} size={40} className="shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold">{brand.label}</p>
                  <p className={`text-[13px] ${state.connected && state.reconnect ? 'text-accent-red' : 'text-muted-foreground'}`}>{line}</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
                {!state.connected ? (
                  <button type="button" disabled={busy !== null || waiting} onClick={() => connect(platform)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-60">
                    {pressing ? spinner : `Connect ${brand.label}`}
                  </button>
                ) : state.reconnect ? (
                  <button type="button" disabled={busy !== null || waiting} onClick={() => connect(platform)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent-red px-5 text-[14px] font-semibold text-white disabled:opacity-60">
                    {pressing ? spinner : <><RefreshCw className="h-4 w-4" aria-hidden /> Reconnect {brand.label}</>}
                  </button>
                ) : state.soon ? (
                  <button type="button" disabled={busy !== null} onClick={() => connect(platform)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent-amber px-5 text-[14px] font-semibold text-ink disabled:opacity-60">
                    {pressing ? spinner : <><RefreshCw className="h-4 w-4" aria-hidden /> Reconnect now</>}
                  </button>
                ) : (
                  <span className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-tint-green px-4 text-[14px] font-semibold">
                    <Check className="h-4 w-4" aria-hidden /> Connected
                  </span>
                )}
                {state.connected && !state.reconnect && (
                  <button type="button" disabled={busy !== null} onClick={() => connect(platform)}
                    className="text-[12px] text-muted-foreground underline-offset-4 hover:underline sm:text-right">
                    Not the right account? Connect a different one
                  </button>
                )}
              </div>
            </li>
          )
        })}
        {networks.length === 0 && (
          <li className="text-[14px] text-muted-foreground">There is nothing to connect on this link.</li>
        )}
      </ul>
    </div>
  )
}
