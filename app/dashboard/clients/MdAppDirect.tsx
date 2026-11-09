'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useRole } from '../useRole'
import MdAppAds from './MdAppAds'
import MdAppInbox from './MdAppInbox'
import MdAppPublish from './MdAppPublish'
import MdAppInsights from './MdAppInsights'
import MdAppLeads from './MdAppLeads'
import MdAppLive from './MdAppLive'

/**
 * "Direct via MD App (testing)" (6 Nov 2026) — super admins only. MD App is Meta's new app with Unified Login;
 * it is a separate road: nothing changes for a client until the switch below is on, and Zernio stays the
 * default. Connect → the client shares accounts in Facebook → back here, pick which belong to the client →
 * test buttons each make ONE real call so Meta logs it before App Review. The token never reaches this page.
 */

type Asset = { id: string; kind: 'instagram' | 'page' | 'ad_account'; asset_id: string; name: string | null; picked: boolean }
type Test = { id: string; label: string; permissions: string[] }
type State = {
  configured: boolean; reason: string | null; usesMdApp: boolean; assets: Asset[]; tests: Test[]
  connection: { connected_at: string; business_id: string | null; last_error: string | null } | null
} | { error: string }

const KIND_WORDS: Record<Asset['kind'], string> = { instagram: 'Instagram', page: 'Facebook Page', ad_account: 'Ad account' }

export default function MdAppDirect({ clientId }: { clientId: string }) {
  const { can } = useRole()
  const superAdmin = can('super_admin')
  // the card: account managers (on their own client — the API checks) and up; tests, the switch and disconnect: super admin
  const mayConnect = can('account_manager')
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})
  // the card's tabs (9 Nov 2026): each is a real screen Meta's App Review watches
  const [tab, setTab] = useState<'inbox' | 'publish' | 'insights' | 'leads' | 'ads'>('inbox')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meta/md-app?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json().catch(() => ({}))
      setState(res.ok ? json as State : { error: (json as { error?: string }).error ?? 'Could not load' })
    } catch { setState({ error: 'Could not reach the server' }) }
  }, [clientId])

  useEffect(() => { if (mayConnect) void load() }, [mayConnect, load])

  useEffect(() => {
    if (!mayConnect) return
    const params = new URLSearchParams(window.location.search)
    const result = params.get('md_app')
    if (!result) return
    if (result === 'connected') toast.success('Connected — now tick the accounts that belong to this client')
    else if (result === 'empty') toast.error('Connected, but no accounts were shared. Connect again and choose the accounts.')
    else if (result === 'denied') toast.error('Connect was cancelled')
    else toast.error(`Connect failed: ${params.get('reason') ?? 'unknown reason'}`)
    for (const k of ['md_app', 'reason']) params.delete(k)
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [mayConnect])

  if (!mayConnect) return null

  const act = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key)
    try {
      const res = await fetch('/api/meta/md-app', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, ...body }) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) toast.success(ok); else toast.error(json.error ?? 'That did not work')
    } finally { setBusy(null); void load() }
  }

  const runTest = async (t: Test) => {
    setBusy(`test:${t.id}`)
    try {
      const res = await fetch('/api/meta/md-app/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, test: t.id }) })
      const json = await res.json().catch(() => ({})) as { summary?: string; error?: string }
      setResults(r => ({ ...r, [t.id]: res.ok ? { ok: true, text: json.summary ?? 'OK' } : { ok: false, text: json.error ?? 'Failed' } }))
    } finally { setBusy(null) }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Meta: Facebook, Instagram &amp; Ads</h2>
          <p className="text-sm text-muted-foreground">Connect this client&apos;s Facebook Page, Instagram account and ad account.</p>
        </div>
      </div>

      {!state ? <p className="text-sm text-muted-foreground">Loading…</p>
        : 'error' in state ? <p className="text-sm text-destructive">{state.error}</p>
        : (
          <>
            {!state.configured && <p className="text-sm text-destructive">{state.reason}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" disabled={!state.configured}>
                <a href={`/api/meta/md-app/connect?clientId=${encodeURIComponent(clientId)}`}>{state.connection ? 'Connect again' : 'Connect with Facebook / Instagram'}</a>
              </Button>
              {state.connection && superAdmin && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { if (confirm('Disconnect Meta from this client?')) void act('disconnect', { action: 'disconnect' }, 'Disconnected') }}>Disconnect</Button>
              )}
            </div>

            {state.connection && (() => {
              // CLEAN CARD (9 Nov 2026, owner: "too many things here"). What a person — and Meta's reviewer — sees: what is
              // connected, in one line, and Ads. The account ticks only appear while something shared is still unticked;
              // the system-user connection's "(#200) ads" note, the granted list, the business id, the switch and the
              // per-permission checks live under "Connection details" (super admins, closed by default).
              const picked = state.assets.filter(a => a.picked)
              const unpicked = state.assets.filter(a => !a.picked)
              return (
              <>
                <p className="text-sm">
                  Connected{picked.length > 0 ? ' · ' : ''}{picked.map(a => `${KIND_WORDS[a.kind]} ${a.kind === 'instagram' ? '@' : ''}${a.name ?? a.asset_id}`).join(' · ')}
                </p>

                {unpicked.length > 0 && <div>
                  <h3 className="text-sm font-medium mb-1">Tick the accounts that belong to this client</h3>
                  {(
                    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                      {unpicked.map(a => (
                        <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span><span className="text-muted-foreground">{KIND_WORDS[a.kind]}:</span> {a.name ?? a.asset_id}</span>
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={a.picked} disabled={!!busy}
                              onChange={e => act(a.id, { action: e.target.checked ? 'pick' : 'unpick', kind: a.kind, assetId: a.asset_id }, e.target.checked ? 'Ticked' : 'Unticked')} />
                            <span>{a.picked ? 'This client' : 'Not this client'}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>}

                <MdAppLive clientId={clientId} />

                <div className="space-y-3">
                  <div role="tablist" className="flex gap-1 border-b border-border">
                    {([['inbox', 'Inbox'], ['publish', 'Publish'], ['insights', 'Insights'], ['leads', 'Leads'], ['ads', 'Ads']] as const).map(([k, label]) => (
                      <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
                        className={`-mb-px min-h-11 border-b-2 px-4 text-[14px] font-medium transition-colors ${tab === k ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {tab === 'inbox' && <MdAppInbox clientId={clientId} />}
                  {tab === 'publish' && <MdAppPublish clientId={clientId} />}
                  {tab === 'insights' && <MdAppInsights clientId={clientId} />}
                  {tab === 'leads' && <MdAppLeads clientId={clientId} />}
                  {tab === 'ads' && <MdAppAds clientId={clientId} />}
                </div>

                {superAdmin && <details className="rounded-md border border-border p-3 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Connection details</summary>
                  <div className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Connected {new Date(state.connection.connected_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {state.connection.business_id ? ` · business ${state.connection.business_id}` : ''}
                  </p>
                  {state.connection.last_error && <p className="text-xs text-muted-foreground break-words">{state.connection.last_error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act('refresh', { action: 'refresh' }, 'Accounts read again')}>Check accounts again</Button>
                  </div>
                  {picked.length > 0 && <ul className="text-xs text-muted-foreground">
                    {picked.map(a => <li key={a.id}>{KIND_WORDS[a.kind]}: {a.name ?? a.asset_id} · <button className="underline" disabled={!!busy} onClick={() => act(a.id, { action: 'unpick', kind: a.kind, assetId: a.asset_id }, 'Unticked')}>not this client</button></li>)}
                  </ul>}
                  <label className="flex items-center gap-3 text-sm">
                    <Switch checked={state.usesMdApp} disabled={!!busy} onCheckedChange={on => act('use', { action: 'use', on }, on ? 'Posts, replies and reports for this client now go through Meta' : 'Switched off for this client')} />
                    <span>Post, reply and report through Meta for this client</span>
                  </label>
                  <h3 className="text-sm font-medium mb-1">Check each connection (each makes one real call)</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {state.tests.map(t => (
                      <div key={t.id} className="rounded-md border border-border p-2">
                        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => runTest(t)}>{busy === `test:${t.id}` ? 'Working…' : t.label}</Button>
                        <p className="mt-1 text-xs text-muted-foreground">{t.permissions.join(', ')}</p>
                        {results[t.id] && <p className={`mt-1 text-xs ${results[t.id].ok ? 'text-emerald-700' : 'text-destructive'}`}>{results[t.id].text}</p>}
                      </div>
                    ))}
                  </div>
                  </div>
                </details>}
              </>
              )
            })()}
          </>
        )}
    </section>
  )
}
