'use client'

import { useState } from 'react'
import { Split } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { roundTitle, splitPlan } from '../../lib/split-core'

/**
 * SPLIT, THE TEAM'S DOOR (docs/COLOUR_GRADE_SPLIT_SPEC.md C6, C7). On a card with the client where they approved some
 * videos and not others: the approved go to handover, the rest come back to the editor as "<title> · Round N". Two
 * presses — the first says exactly what will happen, the second does it. The client's door is "Send my answers".
 */
export function SplitPanel({ item, mayDecide }: {
  item: { id: string; title?: string | null; status?: unknown; final_files?: unknown; clip_approvals?: unknown; edit_round?: unknown; split_round?: unknown; split_at?: unknown }
  /** an account manager or a super admin */
  mayDecide: boolean
}) {
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!mayDecide || String(item.status) !== 'client_review' || item.split_at) return null
  const plan = splitPlan(item as never)
  if (plan.kind !== 'split') return null
  const title = roundTitle(item.title, item.split_round as number | null)
  const split = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${encodeURIComponent(item.id)}/split`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'That did not work'))
      toast.success(`Split — ${json.approved} to handover, ${json.open} to "${json.new_title}"`)
      setSure(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex flex-col gap-2 border-b border-border p-4" aria-labelledby="split-h" data-split-panel>
      <p id="split-h" className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Split className="h-4 w-4" aria-hidden /> The client’s answers
      </p>
      <p className="text-[14px]">
        Approved {plan.approved.length} of {plan.approved.length + plan.open.length}. Split it: the {plan.approved.length} approved go to handover; the other {plan.open.length} come back to the editor as “{title}”.
      </p>
      <ul className="text-[13px] text-muted-foreground">
        {plan.open.map(v => <li key={v.id}>• {v.name}</li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {!sure ? (
          <Button variant="outline" className="h-11 rounded-full px-4 text-[14px] font-semibold" onClick={() => setSure(true)} data-split>
            Split — {plan.approved.length} to handover, {plan.open.length} to Round {title.match(/Round (\d+)$/)?.[1] ?? 2}
          </Button>
        ) : (
          <>
            <Button className="h-11 rounded-full bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-foreground/90" disabled={busy} onClick={() => void split()} data-split-confirm>
              {busy ? 'Splitting…' : 'Yes, split it'}
            </Button>
            <Button variant="ghost" className="h-11 rounded-full px-4 text-[14px]" disabled={busy} onClick={() => setSure(false)}>Not yet</Button>
          </>
        )}
      </div>
    </section>
  )
}
