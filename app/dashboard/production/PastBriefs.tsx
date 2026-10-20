'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useTable } from '@/lib/db-client'
import type { Client } from '@/lib/db-types'
import { pastBriefHref, pastBriefs, type PastBrief } from '../../lib/milanote-briefs-core'

/**
 * PAST BRIEFS (FROM MILANOTE), ON SHOOTS (the owner, 20 Oct 2026: "shoot briefs in shoots and the others are in
 * boards"). Every Milanote shoot brief the import brought in, by client — each opens on its client's board, inside the
 * brief itself, editable there. The same board, not a copy. Mounted only when asked for: it reads every board.
 */
export function PastBriefsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button variant="outline" onClick={onToggle} aria-pressed={open}
      className={`h-11 rounded-full border-border px-4 text-[14px] font-semibold ${open ? 'bg-foreground text-background hover:bg-foreground/90 hover:text-background' : 'bg-surface'}`}>
      <History className="h-4 w-4" aria-hidden /> {open ? 'Back to the page' : 'Past shoot plans'}
    </Button>
  )
}

export default function PastBriefs() {
  const { rows, loading } = useTable<{ id: string; name: string; client_id?: string | null; milanote_id?: string | null; canvas_cards?: unknown; archived_at?: string | null }>('team_boards')
  const { rows: clients } = useTable<Client>('clients')
  const [search, setSearch] = useState('')
  const nameOf = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients])
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = pastBriefs(rows).filter(b => !q || `${b.path} ${nameOf.get(b.clientId ?? '') ?? ''}`.toLowerCase().includes(q))
    const by = new Map<string, PastBrief[]>()
    for (const b of all) {
      const k = nameOf.get(b.clientId ?? '') ?? 'No client'
      by.set(k, [...(by.get(k) ?? []), b])
    }
    return [...by].sort(([a], [b]) => a.localeCompare(b))
  }, [rows, nameOf, search])

  if (loading) return <Skeleton className="h-64 w-full rounded-card" />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[15px] text-muted-foreground">Shoot plans brought over from Milanote, by client. Each opens on its client&rsquo;s board, ready to edit.</p>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shoot plans or clients…" aria-label="Search past shoot plans"
          className="ml-auto h-11 w-64 rounded-full border-border bg-surface px-4" />
      </div>
      {groups.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-6 py-12 text-center text-[15px] text-muted-foreground">
          {search.trim() ? `No past shoot plan matches “${search.trim()}”.` : 'No past shoot plans from Milanote.'}
        </p>
      ) : groups.map(([client, briefs]) => (
        <section key={client} className="flex flex-col gap-2" aria-label={`${client} — past shoot plans`}>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{client} · {briefs.length}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {briefs.map(b => (
              <li key={`${b.teamBoardId}:${b.boardCardId ?? ''}`}>
                <Link href={pastBriefHref(b)}
                  className="flex min-h-11 flex-col gap-0.5 rounded-card border border-border bg-surface px-4 py-3 hover:border-foreground/30">
                  <span className="text-[15px] font-semibold leading-snug">{b.title}</span>
                  <span className="truncate text-[12px] text-muted-foreground" title={b.path}>{b.path}</span>
                  <span className="text-[12px] text-muted-foreground">{b.cards} card{b.cards === 1 ? '' : 's'} · from Milanote</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
