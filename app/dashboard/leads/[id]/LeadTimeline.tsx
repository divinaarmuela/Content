'use client'

import { useEffect, useState } from 'react'
import { CalendarCheck, CalendarX, Globe, Mail, FileText, UserX, Sparkles, type LucideIcon } from 'lucide-react'
import type { TimelineItem, TimelineKind } from '@/app/lib/lead-timeline-core'

/** A lead's timeline, newest at the top and their first time here at the bottom (owner, 9 Nov 2026: "like a timeline"). */
const LOOK: Record<TimelineKind, { icon: LucideIcon; dot: string }> = {
  first_visit: { icon: Globe, dot: 'bg-tint-blue text-accent-blue-deep' },
  form: { icon: FileText, dot: 'bg-tint-blue text-accent-blue-deep' },
  came_in: { icon: Sparkles, dot: 'bg-tint-blue text-accent-blue-deep' },
  email: { icon: Mail, dot: 'bg-foreground/[0.06] text-foreground' },
  booked: { icon: CalendarCheck, dot: 'bg-tint-green text-foreground' },
  rebooked: { icon: CalendarCheck, dot: 'bg-tint-green text-foreground' },
  showed: { icon: CalendarCheck, dot: 'bg-tint-green text-foreground' },
  cancelled: { icon: CalendarX, dot: 'bg-tint-red text-foreground' },
  no_show: { icon: UserX, dot: 'bg-tint-red text-foreground' },
  acquisition: { icon: Sparkles, dot: 'bg-tint-amber text-foreground' },
}

const whenWords = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function LeadTimeline({ id, refreshKey }: { id: string; refreshKey?: unknown }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    fetch(`/api/leads/${encodeURIComponent(id)}/timeline`, { cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error(); const j = await r.json(); if (live) { setItems(j.items ?? []); setFailed(false) } })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [id, refreshKey])

  return (
    <section aria-label="Timeline" className="rounded-card border border-border bg-card" data-lead-timeline>
      <h2 className="border-b border-border px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Timeline</h2>
      {failed ? <p className="px-4 py-6 text-[13px] text-muted-foreground">The timeline did not load. Refresh the page to try again.</p>
        : items === null ? <p className="px-4 py-6 text-[13px] text-muted-foreground">Reading their history…</p>
        : items.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted-foreground">Nothing recorded yet.</p>
        : (
          <ol className="px-4 py-4">
            {items.map((it, i) => {
              const look = LOOK[it.kind] ?? LOOK.came_in
              const Icon = look.icon
              const last = i === items.length - 1
              return (
                <li key={it.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
                  <span className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${look.dot}`}><Icon className="h-4 w-4" aria-hidden /></span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-[14px] font-semibold">{it.title}</p>
                      {last && items.length > 1 && <span className="rounded-full bg-foreground/[0.06] px-2 py-px text-[11px] font-medium text-muted-foreground">First time</span>}
                    </div>
                    <p className="text-[12px] text-muted-foreground">{whenWords(it.at)}</p>
                    {it.detail && <p className="mt-1 whitespace-pre-wrap text-[13px]">{it.detail}</p>}
                    {it.lines.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {it.lines.map(l => <li key={l} className="rounded-md bg-foreground/[0.04] px-2 py-0.5 text-[12px] text-muted-foreground">{l}</li>)}
                      </ul>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
    </section>
  )
}
