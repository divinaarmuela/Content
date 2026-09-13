'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import BriefCanvas from './BriefCanvas'
import { planAsText, type SopShoot } from '../../../../lib/shoot-sop-core'
import { shootCardId } from '../../../../lib/deliverable-group-core'
import type { CanvasCard, ReferenceMedia } from '../../../../lib/batch-brief-core'

const H = 'font-mono text-[12px] uppercase tracking-widest text-muted-foreground'

/**
 * THE PLAN, FOR THE PEOPLE ON THE SHOOT (the owner, 13 Sep 2026: "whoever
 * receives the brief has a dedicated page for them to see the plan… if they
 * are the one who will be on set make sure they can see the plan"). The
 * crew, the editor and the quality checker read here; nothing on this page
 * writes to the plan. The editor's work is on their card; the crew press
 * "I've read the plan" here.
 */
export default function PlanReadOnly({ batch, cards, references, crew, viewerId, onAcknowledged }: {
  batch: SopShoot & { id: string; title: string; concept?: string | null; clients?: { name?: string | null } | null }
  cards: CanvasCard[]
  references: ReferenceMedia[]
  crew: { id: string; name: string; role?: string | null; acknowledged_at?: string | null }[]
  viewerId: string
  onAcknowledged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const me = crew.find(c => c.id === viewerId)
  const isEditor = batch.editor_id === viewerId
  const parts = planAsText(batch)
  const ack = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/batches/${batch.id}/acknowledge`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save')
      toast.success('Thanks — the team can see you have read the plan')
      onAcknowledged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-5" data-plan-read-only>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight">{batch.title}</h1>
          <p className="text-[13px] text-muted-foreground">
            {batch.clients?.name ?? ''}{batch.shoot_date ? ` · Shoot ${new Date(`${String(batch.shoot_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}
          </p>
        </div>
        {isEditor ? (
          <Button asChild className="h-11 rounded-full px-5 text-[14px] font-semibold">
            <Link href={`/dashboard/editor?card=${shootCardId(batch.id)}`}>Open your card</Link>
          </Button>
        ) : me?.acknowledged_at ? (
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-accent-green/20 px-4 text-[14px] font-semibold"><Check className="h-4 w-4" aria-hidden /> You have read the plan</span>
        ) : me ? (
          <Button className="h-11 rounded-full px-5 text-[14px] font-semibold" disabled={busy} onClick={() => void ack()}>I’ve read the plan</Button>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardContent className="flex flex-col gap-4 p-4">
              <p className={H}>The shoot plan</p>
              <dl className="grid gap-3 sm:grid-cols-2">
                {parts.map(p => (
                  <div key={p.label} className="flex flex-col gap-0.5">
                    <dt className="text-[12px] font-semibold">{p.label}</dt>
                    <dd className="whitespace-pre-wrap text-[14px]">{p.value || <span className="text-muted-foreground">Not given</span>}</dd>
                  </div>
                ))}
              </dl>
              {batch.concept && (
                <div className="flex flex-col gap-0.5 border-t border-border pt-3">
                  <p className="text-[12px] font-semibold">Notes for the team</p>
                  <p className="whitespace-pre-wrap text-[14px]">{batch.concept}</p>
                </div>
              )}
            </CardContent>
          </Card>
          {cards.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className={H}>Plan canvas</p>
              <BriefCanvas cards={cards} references={references} canEdit={false} clientName={batch.clients?.name ?? undefined} onOp={async () => false} />
            </div>
          )}
        </div>
        <Card className="h-fit">
          <CardContent className="flex flex-col gap-2 p-4">
            <p className={H}>Who is on this shoot</p>
            <ul className="flex flex-col gap-1.5">
              {crew.map(c => (
                <li key={c.id} className="flex items-center gap-2 text-[14px]">
                  {c.acknowledged_at
                    ? <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-green text-ink" aria-hidden><Check className="h-3 w-3" strokeWidth={3} /></span>
                    : <span className="h-5 w-5 shrink-0 rounded-full border border-border" aria-hidden />}
                  <span className="min-w-0 truncate">{c.name}{c.id === batch.editor_id ? <span className="text-muted-foreground"> · editor</span> : ''}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
