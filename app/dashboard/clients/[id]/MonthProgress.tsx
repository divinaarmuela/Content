'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type Row = { type: string; label: string; quota: number; planned: number; delivered: number }
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
              const pct = Math.min(100, Math.round((r.delivered / Math.max(1, r.quota)) * 100))
              return (
                <div key={r.type} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{r.label}</span>
                    <span className={`font-mono tabular-nums ${over ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                      {r.delivered} / {r.quota}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                    <div className={`h-1.5 rounded transition-[width] ${over ? 'bg-amber-500' : 'bg-zinc-900 dark:bg-zinc-100'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  {r.planned > r.delivered && (
                    <span className="font-mono text-[10.5px] text-zinc-400">
                      {r.planned - r.delivered} more in production
                    </span>
                  )}
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
