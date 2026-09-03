'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText, Plus } from 'lucide-react'
import { friendlyError } from '@/app/lib/support-core'
import HelpHint from '../../../HelpHint'
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
  const [customService, setCustomService] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${id}/agreement`)
    if (!res.ok) {
      const err = (await res.json()).error ?? ''
      // the migration name is for whoever opens the console, not for the
      // account manager trying to read a client's monthly commitment
      console.error('[agreement] load failed', err)
      toast.error(friendlyError(String(err), 'Agreements'))
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

  /**
   * Everything on this page saves on blur. That is fine — until you realise
   * what is being changed: a client's monthly quota is a commercial
   * commitment, and it used to change with no Save button and no confirmation
   * of any kind. `what` names the thing that moved, so the person who clicked
   * away sees that it landed.
   */
  const save = async (next: Partial<Agreement>, what?: string) => {
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
      if (what) toast.success(`Saved — ${what}`)
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
          <div className="flex h-10 w-10 items-center justify-center rounded-inner bg-foreground/[0.06]">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-body-15 font-medium">No agreement on file</p>
          {canManage ? (
            <>
              <p className="max-w-sm text-body-15 text-muted-foreground">
                Record the client&rsquo;s monthly deliverables and retained services
                so the team can plan against them.
              </p>
              <Button size="sm" disabled={busy}
                onClick={() => void save({ deliverable_lines: [], services: [], notes: '' })}>
                Set up agreement
              </Button>
            </>
          ) : (
            <p className="max-w-sm text-body-15 text-muted-foreground">
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
    void save({ deliverable_lines: lines }, `${TYPE_LABELS[type]}: ${qty} a month`)
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
              <h3 className="flex items-center text-body-15 font-semibold">
                What we owe them each month
                <HelpHint term="deliverable" />
              </h3>
              <p className="mt-0.5 text-secondary-13 text-muted-foreground">
                How many of each we promised per month. Saved as you go. A single
                month can be adjusted later in Production.
              </p>
            </div>
            <label className="flex items-center gap-2 text-secondary-13 text-muted-foreground">
              Agreement start
              {canManage ? (
                <Input type="date" key={agreement.start_date ?? ''} defaultValue={agreement.start_date ?? ''}
                  disabled={busy} className="h-8 w-36 font-mono text-secondary-13"
                  onBlur={e => { if (e.target.value !== (agreement.start_date ?? '')) void save({ start_date: e.target.value || null }, e.target.value ? `agreement starts ${e.target.value}` : 'start date cleared') }} />
              ) : (
                <span className="font-mono">{agreement.start_date ?? '—'}</span>
              )}
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {CONTENT_TYPES.map(type => {
              const line = lineFor(type)
              return (
                <div key={type} className="flex items-center gap-3 rounded-tile border border-border px-3 py-2">
                  <span className="flex-1 text-body-15">{TYPE_LABELS[type]}</span>
                  {canManage ? (
                    <Input type="number" min={0} key={`${type}:${line?.monthly_qty ?? 0}`}
                      defaultValue={line?.monthly_qty ?? 0} disabled={busy}
                      className="h-8 w-20 text-center font-mono text-body-15 tabular-nums"
                      onBlur={e => {
                        const qty = Math.max(0, Number(e.target.value) || 0)
                        if (qty !== (line?.monthly_qty ?? 0)) setQty(type, qty)
                      }} />
                  ) : (
                    <span className="font-mono text-body-15 tabular-nums">{line?.monthly_qty ?? 0}</span>
                  )}
                  <span className="w-14 text-right text-[12px] text-muted-foreground">/ month</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <h3 className="text-body-15 font-semibold">Retained services</h3>
          <div className="flex flex-col gap-1.5">
            {catalog.map(c => {
              const svc = serviceFor(c.key)
              return (
                <label key={c.key}
                  className={`flex items-center gap-3 rounded-tile border border-border px-3 py-2 text-body-15 ${canManage ? 'cursor-pointer hover:bg-foreground/[0.04]' : ''}`}>
                  <input type="checkbox" checked={svc?.active ?? false} disabled={!canManage || busy}
                    onChange={e => setService(c.key, c.label, { active: e.target.checked })}
                    className="h-4 w-4 shrink-0 accent-blue-600" />
                  <span className="flex-1">{c.label}</span>
                  {canManage && (svc?.active || svc?.note) && (
                    <Input key={`${c.key}:${svc?.note ?? ''}`} defaultValue={svc?.note ?? ''} placeholder="note"
                      className="h-7 w-44 text-secondary-13"
                      onBlur={e => { if (e.target.value !== (svc?.note ?? '')) setService(c.key, c.label, { note: e.target.value }) }} />
                  )}
                </label>
              )
            })}
            {agreement.services.filter(s => s.key.startsWith('custom:')).map(s => (
              <label key={s.key} className="flex items-center gap-3 rounded-tile border border-border px-3 py-2 text-body-15">
                <input type="checkbox" checked={s.active} disabled={!canManage || busy}
                  onChange={e => setService(s.key, s.label, { active: e.target.checked })}
                  className="h-4 w-4 shrink-0 accent-blue-600" />
                <span className="flex-1">{s.label}</span>
                <Badge variant="outline" className="font-normal text-muted-foreground">custom</Badge>
              </label>
            ))}
            {/* window.prompt was the only native browser dialog left in the
                app: unstyled, untranslatable, and invisible in dark mode. */}
            {canManage && (
              <form
                className="flex flex-wrap items-center gap-2 pt-1"
                onSubmit={e => {
                  e.preventDefault()
                  const label = customService.trim()
                  if (!label) return
                  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
                  setService(`custom:${slug}`, label, { active: true })
                  setCustomService('')
                }}
              >
                <Input
                  value={customService}
                  onChange={e => setCustomService(e.target.value)}
                  placeholder="Something else we do for them"
                  className="h-9 max-w-xs"
                />
                <Button size="sm" variant="outline" type="submit" disabled={busy || !customService.trim()}>
                  <Plus className="h-3.5 w-3.5" /> Add it
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <h3 className="text-body-15 font-semibold">Notes</h3>
          <textarea
            key={agreement.notes ?? ''}
            defaultValue={agreement.notes ?? ''}
            disabled={!canManage}
            rows={3}
            placeholder="Commercial notes, term dates, anything the team should know."
            onBlur={e => { if (e.target.value !== (agreement.notes ?? '')) void save({ notes: e.target.value }, 'notes updated') }}
            className="w-full resize-y rounded-tile border border-border bg-transparent p-3 text-body-15 outline-none placeholder:text-muted-foreground"
          />
        </CardContent>
      </Card>
    </div>
  )
}
