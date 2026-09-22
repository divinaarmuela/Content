'use client'

import { Check, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dueWords, type QueueGroup } from '../../../lib/acq-queue-core'

/**
 * MY QUEUE (the acquisition blueprint, §10 "Task & Notification view"; 22
 * Sep 2026). Three lists, soonest first — the follow-ups and tasks on my
 * prospects, the agent's unsure findings owed a Confirm or a Dismiss, and
 * the prospects over their stage clock — each row naming the business and
 * opening it. The rules are acq-queue-core's; this only draws them.
 */
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short' })

export default function QueueView({ groups, everyone, mayEveryone, onEveryone, busy, now, nameOf, prospects, onOpen, onDone, onAnswer }: {
  groups: QueueGroup[]
  everyone: boolean
  mayEveryone: boolean
  onEveryone: (on: boolean) => void
  busy: boolean
  now: number
  nameOf: (id: string | null | undefined) => string | null
  prospects: readonly { id: string; owner_id?: string | null }[]
  onOpen: (prospectId: string) => void
  onDone: (todoId: string) => Promise<boolean> | void
  onAnswer: (prospectId: string, eventId: string, confirm: boolean) => Promise<boolean> | void
}) {
  const owner = (prospectId: string) => nameOf(prospects.find(p => p.id === prospectId)?.owner_id)
  return (
    <div className="flex flex-col gap-4" data-acq-queue>
      {mayEveryone && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={everyone ? 'outline' : 'default'} onClick={() => onEveryone(false)} className="h-9 rounded-full px-3 text-[12px] font-semibold">Mine</Button>
          <Button type="button" variant={everyone ? 'default' : 'outline'} onClick={() => onEveryone(true)} className="h-9 rounded-full px-3 text-[12px] font-semibold">Everyone’s</Button>
        </div>
      )}
      {groups.map(g => (
        <section key={g.key} aria-label={g.label} className="rounded-card border border-border bg-card">
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {g.label} <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 tabular-nums">{g.items.length}</span>
          </h2>
          {g.items.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-muted-foreground">{g.empty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {g.items.map(it => (
                <li key={it.key} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => onOpen(it.prospect_id)} className="text-left text-[14px] font-semibold underline-offset-4 hover:underline">{it.business}</button>
                    <p className="text-[13px]">{it.title}</p>
                    {it.words && <p className="text-[12px] text-muted-foreground">{it.words}</p>}
                    <p className="text-[12px] text-muted-foreground">
                      {it.kind === 'task' ? dueWords(it.when, now, when) : it.when ? when(it.when) : null}
                      {everyone && owner(it.prospect_id) ? ` · ${owner(it.prospect_id)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {it.kind === 'task' && it.todo_id && (
                      <Button type="button" variant="outline" disabled={busy} onClick={() => void onDone(it.todo_id!)} className="h-9 rounded-full px-3 text-[12px] font-semibold"><Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Done</Button>
                    )}
                    {it.kind === 'finding' && it.event_id && (
                      <>
                        <Button type="button" disabled={busy} onClick={() => void onAnswer(it.prospect_id, it.event_id!, true)} className="h-9 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background hover:bg-foreground/90"><Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Confirm</Button>
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void onAnswer(it.prospect_id, it.event_id!, false)} className="h-9 rounded-full px-3 text-[12px] font-semibold"><X className="mr-1 h-3.5 w-3.5" aria-hidden /> Dismiss</Button>
                      </>
                    )}
                    <Button type="button" variant="ghost" onClick={() => onOpen(it.prospect_id)} className="h-9 rounded-full px-3 text-[12px] font-semibold"><ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden /> Open</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
