'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useRole } from '../useRole'
import PlatformIcon from '../social/PlatformIcon'

/**
 * THE AGENCY'S OWN INSTAGRAM CONNECTION, FOR TESTING (1 Oct 2026, branch
 * meta-instagram-login). Super admins only, and badged "Direct — testing":
 * posting, comments and DMs still go through the channels above (Zernio).
 * Nothing here posts or replies — it connects an account straight to our
 * Meta app and shows what is connected. The token never reaches this page.
 */

type Row = {
  id: string
  username: string | null
  account_type: string | null
  token_expires_at: string | null
  connected_at: string
  refreshed_at: string | null
  status: string
  last_error: string | null
}
type State = { configured: boolean; reason: string | null; accounts: Row[] } | { error: string }

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function MetaDirectInstagram({ clientId }: { clientId: string }) {
  const { can, loading } = useRole()
  const superAdmin = can('super_admin')
  const [state, setState] = useState<State | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meta/instagram/accounts?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json().catch(() => ({}))
      setState(res.ok ? json as State : { error: (json as { error?: string }).error ?? 'Could not load' })
    } catch { setState({ error: 'Could not reach the server' }) }
  }, [clientId])

  useEffect(() => { if (superAdmin) void load() }, [superAdmin, load])

  // coming back from Instagram: say how it went once, then clear the query
  useEffect(() => {
    if (!superAdmin) return
    const params = new URLSearchParams(window.location.search)
    const result = params.get('meta_ig')
    if (!result) return
    if (result === 'connected') toast.success(`Instagram connected directly${params.get('username') ? ` — @${params.get('username')}` : ''}`)
    else if (result === 'denied') toast.error('Instagram connect was cancelled on Instagram')
    else toast.error(`Instagram connect failed: ${params.get('reason') ?? 'unknown reason'}`)
    for (const k of ['meta_ig', 'username', 'reason']) params.delete(k)
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [superAdmin])

  if (loading || !superAdmin) return null

  const H = 'font-mono text-[12px] uppercase tracking-widest text-muted-foreground'
  const configured = state && 'configured' in state ? state.configured : false
  const accounts = state && 'accounts' in state ? state.accounts : []

  return (
    <div className="flex flex-col gap-2 rounded-inner border border-dashed border-border p-3" data-meta-ig="direct">
      <div className="flex flex-wrap items-center gap-2">
        <p className={H}>Instagram — our own Meta app</p>
        <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold">Direct — testing</span>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Connects an Instagram professional account straight to MD Media’s Meta app, for testing. Posting, comments and DMs still go through the channels above.
      </p>
      {state && 'error' in state && <p className="text-[12px] text-accent-red-deep">{state.error}</p>}
      {state && 'reason' in state && state.reason && <p className="text-[12px] text-muted-foreground">{state.reason}</p>}

      {accounts.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Directly connected Instagram accounts">
          {accounts.map(a => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-inner border border-border px-3 py-2 text-[13px]">
              <PlatformIcon platform="instagram" size={16} />
              <span className="font-semibold">@{a.username ?? a.id}</span>
              <span className="text-muted-foreground">connected {day(a.connected_at)}</span>
              <span className="text-muted-foreground">· token until {day(a.token_expires_at)}</span>
              {a.status !== 'active' && <span className="rounded-full bg-tint-red px-2 py-0.5 text-[11px] font-semibold">{a.status} — reconnect</span>}
              {a.last_error && <span className="w-full text-[12px] text-muted-foreground">{a.last_error}</span>}
            </li>
          ))}
        </ul>
      )}

      <div>
        {configured ? (
          <Button asChild variant="outline" className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <a href={`/api/meta/instagram/connect?clientId=${encodeURIComponent(clientId)}`}>
              <PlatformIcon platform="instagram" size={16} className="mr-1.5" /> Connect Instagram directly (Meta)
            </a>
          </Button>
        ) : (
          <Button variant="outline" disabled className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <PlatformIcon platform="instagram" size={16} className="mr-1.5" /> Connect Instagram directly (Meta)
          </Button>
        )}
      </div>
    </div>
  )
}
