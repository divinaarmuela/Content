'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText, Plus } from 'lucide-react'
import {
  CONTENT_TYPES, TYPE_LABELS, type ContentType, type DeliverableLine, type RetainedService,
} from '../../../../lib/agreement-core'

type Agreement = {
  deliverable_lines: DeliverableLine[]
  services: RetainedService[]
  notes: string | null
  start_date?: string | null
  updated_at?: string
}

/**
 * The standing deal, recorded where the team works: how many of what per
 * month, and which services the retainer includes. Everything downstream —
 * shoot-brief captions, board progress, the client overview — reads this.
 */
export default function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [agreement, setAgreement] = useState<Agreement | null | undefined>(undefined)
  const [catalog, setCatalog] = useState<{ key: string; label: string }[]>([])
  const [canManage, setCanManage] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}/agreement`)
    if (!res.ok) {
      const err = (await res.json()).error ?? ''
      if (/relation|does not exist/i.test(String(err))) {
        toast.error('Run supabase/agreements_and_briefs.sql first')
      }
      setAgreement(null)
      return
    }
    const json = await res.json()
    setAgreement(json.agreement)
    setCatalog(json.catalog ?? [])
    // AM+ can write — probe cheaply via the overview role
    const me = await fetch('/api/overview').then(r => (r.ok ? r.json() : null)).catch(() => null)
    setCanManage(['account_manager', 'super_admin'].includes(me?.role ?? ''))
  }, [id])
  useEffect(() => { void load() }, [load])

  const save = async (next: Partial<Agreement>) => {
    setBusy(true)
    try {
      const body = {
        deliverable_lines: next.deliverable_lines ?? agreement?.deliverable_lines ?? [],
        services: next.services ?? agreement?.services ?? [],
        notes: next.notes !== undefined ? next.notes : agreement?.notes ?? '',
        start_date: next.start_date !== undefined ? next.start_date : agreement?.start_date ?? null,
      }
      const res = await fetch(`/api/clients/${id}/agreement`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save the agreement')
      setAgreement(json.agreement)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the agreement')
      void load()
    } finally {
      setBusy(false)
    }
  }

  if (agreement === undefined) {
    return <div className="flex flex-col gap-3">{[0, 1].map(i => <Skeleton key={i} className="h-40" />)}</div>
  }

  if (agreement === null) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <FileText className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
          </div>
          <p className="text-sm font-medium">No agreement on file</p>
          {canManage ? (
            <>
              <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                Record the client&rsquo;s monthly deliverables and retained services
                so the team can plan against them.
              </p>
              <Button size="sm" disabled={busy}
                onClick={() => void save({ deliverable_lines: [], services: [], notes: '' })}>
                Set up agreement
              </Button>
            </>
          ) : (
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              An account manager hasn&rsquo;t recorded this client&rsquo;s agreement yet.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  const lineFor = (type: ContentType) => agreement.deliverable_lines.find(l => l.type === type)
  const setQty = (type: ContentType, qty: number) => {
    const others = agreement.deliverable_lines.filter(l => l.type !== type)
    const lines = qty > 0
      ? [...others, { type, label: TYPE_LABELS[type], monthly_qty: qty }]
      : others
    void save({ deliverable_lines: lines })
  }
  const serviceFor = (key: string) => agreement.services.find(s => s.key === key)
  const setService = (key: string, label: string, patch: Partial<RetainedService>) => {
    const existing = serviceFor(key)
    const others = agreement.services.filter(s => s.key !== key)
    const next = { key, label, note: existing?.note ?? '', active: existing?.active ?? false, ...patch }
    void save({ services: next.active || next.note ? [...others, next] : others })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Monthly deliverables</h3>
              <p className="mt-0.5 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                Default quantities per month. Individual months can be adjusted from the production board.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              Agreement start
              {canManage ? (
                <Input type="date" key={agreement.start_date ?? ''} defaultValue={agreement.start_date ?? ''}
                  disabled={busy} className="h-8 w-36 font-mono text-xs"
                  onBlur={e => { if (e.target.value !== (agreement.start_date ?? '')) void save({ start_date: e.target.value || null }) }} />
              ) : (
                <span className="font-mono">{agreement.start_date ?? '—'}</span>
              )}
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {CONTENT_TYPES.map(type => {
              const line = lineFor(type)
              return (
                <div key={type} className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <span className="flex-1 text-sm">{TYPE_LABELS[type]}</span>
                  {canManage ? (
                    <Input type="number" min={0} key={`${type}:${line?.monthly_qty ?? 0}`}
                      defaultValue={line?.monthly_qty ?? 0} disabled={busy}
                      className="h-8 w-20 text-center font-mono text-sm tabular-nums"
                      onBlur={e => {
                        const qty = Math.max(0, Number(e.target.value) || 0)
                        if (qty !== (line?.monthly_qty ?? 0)) setQty(type, qty)
                      }} />
                  ) : (
                    <span className="font-mono text-sm tabular-nums">{line?.monthly_qty ?? 0}</span>
                  )}
                  <span className="w-14 text-right text-[11px] text-zinc-400">/ month</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold">Retained services</h3>
          <div className="flex flex-col gap-1.5">
            {catalog.map(c => {
              const svc = serviceFor(c.key)
              return (
                <label key={c.key}
                  className={`flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800 ${canManage ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900' : ''}`}>
                  <input type="checkbox" checked={svc?.active ?? false} disabled={!canManage || busy}
                    onChange={e => setService(c.key, c.label, { active: e.target.checked })}
                    className="h-4 w-4 shrink-0 accent-blue-600" />
                  <span className="flex-1">{c.label}</span>
                  {canManage && (svc?.active || svc?.note) && (
                    <Input key={`${c.key}:${svc?.note ?? ''}`} defaultValue={svc?.note ?? ''} placeholder="note"
                      className="h-7 w-44 text-xs"
                      onBlur={e => { if (e.target.value !== (svc?.note ?? '')) setService(c.key, c.label, { note: e.target.value }) }} />
                  )}
                </label>
              )
            })}
            {agreement.services.filter(s => s.key.startsWith('custom:')).map(s => (
              <label key={s.key} className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                <input type="checkbox" checked={s.active} disabled={!canManage || busy}
                  onChange={e => setService(s.key, s.label, { active: e.target.checked })}
                  className="h-4 w-4 shrink-0 accent-blue-600" />
                <span className="flex-1">{s.label}</span>
                <Badge variant="outline" className="font-normal text-zinc-400">custom</Badge>
              </label>
            ))}
            {canManage && (
              <Button size="sm" variant="ghost" className="w-fit text-zinc-500" disabled={busy}
                onClick={() => {
                  const label = window.prompt('Name the service')?.trim()
                  if (!label) return
                  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
                  setService(`custom:${slug}`, label, { active: true })
                }}>
                <Plus className="h-3.5 w-3.5" /> Custom service
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <h3 className="text-sm font-semibold">Notes</h3>
          <textarea
            key={agreement.notes ?? ''}
            defaultValue={agreement.notes ?? ''}
            disabled={!canManage}
            rows={3}
            placeholder="Commercial notes, term dates, anything the team should know."
            onBlur={e => { if (e.target.value !== (agreement.notes ?? '')) void save({ notes: e.target.value }) }}
            className="w-full resize-y rounded-md border border-zinc-200 bg-transparent p-3 text-sm outline-none placeholder:text-zinc-400 dark:border-zinc-800"
          />
        </CardContent>
      </Card>
    </div>
  )
}
