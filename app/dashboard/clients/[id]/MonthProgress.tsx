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
  { key: 'in_production', label: 'in production', dot: 'bg-foreground/[0.14]', bar: 'bg-foreground/[0.12]' },
  { key: 'approved', label: 'approved', dot: 'bg-accent-green', bar: 'bg-tint-green' },
  { key: 'scheduled', label: 'scheduled', dot: 'bg-accent-blue', bar: 'bg-accent-blue' },
  { key: 'posted', label: 'posted', dot: 'bg-accent-green', bar: 'bg-accent-green' },
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
          <h3 className="text-body-15 font-semibold">This month</h3>
          <span className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">{monthName}</span>
        </div>

        {!hasAgreement || rows.length === 0 ? (
          <p className="text-body-15 text-muted-foreground">
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
                  <div className="flex items-baseline justify-between text-body-15">
                    <span>{r.label}</span>
                    <span className={`font-mono tabular-nums ${over ? 'text-accent-amber' : ''}`}>
                      {r.delivered} / {r.quota} <span className="text-muted-foreground">posted</span>
                    </span>
                  </div>
                  <div className="flex h-1.5 w-full gap-px overflow-hidden rounded bg-foreground/[0.06]">
                    {segments.map(s => {
                      const n = r[s.key] ?? 0
                      return n > 0 ? <div key={s.key} className={`h-1.5 ${over && s.key === 'posted' ? 'bg-accent-amber' : s.bar}`} style={{ width: width(n) }} /> : null
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {STAGES.map(s => (
                      <span key={s.key} className="flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                        {s.label} <span className="text-foreground">{r[s.key] ?? 0}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {services.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            {services.map(s => (
              <Badge key={s.key} variant="outline" className="font-normal text-muted-foreground">
                {s.label}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
