'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type Row = {
  type: string; label: string; quota: number; planned: number; delivered: number
  in_production?: number; approved?: number; scheduled?: number; posted?: number
}

/** The stages an item passes through on its way to counting. Same order and
 *  colours as the Overview pipeline, so the two read as one thing. */
const STAGES: { key: 'in_production' | 'approved' | 'scheduled' | 'posted'; label: string; dot: string; bar: string }[] = [
  { key: 'in_production', label: 'in production', dot: 'bg-zinc-400', bar: 'bg-zinc-300 dark:bg-zinc-600' },
  { key: 'approved', label: 'approved', dot: 'bg-emerald-400', bar: 'bg-emerald-300 dark:bg-emerald-800' },
  { key: 'scheduled', label: 'scheduled', dot: 'bg-cyan-500', bar: 'bg-cyan-400 dark:bg-cyan-700' },
  { key: 'posted', label: 'posted', dot: 'bg-emerald-600', bar: 'bg-emerald-600 dark:bg-emerald-400' },
]
type Service = { key: string; label: string; active: boolean }

/**
 * "Are we hitting this client's numbers this month?" — the agreement's
 * quantities against what production has actually delivered, right on the
 * client page where an account manager looks first.
 */
export default function MonthProgress({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [hasAgreement, setHasAgreement] = useState(true)
  const [canManage, setCanManage] = useState(false)

  const load = useCallback(async () => {
    try {
      const [pRes, aRes, meRes] = await Promise.all([
        fetch(`/api/production/deliverables-progress?client_id=${clientId}`),
        fetch(`/api/clients/${clientId}/agreement`),
        fetch('/api/overview'),
      ])
      if (pRes.ok) {
        const p = await pRes.json()
        setRows(p.per_type ?? [])
        setHasAgreement(Boolean(p.has_agreement))
      } else setRows([])
      if (aRes.ok) {
        const a = await aRes.json()
        setServices((a.agreement?.services ?? []).filter((s: Service) => s.active))
      }
      if (meRes.ok) setCanManage(['account_manager', 'super_admin'].includes((await meRes.json())?.role ?? ''))
    } catch { setRows([]) }
  }, [clientId])
  useEffect(() => { void load() }, [load])

  if (rows === null) return null

  const monthName = new Date().toLocaleDateString('en-AU', { month: 'long' })

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">This month</h3>
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">{monthName}</span>
        </div>

        {!hasAgreement || rows.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No agreement on file.{' '}
            {canManage && (
              <Link href={`/dashboard/clients/${clientId}/agreement`} className="underline decoration-dotted">
                Set up agreement →
              </Link>
            )}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map(r => {
              const over = r.delivered > r.quota
              const denom = Math.max(1, r.quota, r.planned)
              const width = (n: number) => `${Math.min(100, Math.round((n / denom) * 100))}%`
              // the bar fills in the order the work moves: posted first (the
              // part that counts), then scheduled, approved, in production
              const segments = [...STAGES].reverse()
              return (
                <div key={r.type} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{r.label}</span>
                    <span className={`font-mono tabular-nums ${over ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                      {r.delivered} / {r.quota} <span className="text-zinc-400">posted</span>
                    </span>
                  </div>
                  <div className="flex h-1.5 w-full gap-px overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                    {segments.map(s => {
                      const n = r[s.key] ?? 0
                      return n > 0 ? <div key={s.key} className={`h-1.5 ${over && s.key === 'posted' ? 'bg-amber-500' : s.bar}`} style={{ width: width(n) }} /> : null
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-zinc-500 dark:text-zinc-400">
                    {STAGES.map(s => (
                      <span key={s.key} className="flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                        {s.label} <span className="text-zinc-800 dark:text-zinc-200">{r[s.key] ?? 0}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {services.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {services.map(s => (
              <Badge key={s.key} variant="outline" className="font-normal text-zinc-500 dark:text-zinc-400">
                {s.label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
