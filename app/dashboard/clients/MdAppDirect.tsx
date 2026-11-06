'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useRole } from '../useRole'

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
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meta/md-app?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json().catch(() => ({}))
      setState(res.ok ? json as State : { error: (json as { error?: string }).error ?? 'Could not load' })
    } catch { setState({ error: 'Could not reach the server' }) }
  }, [clientId])

  useEffect(() => { if (superAdmin) void load() }, [superAdmin, load])

  useEffect(() => {
    if (!superAdmin) return
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
  }, [superAdmin])

  if (!superAdmin) return null

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
              {state.connection && (
                <>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act('refresh', { action: 'refresh' }, 'Accounts read again')}>Check accounts again</Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { if (confirm('Disconnect Meta from this client?')) void act('disconnect', { action: 'disconnect' }, 'Disconnected') }}>Disconnect</Button>
                </>
              )}
            </div>

            {state.connection && (
              <>
                <p className="text-xs text-muted-foreground">
                  Connected {new Date(state.connection.connected_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {state.connection.business_id ? ` · business ${state.connection.business_id}` : ''}
                </p>
                {state.connection.last_error && (() => {
                  // Plain words for the card (6 Nov 2026). Ads answer "(#200) Missing Permissions" on a client connection until
                  // Meta approves ads_read / ads_management in App Review; the granted list is detail, shown small.
                  const parts = state.connection.last_error.split(' · ')
                  const granted = parts.find(x => x.startsWith('Meta granted:'))
                  const lines = parts.filter(x => !x.startsWith('Meta granted:'))
                    .map(x => /^Ad accounts:.*\(#200\)/.test(x) ? 'Ads: waiting for Meta’s approval (App Review).' : x)
                  return (
                    <>
                      {lines.length > 0 && <p className="text-xs text-amber-700">{lines.join(' ')}</p>}
                      {granted && <p className="text-[11px] text-muted-foreground">{granted.replace('Meta granted:', 'Permissions Meta gave this connection:')}</p>}
                    </>
                  )
                })()}

                <div>
                  <h3 className="text-sm font-medium mb-1">Accounts shared with us — tick the ones that belong to this client</h3>
                  {state.assets.length === 0 ? <p className="text-sm text-muted-foreground">None shared yet.</p> : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {state.assets.map(a => (
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
                </div>

                <label className="flex items-center gap-3 text-sm">
                  <Switch checked={state.usesMdApp} disabled={!!busy} onCheckedChange={on => act('use', { action: 'use', on }, on ? 'Posts, replies and reports for this client now go through Meta' : 'Switched off for this client')} />
                  <span>Post, reply and report through Meta for this client</span>
                </label>

                <div>
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
              </>
            )}
          </>
        )}
    </section>
  )
}
