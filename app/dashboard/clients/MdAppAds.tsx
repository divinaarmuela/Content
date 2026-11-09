'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * ADS (9 Nov 2026) — inside the Meta card. Connect ads (Facebook Login, the ads configuration) → pick the ad account →
 * the month's Impressions, Reach, Clicks, Spend and Conversions per campaign (READ ONLY) → "Create test campaign"
 * makes ONE campaign, PAUSED with no budget, that can never run or spend; Delete removes only that one.
 * Meta's App Review wants exactly this on screen for ads_read / ads_management. The token never reaches this page.
 */

type Account = { id: string; name: string; currency: string | null }
type Status = { ready: boolean; latestMonth?: string | null; connection: { fb_user_name: string | null; connected_at: string; ad_account_id: string | null; granted: string[] | null } | null; accounts: Account[]; error: string | null }
type Row = { campaignId: string; name: string; impressions: number; reach: number; clicks: number; spend: number; conversions: number }
type Campaign = { id: string; name: string; status: string; objective: string | null }
type Results = { rows: Row[]; totals: Omit<Row, 'campaignId' | 'name'>; campaigns: Campaign[]; testIds: string[] }

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) }
const months = () => Array.from({ length: 18 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7) })
const monthWords = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
const n = (v: number) => v.toLocaleString('en-AU')

export default function MdAppAds({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<Status | { loadError: string } | null>(null)
  const [month, setMonth] = useState(lastMonth)
  const [results, setResults] = useState<Results | { error: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/meta/md-app/ads?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json().catch(() => ({}))
      setStatus(res.ok ? json as Status : { loadError: (json as { error?: string }).error ?? 'Could not load ads' })
    } catch { setStatus({ loadError: 'Could not reach the server' }) }
  }, [clientId])

  const account = status && !('loadError' in status) ? status.connection?.ad_account_id ?? null : null

  const loadResults = useCallback(async () => {
    if (!account) { setResults(null); return }
    setResults(null)
    try {
      const res = await fetch(`/api/meta/md-app/ads?clientId=${encodeURIComponent(clientId)}&month=${month}`)
      const json = await res.json().catch(() => ({}))
      setResults(res.ok ? json as Results : { error: (json as { error?: string }).error ?? 'Could not read the results' })
    } catch { setResults({ error: 'Could not reach the server' }) }
  }, [clientId, month, account])

  useEffect(() => { void loadStatus() }, [loadStatus])
  // open on the latest month that had spend (9 Nov 2026), once — a month the person picks is kept
  const [monthTouched, setMonthTouched] = useState(false)
  useEffect(() => {
    if (!monthTouched && status && !('loadError' in status) && status.latestMonth) setMonth(status.latestMonth)
  }, [status, monthTouched])
  useEffect(() => { void loadResults() }, [loadResults])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const r = params.get('md_ads')
    if (!r) return
    if (r === 'connected') toast.success('Ads connected — pick the ad account')
    else if (r === 'missing') toast.error(`Connected, but Facebook did not give: ${params.get('reason')}. Press Connect again and allow everything.`)
    else toast.error(`Ads connect failed: ${params.get('reason') ?? 'unknown reason'}`)
    for (const k of ['md_ads', 'reason']) params.delete(k)
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [])

  const post = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key)
    try {
      const res = await fetch('/api/meta/md-app/ads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, ...body }) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) toast.success(ok); else toast.error(json.error ?? 'That did not work')
    } finally { setBusy(null); await loadStatus(); await loadResults() }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <h3 className="text-sm font-medium">Ads</h3>
        <p className="text-xs text-muted-foreground">The ad account&apos;s results by month. The test campaign is created paused with no budget, so it never runs or spends.</p>
      </div>

      {!status ? <p className="text-sm text-muted-foreground">Loading…</p>
        : 'loadError' in status ? <p className="text-sm text-destructive">{status.loadError}</p>
        : (
          <>
            {/* ONE LOGIN (9 Nov 2026): the card's Connect button carries Ads too — no second button here */}
            {!status.connection && <p className="text-xs text-muted-foreground">Press Connect above and include the ad account.</p>}
            {!status.ready && <p className="text-xs text-amber-700">The ads login is not set up yet.</p>}
            {status.error && <p className="text-xs text-destructive">{status.error}</p>}

            {status.connection && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Ad account
                  <select className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground" value={account ?? ''} disabled={!!busy}
                    onChange={e => e.target.value && void post('account', { action: 'account', accountId: e.target.value }, 'Ad account picked')}>
                    <option value="">Pick an ad account…</option>
                    {status.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.currency ? ` (${a.currency})` : ''}</option>)}
                  </select>
                </label>
                {account && (
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">Month
                    <select className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground" value={month} onChange={e => { setMonthTouched(true); setMonth(e.target.value) }}>
                      {months().map(m => <option key={m} value={m}>{monthWords(m)}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}

            {account && (!results ? <p className="text-sm text-muted-foreground">Reading results…</p>
              : 'error' in results ? <p className="text-sm text-destructive">{results.error}</p>
              : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {([['Impressions', n(results.totals.impressions)], ['Reach', n(results.totals.reach)], ['Clicks', n(results.totals.clicks)], ['Spend', `$${results.totals.spend.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`], ['Conversions', n(results.totals.conversions)]] as const).map(([label, value]) => (
                      <div key={label} className="rounded-md bg-muted/50 p-2">
                        <p className="text-[11px] text-muted-foreground">{label}</p>
                        <p className="text-base font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                  {results.rows.length === 0
                    ? <p className="text-xs text-muted-foreground">No ads ran in {monthWords(month)}.</p>
                    : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">Campaign</th><th className="pr-2 text-right">Impressions</th><th className="pr-2 text-right">Reach</th><th className="pr-2 text-right">Clicks</th><th className="pr-2 text-right">Spend</th><th className="text-right">Conversions</th></tr></thead>
                          <tbody>{results.rows.map(r => (
                            <tr key={r.campaignId} className="border-t border-border"><td className="py-1 pr-2">{r.name}</td><td className="pr-2 text-right">{n(r.impressions)}</td><td className="pr-2 text-right">{n(r.reach)}</td><td className="pr-2 text-right">{n(r.clicks)}</td><td className="pr-2 text-right">${r.spend.toFixed(2)}</td><td className="text-right">{n(r.conversions)}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}

                  <div className="space-y-2 border-t border-border pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void post('create', { action: 'create' }, 'Test campaign created (paused)')}>
                        {busy === 'create' ? 'Creating…' : 'Create test campaign (paused)'}
                      </Button>
                      <span className="text-xs text-muted-foreground">Paused, no budget, no ads — it cannot run or spend.</span>
                    </div>
                    {results.campaigns.filter(c => results.testIds.includes(c.id)).map(c => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                        <span>{c.name} · <span className="font-medium">{c.status}</span></span>
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void post(`del:${c.id}`, { action: 'delete', campaignId: c.id }, 'Test campaign deleted')}>
                          {busy === `del:${c.id}` ? 'Deleting…' : 'Delete'}
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              ))}
          </>
        )}
    </div>
  )
}
