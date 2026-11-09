'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ExternalLink, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PlatformIcon from '../social/PlatformIcon'
import type { InsightsOut, Metric } from '@/app/lib/md-app-insights'

/**
 * THE META CARD'S INSIGHTS TAB (9 Nov 2026). The client's Instagram account and Facebook Page over the last 28 days,
 * each recent Instagram post's numbers, and the Pages this connection manages — read through the client's own MD App
 * connection. What Meta's App Review watches for instagram_basic, instagram_manage_insights, pages_show_list,
 * pages_read_engagement and read_insights.
 */

const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-AU'))
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

function Tiles({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return <p className="text-[13px] text-muted-foreground">No numbers yet for this period.</p>
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map(m => (
        <div key={m.key} className="rounded-tile bg-paper px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">{m.label}</p>
          <p className="text-[20px] font-semibold tracking-tight">{n(m.value)}</p>
        </div>
      ))}
    </div>
  )
}

function AccountHead({ platform, name, picture, facts }: { platform: 'instagram' | 'facebook'; name: string; picture: string | null; facts: string[] }) {
  return (
    <div className="flex items-center gap-3">
      {picture
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={picture} alt="" className="h-11 w-11 rounded-full object-cover" />
        : <PlatformIcon platform={platform} size={44} />}
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold"><PlatformIcon platform={platform} size={14} /> {name}</p>
        <p className="text-[12px] text-muted-foreground">{facts.join(' · ')}</p>
      </div>
    </div>
  )
}

export default function MdAppInsights({ clientId }: { clientId: string }) {
  const [data, setData] = useState<InsightsOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/meta/md-app/insights?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json().catch(() => ({}))
      if (res.ok) { setData(json as InsightsOut); setError(null) } else setError((json as { error?: string }).error ?? 'Could not read the numbers')
    } catch { setError('Could not reach the server') } finally { setLoading(false) }
  }, [clientId])
  useEffect(() => { void load() }, [load])

  if (!data) return <p className="text-sm text-muted-foreground">{error ?? 'Reading the numbers from Meta…'}</p>
  const { instagram: ig, facebook: fb } = data

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">Last 28 days · {day(data.range.since)} – {day(data.range.until)}</p>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /> {loading ? 'Reading…' : 'Refresh'}</Button>
      </div>
      {error && <p className="rounded-inner bg-tint-red px-3 py-2 text-sm">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {ig && (
          <section className="space-y-3 rounded-inner border border-border bg-surface p-4">
            <AccountHead platform="instagram" name={ig.username ? `@${ig.username}` : 'Instagram'} picture={ig.picture}
              facts={[`${n(ig.followers)} followers`, `${n(ig.posts)} posts`]} />
            <Tiles metrics={ig.metrics} />
            {ig.error && <p className="text-[12px] text-muted-foreground">Some numbers could not be read: {ig.error}</p>}
          </section>
        )}
        {fb && (
          <section className="space-y-3 rounded-inner border border-border bg-surface p-4">
            <AccountHead platform="facebook" name={fb.name ?? 'Facebook Page'} picture={fb.picture} facts={[`${n(fb.followers)} followers`]} />
            <Tiles metrics={fb.metrics.filter(m => m.key !== 'page_follows')} />
            {fb.error && <p className="text-[12px] text-muted-foreground">Some numbers could not be read: {fb.error}</p>}
          </section>
        )}
      </div>

      {ig && ig.recent.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[14px] font-semibold">Recent Instagram posts</h4>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ig.recent.map(p => (
              <div key={p.id} className="flex gap-3 rounded-inner border border-border bg-surface p-3">
                {p.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.thumb} alt="" className="h-20 w-20 shrink-0 rounded-tile object-cover" />
                  : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-tile bg-paper"><PlatformIcon platform="instagram" size={20} /></span>}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12px] leading-snug">{p.caption || <span className="text-muted-foreground">No caption</span>}</p>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                    {p.metrics.slice(0, 6).map(m => (
                      <div key={m.key} className="flex justify-between gap-2"><dt className="text-muted-foreground">{m.label}</dt><dd className="font-semibold">{n(m.value)}</dd></div>
                    ))}
                  </dl>
                  {p.link && <a href={p.link} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline"><ExternalLink className="h-3 w-3" /> Open</a>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h4 className="text-[14px] font-semibold">Facebook Pages on this connection</h4>
        {data.pages.length === 0 ? <p className="text-sm text-muted-foreground">No Pages were shared with this connection.</p> : (
          <ul className="divide-y divide-border overflow-hidden rounded-inner border border-border bg-surface">
            {data.pages.map(p => (
              <li key={p.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                {p.picture
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.picture} alt="" className="h-9 w-9 rounded-full object-cover" />
                  : <PlatformIcon platform="facebook" size={36} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{p.name}</span>
                  <span className="text-[12px] text-muted-foreground">{n(p.followers)} followers</span>
                </span>
                {p.picked && <span className="inline-flex items-center gap-1 rounded-full bg-tint-green px-2.5 py-1 text-[11px] font-semibold"><Check className="h-3 w-3" /> This client</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
